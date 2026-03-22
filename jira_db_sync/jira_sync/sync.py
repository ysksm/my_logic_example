"""同期サービス

責務:
- 全件同期 / 差分同期 / レジューム同期の制御
- チェックポイント管理（sync_state.json）
- 同期フロー全体のオーケストレーション
"""

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Callable

import pandas as pd

from jira_sync.client import JiraClient
from jira_sync.db import Database
from jira_sync.fields import FieldExpander
from jira_sync.transform import ChangeHistoryTransformer, IssueTransformer

logger = logging.getLogger(__name__)

MARGIN_MINUTES = 5  # 差分同期のマージン（JQL の分単位精度を補完）


class SyncState:
    """同期状態の永続化 (JSON ファイル)"""

    def __init__(self, path: str):
        self.path = path

    def _load(self) -> dict:
        if os.path.exists(self.path):
            try:
                with open(self.path) as f:
                    return json.load(f)
            except Exception:
                pass
        return {}

    def _save(self, state: dict):
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        with open(self.path, "w") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)

    def get_last_sync(self, project_key: str) -> dict | None:
        return self._load().get(project_key, {}).get("last_sync")

    def get_checkpoint(self, project_key: str) -> dict | None:
        return self._load().get(project_key, {}).get("checkpoint")

    def save_checkpoint(self, project_key: str, started_at: str,
                        items_synced: int, checkpoint_updated_at: str | None):
        state = self._load()
        proj = state.setdefault(project_key, {})
        proj["checkpoint"] = {
            "started_at": started_at,
            "items_synced": items_synced,
            "checkpoint_updated_at": checkpoint_updated_at,
        }
        self._save(state)

    def complete_sync(self, project_key: str, completed_at: str,
                      items_synced: int, sync_type: str):
        state = self._load()
        proj = state.setdefault(project_key, {})
        proj.pop("checkpoint", None)
        proj["last_sync"] = {
            "completed_at": completed_at,
            "items_synced": items_synced,
            "sync_type": sync_type,
        }
        self._save(state)


class SyncService:
    """同期オーケストレーター"""

    def __init__(self, client: JiraClient, db: Database, sync_state: SyncState):
        self.client = client
        self.db = db
        self.sync_state = sync_state

    def build_jql(self, project_key: str, mode: str) -> str:
        """同期モードに応じた JQL を構築"""
        base = f"project = {project_key} ORDER BY updated ASC, key ASC"

        if mode == "resume":
            cp = self.sync_state.get_checkpoint(project_key)
            if cp and cp.get("checkpoint_updated_at"):
                after = cp["checkpoint_updated_at"]
                dt = datetime.fromisoformat(str(after)) - timedelta(minutes=MARGIN_MINUTES)
                date_str = dt.strftime("%Y-%m-%d %H:%M")
                return (f"project = {project_key} "
                        f'AND updated >= "{date_str}" '
                        f"ORDER BY updated ASC, key ASC")

        if mode == "incremental":
            last = self.sync_state.get_last_sync(project_key)
            if last and last.get("completed_at"):
                dt = datetime.fromisoformat(str(last["completed_at"])) - timedelta(minutes=MARGIN_MINUTES)
                date_str = dt.strftime("%Y-%m-%d %H:%M")
                return (f"project = {project_key} "
                        f'AND updated >= "{date_str}" '
                        f"ORDER BY updated ASC, key ASC")

        return base

    def execute(
        self,
        project_key: str,
        mode: str = "full",
        projects: list[dict] | None = None,
        statuses: list[dict] | None = None,
        priorities_df: pd.DataFrame | None = None,
        issue_types_df: pd.DataFrame | None = None,
        fields_df: pd.DataFrame | None = None,
        on_progress: Callable[[int, int], None] | None = None,
    ) -> dict:
        """同期を実行

        Returns:
            {"mode": str, "issues": int, "history": int, "expanded": dict, "summary": dict}
        """
        started_at = datetime.now(timezone.utc).isoformat()
        self.sync_state.save_checkpoint(project_key, started_at, 0, None)

        # 1. Issues 取得
        jql = self.build_jql(project_key, mode)
        logger.info("Sync mode=%s, JQL=%s", mode, jql)
        raw_issues = self.client.fetch_all_issues(jql=jql, on_progress=on_progress)

        # 2. データ変換
        issues_df = IssueTransformer.transform(raw_issues)
        change_history_df = ChangeHistoryTransformer.transform(raw_issues)

        # 3. DB 書き込み
        if projects:
            self.db.upsert_projects(projects)
        self.db.upsert_issues(issues_df, project_key, full=(mode == "full"))

        # チェックポイント更新
        checkpoint_val = None
        if not issues_df.empty:
            checkpoint_val = str(issues_df["updated_date"].max())
            self.sync_state.save_checkpoint(
                project_key, started_at, len(issues_df), checkpoint_val
            )

        self.db.upsert_change_history(change_history_df, project_key)

        if statuses is not None:
            self.db.upsert_metadata(
                project_key, statuses,
                priorities_df if priorities_df is not None else pd.DataFrame(),
                issue_types_df if issue_types_df is not None else pd.DataFrame(),
                fields_df if fields_df is not None else pd.DataFrame(),
            )

        # 4. フィールド展開
        expand_result = {}
        if fields_df is not None and not fields_df.empty:
            expander = FieldExpander(self.db.conn, fields_df)
            expand_result = expander.expand(project_key)

        # 5. 同期完了
        completed_at = datetime.now(timezone.utc).isoformat()
        self.db.record_sync(
            project_key, mode, started_at, completed_at,
            len(issues_df), checkpoint_val,
        )
        self.sync_state.complete_sync(project_key, completed_at, len(issues_df), mode)

        summary = self.db.get_summary()
        logger.info(
            "Sync completed: %d issues, %d history, expanded=%s",
            summary["issues"], summary["history"], expand_result,
        )
        return {
            "mode": mode,
            "fetched": len(issues_df),
            "history": len(change_history_df),
            "expanded": expand_result,
            "summary": summary,
        }
