"""DuckDB データベース管理

責務:
- DB 接続とスキーマ初期化
- データの UPSERT（projects, issues, change_history, metadata）
- sync_history の管理
"""

import json
import logging
import os

import duckdb
import pandas as pd

logger = logging.getLogger(__name__)

# テーブル定義 (DDL)
_DDL = [
    """CREATE TABLE IF NOT EXISTS projects (
        id VARCHAR PRIMARY KEY, key VARCHAR NOT NULL, name VARCHAR NOT NULL,
        description TEXT, raw_data JSON,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)""",
    """CREATE TABLE IF NOT EXISTS issues (
        id VARCHAR PRIMARY KEY, project_id VARCHAR NOT NULL,
        key VARCHAR NOT NULL, summary TEXT NOT NULL, description TEXT,
        status VARCHAR, priority VARCHAR, assignee VARCHAR, reporter VARCHAR,
        issue_type VARCHAR, resolution VARCHAR, labels JSON, components JSON,
        fix_versions JSON, sprint VARCHAR, parent_key VARCHAR,
        due_date VARCHAR, created_date VARCHAR, updated_date VARCHAR,
        raw_data JSON, synced_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)""",
    """CREATE TABLE IF NOT EXISTS issue_change_history (
        issue_id VARCHAR NOT NULL, issue_key VARCHAR NOT NULL,
        history_id VARCHAR NOT NULL, author_account_id VARCHAR,
        author_display_name VARCHAR, field VARCHAR NOT NULL,
        field_type VARCHAR, from_value TEXT, from_string TEXT,
        to_value TEXT, to_string TEXT, changed_at VARCHAR NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS statuses (
        project_key VARCHAR NOT NULL, name VARCHAR NOT NULL,
        description VARCHAR, category VARCHAR,
        PRIMARY KEY (project_key, name))""",
    """CREATE TABLE IF NOT EXISTS priorities (
        name VARCHAR PRIMARY KEY, description VARCHAR)""",
    """CREATE TABLE IF NOT EXISTS issue_types (
        name VARCHAR PRIMARY KEY, description VARCHAR,
        subtask BOOLEAN DEFAULT false)""",
    """CREATE TABLE IF NOT EXISTS jira_fields (
        id VARCHAR PRIMARY KEY, key VARCHAR NOT NULL,
        name VARCHAR NOT NULL, custom BOOLEAN DEFAULT false,
        searchable BOOLEAN DEFAULT false, navigable BOOLEAN DEFAULT false,
        orderable BOOLEAN DEFAULT false, schema_type VARCHAR,
        schema_items VARCHAR, schema_system VARCHAR,
        schema_custom VARCHAR, schema_custom_id BIGINT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)""",
    """CREATE TABLE IF NOT EXISTS sync_history (
        id INTEGER PRIMARY KEY, project_key VARCHAR NOT NULL,
        sync_type VARCHAR NOT NULL, started_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ, status VARCHAR NOT NULL,
        items_synced INTEGER, checkpoint_updated_at TIMESTAMPTZ)""",
    "CREATE SEQUENCE IF NOT EXISTS sync_history_seq START 1",
    'CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id)',
    'CREATE INDEX IF NOT EXISTS idx_issues_key ON issues("key")',
    'CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status)',
    'CREATE INDEX IF NOT EXISTS idx_ch_issue_id ON issue_change_history(issue_id)',
    'CREATE INDEX IF NOT EXISTS idx_ch_field ON issue_change_history(field)',
]


