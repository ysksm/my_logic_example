"""YouTube Data API v3 クライアント

責務:
- YouTube API への認証付きリクエスト
- チャンネル情報・動画一覧の取得
- URL からのチャンネル ID 解決
"""

import logging
import re
import time
from typing import Callable

import requests

logger = logging.getLogger(__name__)


class YouTubeClient:
    """YouTube Data API v3 クライアント"""

    BASE_URL = "https://www.googleapis.com/youtube/v3"

    def __init__(self, api_key: str, on_log: Callable[[str], None] | None = None):
        self.api_key = api_key
        self.on_log = on_log

    def _log(self, msg: str):
        logger.info(msg)
        if self.on_log:
            self.on_log(msg)

    def _get(self, endpoint: str, params: dict | None = None, max_retries: int = 3) -> dict:
        """YouTube API への GET リクエスト（リトライ付き）"""
        url = f"{self.BASE_URL}/{endpoint}"
        params = dict(params or {})
        params["key"] = self.api_key

        _log_params = {k: v for k, v in params.items() if k != "key"}
        self._log(f"  API → {endpoint} {_log_params}")

        for attempt in range(max_retries + 1):
            t0 = time.time()
            try:
                resp = requests.get(url, params=params, timeout=30)
            except requests.exceptions.ConnectionError as e:
                raise RuntimeError(f"接続エラー ({endpoint}): {e}") from e
            except requests.exceptions.Timeout:
                raise RuntimeError(f"タイムアウト (30秒超過, {endpoint})")
            elapsed = time.time() - t0

            if resp.status_code == 429:
                wait = int(resp.headers.get("Retry-After", 2 ** (attempt + 1)))
                self._log(f"  API ← 429 Rate Limited ({elapsed:.1f}s) → {wait}秒待機 (リトライ {attempt + 1}/{max_retries})")
                time.sleep(wait)
                continue

            if resp.status_code == 403:
                body = self._safe_json(resp)
                error_msg = body.get("error", {}).get("message", resp.text[:200])
                raise RuntimeError(f"API アクセス拒否 ({endpoint}): {error_msg}")

            if resp.status_code >= 400:
                body = self._safe_json(resp)
                error_msg = body.get("error", {}).get("message", resp.text[:200])
                raise RuntimeError(
                    f"API エラー ({endpoint}): HTTP {resp.status_code} - {error_msg}"
                )

            data = resp.json()
            n_items = len(data.get("items", []))
            self._log(f"  API ← {endpoint} {n_items} 件 ({elapsed:.1f}s)")
            return data

        raise RuntimeError(f"API リトライ上限 ({endpoint}): {max_retries + 1} 回失敗")

    @staticmethod
    def _safe_json(resp: requests.Response) -> dict:
        try:
            return resp.json()
        except Exception:
            return {}

    # ── URL パース ──────────────────────────────────────

    @staticmethod
    def extract_channel_identifier(url: str) -> str:
        """YouTube URL からチャンネル識別子を抽出

        対応フォーマット:
        - youtube.com/channel/UCxxxx  → チャンネル ID
        - youtube.com/user/username   → ユーザー名
        - youtube.com/c/customname    → カスタム名
        - youtube.com/@handle         → ハンドル名
        """
        patterns = [
            (r"youtube\.com/channel/([^/?&]+)", "channel_id"),
            (r"youtube\.com/user/([^/?&]+)", "user"),
            (r"youtube\.com/c/([^/?&]+)", "custom"),
            (r"youtube\.com/@([^/?&]+)", "handle"),
        ]
        for pattern, kind in patterns:
            m = re.search(pattern, url)
            if m:
                return m.group(1) if kind == "channel_id" else f"@{m.group(1)}"

        # URL ではなく直接 ID やハンドルが渡された場合
        if url.startswith("UC") and len(url) == 24:
            return url
        if url.startswith("@"):
            return url

        raise ValueError(f"無効な YouTube URL: {url}")

    def resolve_channel_id(self, identifier: str) -> str:
        """識別子をチャンネル ID に解決

        UC で始まる 24 文字はそのまま返す。
        それ以外は channels API の forHandle または search で解決。
        """
        if identifier.startswith("UC") and len(identifier) == 24:
            logger.info("識別子はチャンネル ID: %s", identifier)
            return identifier

        handle = identifier.lstrip("@")
        logger.info("ハンドル '%s' からチャンネル ID を解決中...", handle)

        # forHandle パラメータで直接解決
        data = self._get("channels", {"part": "id", "forHandle": handle})
        items = data.get("items", [])
        if items:
            ch_id = items[0]["id"]
            logger.info("forHandle で解決: %s -> %s", handle, ch_id)
            return ch_id

        # フォールバック: search API
        logger.info("forHandle で見つからず、search API にフォールバック")
        data = self._get("search", {
            "part": "snippet",
            "q": handle,
            "type": "channel",
            "maxResults": "1",
        })
        items = data.get("items", [])
        if items:
            channel_id = items[0].get("snippet", {}).get("channelId")
            if channel_id:
                logger.info("search で解決: %s -> %s", handle, channel_id)
                return channel_id

        raise ValueError(f"チャンネルが見つかりません: {identifier}")

    # ── チャンネル情報 ─────────────────────────────────

    def fetch_channel(self, channel_id: str) -> dict:
        """チャンネル情報を取得 (snippet, statistics)"""
        data = self._get("channels", {
            "part": "snippet,statistics",
            "id": channel_id,
        })
        items = data.get("items", [])
        if not items:
            raise ValueError(f"チャンネルが見つかりません: {channel_id}")
        return items[0]

    def fetch_channels(self, channel_ids: list[str]) -> list[dict]:
        """複数チャンネルの情報をバッチ取得 (最大 50 件ずつ)"""
        all_items = []
        for i in range(0, len(channel_ids), 50):
            batch = channel_ids[i:i + 50]
            data = self._get("channels", {
                "part": "snippet,statistics",
                "id": ",".join(batch),
            })
            all_items.extend(data.get("items", []))
        return all_items

    # ── 動画取得 ───────────────────────────────────────

    def fetch_channel_video_ids(self, channel_id: str, max_results: int = 0) -> list[str]:
        """チャンネルの動画 ID を search API で取得

        max_results=0 で全件取得。
        """
        video_ids = []
        page_token = None
        page = 0

        while True:
            page += 1
            per_page = 50
            if max_results > 0:
                remaining = max_results - len(video_ids)
                if remaining <= 0:
                    break
                per_page = min(50, remaining)

            params = {
                "part": "id",
                "channelId": channel_id,
                "maxResults": str(per_page),
                "order": "date",
                "type": "video",
            }
            if page_token:
                params["pageToken"] = page_token

            data = self._get("search", params)
            for item in data.get("items", []):
                vid = item.get("id", {})
                if isinstance(vid, dict) and vid.get("videoId"):
                    video_ids.append(vid["videoId"])

            self._log(f"  動画ID検索 ページ{page}: 累計 {len(video_ids)} 件")

            page_token = data.get("nextPageToken")
            if not page_token:
                break

        if max_results > 0:
            return video_ids[:max_results]
        return video_ids

    def fetch_videos(self, video_ids: list[str]) -> list[dict]:
        """動画の詳細情報をバッチ取得 (snippet, statistics)"""
        all_items = []
        total_batches = (len(video_ids) + 49) // 50
        for i in range(0, len(video_ids), 50):
            batch_num = i // 50 + 1
            batch = video_ids[i:i + 50]
            self._log(f"  動画詳細取得 バッチ{batch_num}/{total_batches} ({len(batch)} 件)")
            data = self._get("videos", {
                "part": "snippet,statistics",
                "id": ",".join(batch),
            })
            all_items.extend(data.get("items", []))
        return all_items

    def fetch_channel_videos(self, channel_id: str, max_results: int = 0) -> list[dict]:
        """チャンネルの動画を取得（search → videos の 2 ステップ）

        max_results=0 で全件取得。
        """
        _label = f"最大 {max_results} 件" if max_results > 0 else "全件"
        self._log(f"  Step 1: search API で動画ID取得 ({_label})")
        video_ids = self.fetch_channel_video_ids(channel_id, max_results)
        if not video_ids:
            self._log("  動画が見つかりませんでした")
            return []
        self._log(f"  Step 2: videos API で詳細取得 ({len(video_ids)} 件)")
        return self.fetch_videos(video_ids)

    # ── サムネ画像取得 ─────────────────────────────────

    def fetch_thumbnail_image(self, url: str) -> tuple[bytes, str]:
        """サムネ画像 URL からバイナリと Content-Type を取得"""
        if not url:
            raise ValueError("空の URL")
        try:
            resp = requests.get(url, timeout=30)
        except requests.exceptions.ConnectionError as e:
            raise RuntimeError(f"サムネ取得 接続エラー: {e}") from e
        except requests.exceptions.Timeout:
            raise RuntimeError("サムネ取得 タイムアウト (30秒超過)")
        if resp.status_code >= 400:
            raise RuntimeError(f"サムネ取得 HTTP {resp.status_code}: {url}")
        content_type = resp.headers.get("Content-Type", "image/jpeg").split(";")[0].strip()
        return resp.content, content_type

    # ── コメント取得 ───────────────────────────────────

    def fetch_comments(
        self,
        video_id: str,
        max_results: int = 100,
        include_replies: bool = True,
    ) -> list[dict]:
        """動画のコメント（トップレベル + 任意で返信）を取得

        max_results=0 で全件取得。コメント無効動画は空リストを返す。
        """
        threads: list[dict] = []
        page_token: str | None = None
        page = 0

        while True:
            page += 1
            per_page = 100
            if max_results > 0:
                remaining = max_results - len(threads)
                if remaining <= 0:
                    break
                per_page = min(100, remaining)

            params = {
                "part": "snippet,replies" if include_replies else "snippet",
                "videoId": video_id,
                "maxResults": str(per_page),
                "order": "time",
                "textFormat": "plainText",
            }
            if page_token:
                params["pageToken"] = page_token

            try:
                data = self._get("commentThreads", params)
            except RuntimeError as e:
                msg = str(e)
                # コメント無効 / 見つからない動画はスキップ
                if "commentsDisabled" in msg or "videoNotFound" in msg:
                    self._log(f"  コメント取得不可 ({video_id}): {msg}")
                    return []
                raise

            threads.extend(data.get("items", []))
            self._log(f"  コメント取得 ページ{page}: 累計 {len(threads)} スレッド")

            page_token = data.get("nextPageToken")
            if not page_token:
                break

        if max_results > 0:
            return threads[:max_results]
        return threads
