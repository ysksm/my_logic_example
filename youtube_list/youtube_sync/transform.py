"""データ変換

責務:
- YouTube API レスポンスから channels_df / videos_df への変換
- サムネイル URL の優先度付き抽出
"""

import json
import logging

import pandas as pd

logger = logging.getLogger(__name__)

CHANNELS_TABLE_COLUMNS = [
    "id", "title", "description", "custom_url", "thumbnail_url",
    "published_at", "country", "subscriber_count", "video_count",
    "view_count", "raw_data",
]

VIDEOS_TABLE_COLUMNS = [
    "id", "channel_id", "title", "description", "thumbnail_url",
    "published_at", "channel_title", "view_count", "like_count",
    "comment_count", "raw_data",
]

COMMENTS_TABLE_COLUMNS = [
    "id", "video_id", "parent_id", "author", "author_channel_id",
    "text", "like_count", "published_at", "updated_at", "raw_data",
]


def _best_thumbnail(thumbnails: dict) -> str:
    """サムネイル URL を高解像度優先で取得"""
    for key in ("maxres", "high", "medium", "default"):
        t = thumbnails.get(key)
        if t and isinstance(t, dict) and t.get("url"):
            return t["url"]
    return ""


class ChannelTransformer:
    """YouTube API チャンネルレスポンスを DataFrame に変換"""

    @staticmethod
    def transform(raw_channels: list[dict]) -> pd.DataFrame:
        rows = []
        for ch in raw_channels:
            snippet = ch.get("snippet", {})
            stats = ch.get("statistics", {})
            rows.append({
                "id": ch["id"],
                "title": snippet.get("title", ""),
                "description": snippet.get("description", ""),
                "custom_url": snippet.get("customUrl", ""),
                "thumbnail_url": _best_thumbnail(snippet.get("thumbnails", {})),
                "published_at": snippet.get("publishedAt", ""),
                "country": snippet.get("country", ""),
                "subscriber_count": int(stats.get("subscriberCount", 0) or 0),
                "video_count": int(stats.get("videoCount", 0) or 0),
                "view_count": int(stats.get("viewCount", 0) or 0),
                "raw_data": json.dumps(ch, ensure_ascii=False),
            })
        df = pd.DataFrame(rows)
        if not df.empty:
            df = df[CHANNELS_TABLE_COLUMNS]
        logger.info("Transformed %d channels", len(df))
        return df


class VideoTransformer:
    """YouTube API 動画レスポンスを DataFrame に変換"""

    @staticmethod
    def transform(raw_videos: list[dict], channel_id: str | None = None) -> pd.DataFrame:
        rows = []
        for v in raw_videos:
            snippet = v.get("snippet", {})
            stats = v.get("statistics", {})
            rows.append({
                "id": v["id"],
                "channel_id": snippet.get("channelId", channel_id or ""),
                "title": snippet.get("title", ""),
                "description": snippet.get("description", ""),
                "thumbnail_url": _best_thumbnail(snippet.get("thumbnails", {})),
                "published_at": snippet.get("publishedAt", ""),
                "channel_title": snippet.get("channelTitle", ""),
                "view_count": int(stats.get("viewCount", 0) or 0),
                "like_count": int(stats.get("likeCount", 0) or 0),
                "comment_count": int(stats.get("commentCount", 0) or 0),
                "raw_data": json.dumps(v, ensure_ascii=False),
            })
        df = pd.DataFrame(rows)
        if not df.empty:
            df = df[VIDEOS_TABLE_COLUMNS]
        logger.info("Transformed %d videos", len(df))
        return df


def _comment_row(comment: dict, video_id: str, parent_id: str | None) -> dict:
    """commentThreads / replies の comment リソースから 1 行を作る"""
    snippet = comment.get("snippet", {})
    author_ch = snippet.get("authorChannelId", {})
    if isinstance(author_ch, dict):
        author_channel_id = author_ch.get("value", "")
    else:
        author_channel_id = str(author_ch or "")
    return {
        "id": comment.get("id", ""),
        "video_id": video_id,
        "parent_id": parent_id,
        "author": snippet.get("authorDisplayName", ""),
        "author_channel_id": author_channel_id,
        "text": snippet.get("textDisplay", "") or snippet.get("textOriginal", ""),
        "like_count": int(snippet.get("likeCount", 0) or 0),
        "published_at": snippet.get("publishedAt", ""),
        "updated_at": snippet.get("updatedAt", ""),
        "raw_data": json.dumps(comment, ensure_ascii=False),
    }


class CommentTransformer:
    """commentThreads レスポンスを DataFrame に変換（返信も平坦化）"""

    @staticmethod
    def transform(raw_threads: list[dict], video_id: str) -> pd.DataFrame:
        rows: list[dict] = []
        for thread in raw_threads:
            snippet = thread.get("snippet", {})
            top = snippet.get("topLevelComment")
            if top:
                rows.append(_comment_row(top, video_id, parent_id=None))
                top_id = top.get("id", "")
            else:
                top_id = ""
            replies = (thread.get("replies") or {}).get("comments", [])
            for r in replies:
                rows.append(_comment_row(r, video_id, parent_id=top_id))

        df = pd.DataFrame(rows)
        if not df.empty:
            df = df.drop_duplicates(subset=["id"])
            df = df[COMMENTS_TABLE_COLUMNS]
        logger.info("Transformed %d comments for %s", len(df), video_id)
        return df