class Database:
    """DuckDB データベースラッパー"""

    def __init__(self, db_path: str):
        os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
        self.conn = duckdb.connect(db_path)
        self._init_schema()
        logger.info("Connected to %s", db_path)

    def _init_schema(self):
        for sql in _DDL:
            self.conn.execute(sql)

    def upsert_projects(self, projects: list[dict]):
        """プロジェクトを UPSERT"""
        for p in projects:
            self.conn.execute(
                """INSERT INTO projects (id, key, name, description, raw_data)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (id) DO UPDATE SET
                    key = EXCLUDED.key, name = EXCLUDED.name,
                    description = EXCLUDED.description, raw_data = EXCLUDED.raw_data""",
                [p["id"], p["key"], p["name"], p.get("description", ""),
                 json.dumps(p.get("raw_data", p), ensure_ascii=False)],
            )
        logger.info("Upserted %d projects", len(projects))

    def upsert_issues(self, issues_df: pd.DataFrame, project_key: str, full: bool = True):
        """issues を UPSERT

        full=True: プロジェクトの全 issue を削除して再投入
        full=False: 取得した issue のみ差し替え
        """
        if issues_df.empty:
            return
        if full:
            self.conn.execute(
                'DELETE FROM issues WHERE "key" LIKE ?',
                [f"{project_key}-%"],
            )
        else:
            self.conn.execute(
                "CREATE OR REPLACE TEMP TABLE tmp_del_ids AS SELECT id FROM issues_df"
            )
            self.conn.execute("DELETE FROM issues WHERE id IN (SELECT id FROM tmp_del_ids)")
            self.conn.execute("DROP TABLE IF EXISTS tmp_del_ids")

        # DataFrame のカラム順をテーブルに合わせて INSERT
        from jira_sync.transform import ISSUES_TABLE_COLUMNS
        self.conn.execute(
            "CREATE OR REPLACE TEMP TABLE tmp_reordered AS SELECT "
            + ", ".join(ISSUES_TABLE_COLUMNS)
            + " FROM issues_df"
        )
        self.conn.execute("INSERT INTO issues SELECT *, CURRENT_TIMESTAMP FROM tmp_reordered")
        self.conn.execute("DROP TABLE IF EXISTS tmp_reordered")
        logger.info("Upserted %d issues (full=%s)", len(issues_df), full)

    def upsert_change_history(self, change_history_df: pd.DataFrame, project_key: str):
        """変更履歴を差し替え"""
        self.conn.execute(
            "DELETE FROM issue_change_history WHERE issue_key LIKE ?",
            [f"{project_key}-%"],
        )
        if not change_history_df.empty:
            self.conn.execute("INSERT INTO issue_change_history SELECT * FROM change_history_df")
        logger.info("Upserted %d change history records", len(change_history_df))

    def upsert_metadata(
        self, project_key: str, statuses: list[dict],
        priorities_df: pd.DataFrame, issue_types_df: pd.DataFrame, fields_df: pd.DataFrame,
    ):
        """メタデータを更新"""
        self.conn.execute("DELETE FROM statuses WHERE project_key = ?", [project_key])
        for s in statuses:
            self.conn.execute(
                "INSERT INTO statuses VALUES (?, ?, ?, ?)",
                [project_key, s["name"], s["description"], s["category"]],
            )
        if not priorities_df.empty:
            self.conn.execute("DELETE FROM priorities")
            self.conn.execute("INSERT INTO priorities SELECT name, description FROM priorities_df")
        if not issue_types_df.empty:
            self.conn.execute("DELETE FROM issue_types")
            self.conn.execute(
                "INSERT INTO issue_types SELECT name, description, subtask FROM issue_types_df"
            )
        if not fields_df.empty:
            self.conn.execute("DELETE FROM jira_fields")
            self.conn.execute(
                "INSERT INTO jira_fields SELECT *, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM fields_df"
            )
        logger.info("Updated metadata for project %s", project_key)

    def record_sync(self, project_key: str, sync_type: str, started_at: str,
                    completed_at: str, items_synced: int, checkpoint: str | None):
        """同期履歴を記録"""
        self.conn.execute(
            """INSERT INTO sync_history VALUES (
                nextval('sync_history_seq'), ?, ?, ?, ?, 'completed', ?, ?)""",
            [project_key, sync_type, started_at, completed_at, items_synced, checkpoint],
        )

    def get_summary(self) -> dict:
        """DB の概要を取得"""
        row = self.conn.execute(
            "SELECT COUNT(*) AS issues, "
            "(SELECT COUNT(*) FROM issue_change_history) AS history "
            "FROM issues"
        ).fetchone()
        return {"issues": row[0], "history": row[1]}
