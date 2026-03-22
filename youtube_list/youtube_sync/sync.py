"""同期サービス

責務:
- チャンネル追加 / 全件同期 / 更新同期の制御
- チェックポイント管理（sync_state.json）
- 同期フロー全体のオーケストレーション
"""

import json
import logging
import os
from datetime import datetime, timezone
from typing import Callable

from youtube_sync.client import YouTubeClient
from youtube_sync.db import Database
from youtube_sync.transform import ChannelTransformer, VideoTransformer

logger = logging.getLogger(__name__)


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

    def get_last_sync(self) -> dict | None:
        return self._load().get("last_sync")

    def complete_sync(self, completed_at: str, channels_synced: int,
                      videos_synced: int, sync_type: str):
        state = self._load()
        state["last_sync"] = {
            "completed_at": completed_at,
            "channels_synced": channels_synced,
            "videos_synced": videos_synced,
            "sync_type": sync_type,
        }
        self._save(state)


class SyncService:
    """同期オーケストレーター"""

    def __init__(self, client: YouTubeClient, db: Database, sync_state: SyncState):
        self.client = client
        self.db = db
        self.sync_state = sync_state

    def add_channel(
        self,
        url_or_id: str,
        max_videos: int = 50,
        on_log: Callable[[str], None] | None = None,
    ) -> dict:
        """URL またはチャンネル ID からチャンネルを追加"""
        def _log(msg: str):
            logger.info(msg)
            if on_log:
                on_log(msg)

        # API クライアントにもログコールバックを設定
        self.client.on_log = on_log

        _log(f"入力を解析中: {url_or_id}")
        try:
            identifier = self.client.extract_channel_identifier(url_or_id)
        except ValueError as e:
            raise ValueError(f"URL/ID の解析に失敗: {e}") from e
        _log(f"識別子: {identifier}")

        _log("チャンネル ID を解決中...")
        try:
            channel_id = self.client.resolve_channel_id(identifier)
        except (ValueError, RuntimeError) as e:
            raise RuntimeError(f"チャンネル ID の解決に失敗: {e}") from e
        _log(f"チャンネル ID: {channel_id}")

        _log("チャンネル情報を取得中...")
        raw_channel = self.client.fetch_channel(channel_id)
        title = raw_channel.get("snippet", {}).get("title", channel_id)
        _log(f"チャンネル取得完了: {title}")

        channels_df = ChannelTransformer.transform([raw_channel])
        self.db.upsert_channels(channels_df)
        self.db.record_channel_history(channels_df)
        _log("チャンネル情報を DB に保存しました")

        _log(f"動画を取得中 (最大 {max_videos} 件)...")
        raw_videos = self.client.fetch_channel_videos(channel_id, max_videos)
        _log(f"動画 {len(raw_videos)} 件を取得しました")

        videos_df = VideoTransformer.transform(raw_videos, channel_id)
        self.db.upsert_videos(videos_df, channel_id)
        self.db.record_video_history(videos_df)
        _log(f"動画 {len(videos_df)} 件を DB に保存しました")

        return {
            "channel_id": channel_id,
            "title": channels_df.iloc[0]["title"],
            "videos_fetched": len(videos_df),
        }

    def sync_all(
        self,
        max_videos: int = 50,
        on_log: Callable[[str], None] | None = None,
    ) -> dict:
        """登録済み全チャンネルを同期"""
        def _log(msg: str):
            logger.info(msg)
            if on_log:
                on_log(msg)

        # API クライアントにもログコールバックを設定
        self.client.on_log = on_log

        started_at = datetime.now(timezone.utc).isoformat()
        channel_ids = self.db.get_channel_ids()
        total = len(channel_ids)
        _log(f"同期開始: {total} チャンネル")

        if not channel_ids:
            _log("登録チャンネルがありません")
            return {"mode": "full", "channels": 0, "videos": 0,
                    "errors": [], "summary": self.db.get_summary()}

        total_videos = 0
        errors = []
        for i, ch_id in enumerate(channel_ids):
            _log(f"[{i + 1}/{total}] チャンネル {ch_id} を同期中...")

            try:
                raw_channel = self.client.fetch_channel(ch_id)
                title = raw_channel.get("snippet", {}).get("title", ch_id)
                channels_df = ChannelTransformer.transform([raw_channel])
                self.db.upsert_channels(channels_df)
                self.db.record_channel_history(channels_df)

                raw_videos = self.client.fetch_channel_videos(ch_id, max_videos)
                videos_df = VideoTransformer.transform(raw_videos, ch_id)
                self.db.upsert_videos(videos_df, ch_id)
                self.db.record_video_history(videos_df)
                total_videos += len(videos_df)
                _log(f"[{i + 1}/{total}] {title}: 動画 {len(videos_df)} 件")
            except Exception as e:
                err_msg = f"[{i + 1}/{total}] {ch_id}: エラー - {e}"
                _log(err_msg)
                errors.append(err_msg)
                continue

        completed_at = datetime.now(timezone.utc).isoformat()
        self.db.record_sync("full", started_at, completed_at, total, total_videos)
        self.sync_state.complete_sync(completed_at, total, total_videos, "full")

        summary = self.db.get_summary()
        _log(f"同期完了: {summary['channels']} チャンネル, {summary['videos']} 動画")
        if errors:
            _log(f"エラー: {len(errors)} 件")
        return {
            "mode": "full",
            "channels": total,
            "videos": total_videos,
            "errors": errors,
            "summary": summary,
        }
