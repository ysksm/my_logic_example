"""DuckDB データベース管理

責務:
- DB 接続とスキーマ初期化
- データの UPSERT（channels, videos, history）
- sync_history の管理
"""

import logging
import os

import duckdb
import pandas as pd

logger = logging.getLogger(__name__)

_DDL = [
    """CREATE TABLE IF NOT EXISTS channels (
        id VARCHAR PRIMARY KEY,
        title VARCHAR NOT NULL,
        description TEXT,
        custom_url VARCHAR,
        thumbnail_url VARCHAR,
        published_at VARCHAR,
        country VARCHAR,
        subscriber_count BIGINT DEFAULT 0,
        video_count INTEGER DEFAULT 0,
        view_count BIGINT DEFAULT 0,
        raw_data JSON,
        synced_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)""",

    """CREATE TABLE IF NOT EXISTS videos (
        id VARCHAR PRIMARY KEY,
        channel_id VARCHAR NOT NULL,
        title VARCHAR NOT NULL,
        description TEXT,
        thumbnail_url VARCHAR,
        published_at VARCHAR,
        channel_title VARCHAR,
        view_count BIGINT DEFAULT 0,
        like_count BIGINT DEFAULT 0,
        comment_count BIGINT DEFAULT 0,
        raw_data JSON,
        synced_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (channel_id) REFERENCES channels(id))""",

    """CREATE TABLE IF NOT EXISTS channel_history (
        id INTEGER PRIMARY KEY,
        channel_id VARCHAR NOT NULL,
        subscriber_count BIGINT DEFAULT 0,
        video_count INTEGER DEFAULT 0,
        view_count BIGINT DEFAULT 0,
        recorded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (channel_id) REFERENCES channels(id))""",

    """CREATE TABLE IF NOT EXISTS video_history (
        id INTEGER PRIMARY KEY,
        video_id VARCHAR NOT NULL,
        view_count BIGINT DEFAULT 0,
        like_count BIGINT DEFAULT 0,
        comment_count BIGINT DEFAULT 0,
        recorded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (video_id) REFERENCES videos(id))""",

    """CREATE TABLE IF NOT EXISTS sync_history (
        id INTEGER PRIMARY KEY,
        sync_type VARCHAR NOT NULL,
        started_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        status VARCHAR NOT NULL,
        channels_synced INTEGER DEFAULT 0,
        videos_synced INTEGER DEFAULT 0)""",

    "CREATE SEQUENCE IF NOT EXISTS channel_history_seq START 1",
    "CREATE SEQUENCE IF NOT EXISTS video_history_seq START 1",
    "CREATE SEQUENCE IF NOT EXISTS sync_history_seq START 1",

    "CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos(channel_id)",
    "CREATE INDEX IF NOT EXISTS idx_ch_hist_channel ON channel_history(channel_id)",
    "CREATE INDEX IF NOT EXISTS idx_vh_video ON video_history(video_id)",
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

    def upsert_channels(self, channels_df: pd.DataFrame):
        """チャンネルを UPSERT"""
        if channels_df.empty:
            return
        self.conn.execute(
            "CREATE OR REPLACE TEMP TABLE tmp_ch AS SELECT * FROM channels_df"
        )
        self.conn.execute("""
            DELETE FROM channels WHERE id IN (SELECT id FROM tmp_ch)
        """)
        self.conn.execute(
            "INSERT INTO channels SELECT *, CURRENT_TIMESTAMP FROM tmp_ch"
        )
        self.conn.execute("DROP TABLE IF EXISTS tmp_ch")
        logger.info("Upserted %d channels", len(channels_df))

    def upsert_videos(self, videos_df: pd.DataFrame, channel_id: str | None = None):
        """動画を UPSERT

        channel_id を指定した場合、そのチャンネルの全動画を入れ替え。
        """
        if videos_df.empty:
            return
        if channel_id:
            self.conn.execute(
                "DELETE FROM videos WHERE channel_id = ?", [channel_id]
            )
        else:
            self.conn.execute(
                "CREATE OR REPLACE TEMP TABLE tmp_vid_ids AS SELECT id FROM videos_df"
            )
            self.conn.execute(
                "DELETE FROM videos WHERE id IN (SELECT id FROM tmp_vid_ids)"
            )
            self.conn.execute("DROP TABLE IF EXISTS tmp_vid_ids")

        self.conn.execute(
            "CREATE OR REPLACE TEMP TABLE tmp_vid AS SELECT * FROM videos_df"
        )
        self.conn.execute(
            "INSERT INTO videos SELECT *, CURRENT_TIMESTAMP FROM tmp_vid"
        )
        self.conn.execute("DROP TABLE IF EXISTS tmp_vid")
        logger.info("Upserted %d videos", len(videos_df))

    def record_channel_history(self, channels_df: pd.DataFrame):
        """チャンネル統計の履歴を記録"""
        if channels_df.empty:
            return
        for _, row in channels_df.iterrows():
            self.conn.execute(
                """INSERT INTO channel_history VALUES (
                    nextval('channel_history_seq'), ?, ?, ?, ?, CURRENT_TIMESTAMP)""",
                [row["id"], int(row["subscriber_count"]),
                 int(row["video_count"]), int(row["view_count"])],
            )
        logger.info("Recorded %d channel history entries", len(channels_df))

    def record_video_history(self, videos_df: pd.DataFrame):
        """動画統計の履歴を記録"""
        if videos_df.empty:
            return
        for _, row in videos_df.iterrows():
            self.conn.execute(
                """INSERT INTO video_history VALUES (
                    nextval('video_history_seq'), ?, ?, ?, ?, CURRENT_TIMESTAMP)""",
                [row["id"], int(row["view_count"]),
                 int(row["like_count"]), int(row["comment_count"])],
            )
        logger.info("Recorded %d video history entries", len(videos_df))

    def record_sync(self, sync_type: str, started_at: str,
                    completed_at: str, channels_synced: int, videos_synced: int):
        """同期履歴を記録"""
        self.conn.execute(
            """INSERT INTO sync_history VALUES (
                nextval('sync_history_seq'), ?, ?, ?, 'completed', ?, ?)""",
            [sync_type, started_at, completed_at, channels_synced, videos_synced],
        )

    def get_summary(self) -> dict:
        """DB の概要を取得"""
        row = self.conn.execute(
            "SELECT COUNT(*) AS channels, "
            "(SELECT COUNT(*) FROM videos) AS videos "
            "FROM channels"
        ).fetchone()
        return {"channels": row[0], "videos": row[1]}

    def get_channel_ids(self) -> list[str]:
        """登録済みチャンネル ID 一覧を取得"""
        rows = self.conn.execute("SELECT id FROM channels ORDER BY title").fetchall()
        return [r[0] for r in rows]
