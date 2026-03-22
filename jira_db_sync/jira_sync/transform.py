"""データ変換

責務:
- Jira API レスポンスから issues_df / change_history_df への変換
- フィールドの抽出・正規化
"""

import json
import logging

import pandas as pd

logger = logging.getLogger(__name__)

# issues テーブルのカラム順（DDL と一致させる）
ISSUES_TABLE_COLUMNS = [
    "id", "project_id", "key", "summary", "description",
    "status", "priority", "assignee", "reporter", "issue_type",
    "resolution", "labels", "components", "fix_versions", "sprint",
    "parent_key", "due_date", "created_date", "updated_date", "raw_data",
]


def _safe_json(val) -> str | None:
    if val is None:
        return None
    return json.dumps(val, ensure_ascii=False)


def _extract_sprint(fields: dict) -> str | None:
    """Sprint フィールドの抽出"""
    for fid in ["sprint", "customfield_10020", "customfield_10104", "customfield_10000"]:
        val = fields.get(fid)
        if val is None:
            continue
        if isinstance(val, list):
            for sp in reversed(val):
                if isinstance(sp, dict) and sp.get("name"):
                    state = sp.get("state", "")
                    if state in ("active", "closed", ""):
                        return sp["name"]
            for sp in val:
                if isinstance(sp, dict) and sp.get("name"):
                    return sp["name"]
        elif isinstance(val, str) and "name=" in val:
            start = val.find("name=") + 5
            end = val.find(",", start)
            if end == -1:
                end = val.find("]", start)
            if end != -1:
                return val[start:end]
    return None


class IssueTransformer:
    """Jira API レスポンスを issues_df に変換"""

    @staticmethod
    def transform(raw_issues: list[dict]) -> pd.DataFrame:
        """raw_issues → DataFrame（テーブルカラム順に並べ替え済み）"""
        rows = []
        for issue in raw_issues:
            f = issue.get("fields", {})
            rows.append({
                "id": issue["id"],
                "key": issue["key"],
                "project_id": f.get("project", {}).get("id", ""),
                "summary": f.get("summary", ""),
                "description": f.get("description"),
                "status": (f.get("status") or {}).get("name"),
                "priority": (f.get("priority") or {}).get("name"),
                "assignee": (f.get("assignee") or {}).get("displayName"),
                "reporter": (f.get("reporter") or {}).get("displayName"),
                "issue_type": (f.get("issuetype") or {}).get("name"),
                "resolution": (f.get("resolution") or {}).get("name"),
                "labels": _safe_json(f.get("labels")),
                "components": _safe_json(
                    [c["name"] for c in (f.get("components") or []) if "name" in c]
                ),
                "fix_versions": _safe_json(
                    [v["name"] for v in (f.get("fixVersions") or []) if "name" in v]
                ),
                "sprint": _extract_sprint(f),
                "parent_key": (f.get("parent") or {}).get("key"),
                "due_date": f.get("duedate"),
                "created_date": f.get("created"),
                "updated_date": f.get("updated"),
                "raw_data": json.dumps(issue, ensure_ascii=False),
            })
        df = pd.DataFrame(rows)
        if not df.empty:
            df = df[ISSUES_TABLE_COLUMNS]
        logger.info("Transformed %d issues", len(df))
        return df


class ChangeHistoryTransformer:
    """Jira API レスポンスから変更履歴を抽出"""

    @staticmethod
    def transform(raw_issues: list[dict]) -> pd.DataFrame:
        """raw_issues → change_history DataFrame"""
        rows = []
        for issue in raw_issues:
            changelog = issue.get("changelog", {})
            for history in changelog.get("histories", []):
                for item in history.get("items", []):
                    rows.append({
                        "issue_id": issue["id"],
                        "issue_key": issue["key"],
                        "history_id": history.get("id", ""),
                        "author_account_id": history.get("author", {}).get("accountId"),
                        "author_display_name": history.get("author", {}).get("displayName"),
                        "field": item.get("field", ""),
                        "field_type": item.get("fieldtype"),
                        "from_value": item.get("from"),
                        "from_string": item.get("fromString"),
                        "to_value": item.get("to"),
                        "to_string": item.get("toString"),
                        "changed_at": history.get("created", ""),
                    })
        df = pd.DataFrame(rows)
        logger.info("Extracted %d change history records", len(df))
        return df
