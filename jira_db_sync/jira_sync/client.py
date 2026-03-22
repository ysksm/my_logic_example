"""Jira REST API クライアント

責務:
- Jira API への認証付きリクエスト
- ページネーション付き全件取得
- プロジェクト一覧、フィールド定義、メタデータの取得
"""

import logging
import time
from base64 import b64encode
from typing import Callable

import requests

logger = logging.getLogger(__name__)


class JiraClient:
    """Jira REST API v3 クライアント"""

    def __init__(self, base_url: str, username: str, api_token: str):
        self.base_url = base_url.rstrip("/")
        credentials = f"{username}:{api_token}"
        self._headers = {
            "Authorization": f"Basic {b64encode(credentials.encode()).decode()}",
            "Accept": "application/json",
        }

    def get(self, path: str, params: dict | None = None, max_retries: int = 3) -> dict:
        """Jira REST API への GET リクエスト（リトライ付き）"""
        url = f"{self.base_url}/rest/api/3/{path}"
        for attempt in range(max_retries + 1):
            resp = requests.get(url, headers=self._headers, params=params, timeout=30)
            if resp.status_code == 429:
                wait = int(resp.headers.get("Retry-After", 2 ** (attempt + 1)))
                logger.warning("Rate limited, waiting %ds", wait)
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.json()
        resp.raise_for_status()
        return {}

    def fetch_projects(self) -> list[dict]:
        """プロジェクト一覧を取得"""
        return self.get("project")

    def fetch_fields(self) -> list[dict]:
        """フィールド定義を取得"""
        return self.get("field")

    def fetch_project_statuses(self, project_key: str) -> list[dict]:
        """プロジェクトのステータス一覧を取得（重複除去済み）"""
        raw = self.get(f"project/{project_key}/statuses")
        seen = set()
        statuses = []
        for issue_type in raw:
            for s in issue_type.get("statuses", []):
                name = s["name"]
                if name not in seen:
                    seen.add(name)
                    statuses.append({
                        "name": name,
                        "description": s.get("description", ""),
                        "category": s.get("statusCategory", {}).get("key", ""),
                    })
        return statuses

    def fetch_priorities(self) -> list[dict]:
        """優先度一覧を取得"""
        return self.get("priority")

    def fetch_issue_types(self, project_id: str) -> list[dict]:
        """課題タイプ一覧を取得"""
        raw = self.get(f"issuetype/project?projectId={project_id}")
        return raw if isinstance(raw, list) else []

    def fetch_all_issues(
        self,
        jql: str,
        on_progress: Callable[[int, int], None] | None = None,
    ) -> list[dict]:
        """search/jql + nextPageToken で全件取得

        Step 1: fields=key のみで全 key を高速取得
        Step 2: バッチごとに changelog 付きで再取得
        """
        # Step 1: 全 issue key を取得
        all_keys = []
        page_token = None
        while True:
            params = {"jql": jql, "fields": "key", "maxResults": "1000"}
            if page_token:
                params["nextPageToken"] = page_token
            data = self.get("search/jql", params=params)
            for iss in data.get("issues", []):
                all_keys.append(iss["key"])
            next_token = data.get("nextPageToken")
            is_last = data.get("isLast", True)
            if (is_last is True or is_last is None) and not next_token:
                break
            if not next_token:
                break
            page_token = next_token

        total = len(all_keys)
        logger.info("Found %d issue keys", total)
        if on_progress:
            on_progress(0, total)

        # Step 2: バッチごとに changelog 付きで取得
        all_issues = []
        batch_size = 50
        for i in range(0, total, batch_size):
            batch_keys = all_keys[i : i + batch_size]
            keys_jql = f"key in ({','.join(batch_keys)}) ORDER BY updated ASC"
            page_token = None
            while True:
                params = {
                    "jql": keys_jql,
                    "fields": "*navigable,created,updated",
                    "expand": "changelog",
                    "maxResults": str(batch_size),
                }
                if page_token:
                    params["nextPageToken"] = page_token
                data = self.get("search/jql", params=params)
                all_issues.extend(data.get("issues", []))
                next_token = data.get("nextPageToken")
                is_last = data.get("isLast", True)
                if (is_last is True or is_last is None) and not next_token:
                    break
                if not next_token:
                    break
                page_token = next_token
            if on_progress:
                on_progress(len(all_issues), total)

        logger.info("Fetched %d issues with changelog", len(all_issues))
        return all_issues
