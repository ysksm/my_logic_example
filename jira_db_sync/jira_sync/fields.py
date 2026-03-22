"""フィールド展開 (issues_expanded)

責務:
- jira_fields メタデータから動的にカラム定義と SQL 式を生成
- issues.raw_data から全フィールドを展開して issues_expanded テーブルを作成
- issues_readable ビューの作成
"""

import logging

import pandas as pd

logger = logging.getLogger(__name__)


def _safe_str(val) -> str:
    """NaN/None を空文字に変換"""
    if val is None or (isinstance(val, float) and val != val):
        return ""
    return str(val).lower()


def _to_col_type(schema_type, schema_items) -> str:
    """スキーマタイプから DuckDB カラム型を決定"""
    st = _safe_str(schema_type)
    if st in ("number", "numeric"):
        return "DOUBLE"
    elif st == "datetime":
        return "TIMESTAMPTZ"
    elif st == "date":
        return "DATE"
    elif st in ("array", "any"):
        return "JSON"
    return "VARCHAR"


def _to_select_expr(field_id: str, schema_type, schema_items, schema_system) -> str:
    """フィールドの JSON 展開 SQL 式を生成"""
    st = _safe_str(schema_type)
    fid = field_id

    if st == "user":
        return f"i.raw_data->'fields'->'{fid}'->>'displayName'"
    elif st in ("status", "priority", "resolution", "issuetype", "issuelink",
                "securitylevel", "component", "version"):
        return f"i.raw_data->'fields'->'{fid}'->>'name'"
    elif st in ("option", "option-with-child"):
        return (f"COALESCE(i.raw_data->'fields'->'{fid}'->>'value',"
                f"i.raw_data->'fields'->'{fid}'->>'name')")
    elif st == "array":
        return f"TRY_CAST(i.raw_data->'fields'->'{fid}' AS JSON)"
    elif st == "number":
        return f"TRY_CAST(i.raw_data->'fields'->>'{fid}' AS DOUBLE)"
    elif st in ("datetime", "date"):
        return f"TRY_CAST(i.raw_data->'fields'->>'{fid}' AS TIMESTAMP)"
    elif st in ("progress", "any"):
        return f"TRY_CAST(i.raw_data->'fields'->'{fid}' AS JSON)"
    elif st == "string":
        return f"i.raw_data->'fields'->>'{fid}'"
    else:
        return (f"COALESCE(i.raw_data->'fields'->'{fid}'->>'name',"
                f"i.raw_data->'fields'->'{fid}'->>'value',"
                f"i.raw_data->'fields'->'{fid}'->>'displayName',"
                f"i.raw_data->'fields'->>'{fid}')")


class FieldExpander:
    """jira_fields メタデータに基づいて issues_expanded テーブルを構築"""

    def __init__(self, conn, fields_df: pd.DataFrame):
        self.conn = conn
        self.fields_df = fields_df

    def expand(self, project_key: str) -> dict:
        """issues.raw_data からフィールドを展開して issues_expanded に投入

        Returns:
            {"expanded": 件数, "columns": カラム数, "custom_fields": カスタムフィールド数}
        """
        target_fields = self.fields_df[
            self.fields_df["navigable"] == True
        ].to_dict("records")

        # 固定カラム
        select_parts = [
            "i.id",
            "i.project_id",
            'COALESCE(i.raw_data->>\'key\', i."key") AS issue_key',
        ]
        col_defs = [
            ("id", "VARCHAR PRIMARY KEY"),
            ("project_id", "VARCHAR NOT NULL"),
            ("issue_key", "VARCHAR NOT NULL"),
        ]
        processed = {"id", "project_id", "issue_key"}

        # メタデータから動的にカラムを生成
        custom_count = 0
        for f in target_fields:
            fid = f["id"]
            col = fid.lower().replace("-", "_").replace(".", "_")
            if col in processed:
                continue
            processed.add(col)

            col_type = _to_col_type(f.get("schema_type"), f.get("schema_items"))
            expr = _to_select_expr(
                fid, f.get("schema_type"), f.get("schema_items"), f.get("schema_system")
            )
            select_parts.append(f'{expr} AS "{col}"')
            col_defs.append((col, col_type))
            if f.get("custom"):
                custom_count += 1

        select_parts.append("CURRENT_TIMESTAMP AS synced_at")
        col_defs.append(("synced_at", "TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP"))

        # テーブル再作成
        self.conn.execute("DROP TABLE IF EXISTS issues_expanded")
        create_cols = ", ".join(f'"{c}" {t}' for c, t in col_defs)
        self.conn.execute(f"CREATE TABLE issues_expanded ({create_cols})")
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_expanded_project ON issues_expanded(project_id)"
        )
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_expanded_key ON issues_expanded(issue_key)"
        )

        # データ投入
        select_sql = ",\n        ".join(select_parts)
        self.conn.execute(f"""
            INSERT INTO issues_expanded
            SELECT {select_sql}
            FROM issues i
            WHERE i."key" LIKE '{project_key}-%'
        """)

        # issues_readable ビュー
        self._create_readable_view(col_defs)

        expanded = self.conn.execute("SELECT COUNT(*) FROM issues_expanded").fetchone()[0]
        logger.info(
            "Expanded %d issues into %d columns (%d custom)",
            expanded, len(col_defs), custom_count,
        )
        return {
            "expanded": expanded,
            "columns": len(col_defs),
            "custom_fields": custom_count,
        }

    def _create_readable_view(self, col_defs: list[tuple[str, str]]):
        """issues_readable ビュー（カラム名 → フィールド名）を作成"""
        field_name_map = dict(
            zip(self.fields_df["id"].str.lower(), self.fields_df["name"])
        )
        field_name_map.update({
            "id": "ID", "project_id": "Project ID",
            "issue_key": "Key", "synced_at": "同期日時",
        })
        view_cols = []
        for col, _ in col_defs:
            display = field_name_map.get(col, col).replace('"', '""')
            view_cols.append(f'"{col}" AS "{display}"')
        self.conn.execute(
            f"CREATE OR REPLACE VIEW issues_readable AS SELECT {', '.join(view_cols)} FROM issues_expanded"
        )
