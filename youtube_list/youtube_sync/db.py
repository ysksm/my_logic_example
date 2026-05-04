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

    """CREATE TABLE IF NOT EXISTS comments (
        id VARCHAR PRIMARY KEY,
        video_id VARCHAR NOT NULL,
        parent_id VARCHAR,
        author VARCHAR,
        author_channel_id VARCHAR,
        text TEXT,
        like_count BIGINT DEFAULT 0,
        published_at VARCHAR,
        updated_at VARCHAR,
        raw_data JSON,
        synced_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (video_id) REFERENCES videos(id))""",

    """CREATE TABLE IF NOT EXISTS transcripts (
        video_id VARCHAR NOT NULL,
        language VARCHAR NOT NULL,
        is_generated BOOLEAN DEFAULT FALSE,
        text TEXT,
        segments JSON,
        synced_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (video_id, language),
        FOREIGN KEY (video_id) REFERENCES videos(id))""",

    """CREATE TABLE IF NOT EXISTS thumbnails (
        entity_type VARCHAR NOT NULL,
        entity_id VARCHAR NOT NULL,
        url VARCHAR,
        content BLOB,
        content_type VARCHAR,
        byte_size BIGINT DEFAULT 0,
        fetched_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (entity_type, entity_id))""",

    "CREATE SEQUENCE IF NOT EXISTS channel_history_seq START 1",
    "CREATE SEQUENCE IF NOT EXISTS video_history_seq START 1",
    "CREATE SEQUENCE IF NOT EXISTS sync_history_seq START 1",

    "CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos(channel_id)",
    "CREATE INDEX IF NOT EXISTS idx_ch_hist_channel ON channel_history(channel_id)",
    "CREATE INDEX IF NOT EXISTS idx_vh_video ON video_history(video_id)",
    "CREATE INDEX IF NOT EXISTS idx_comments_video ON comments(video_id)",
    "CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id)",
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
        """チャンネルを UPSERT（子テーブルの外部キーを先に削除）"""
        if channels_df.empty:
            return
        self.conn.execute(
            "CREATE OR REPLACE TEMP TABLE tmp_ch AS SELECT * FROM channels_df"
        )
        # 子テーブルを先に削除（外部キー制約対策）
        self.conn.execute("DELETE FROM comments WHERE video_id IN (SELECT id FROM videos WHERE channel_id IN (SELECT id FROM tmp_ch))")
        self.conn.execute("DELETE FROM transcripts WHERE video_id IN (SELECT id FROM videos WHERE channel_id IN (SELECT id FROM tmp_ch))")
        self.conn.execute("DELETE FROM thumbnails WHERE entity_type = 'video' AND entity_id IN (SELECT id FROM videos WHERE channel_id IN (SELECT id FROM tmp_ch))")
        self.conn.execute("DELETE FROM video_history WHERE video_id IN (SELECT id FROM videos WHERE channel_id IN (SELECT id FROM tmp_ch))")
        self.conn.execute("DELETE FROM videos WHERE channel_id IN (SELECT id FROM tmp_ch)")
        self.conn.execute("DELETE FROM thumbnails WHERE entity_type = 'channel' AND entity_id IN (SELECT id FROM tmp_ch)")
        self.conn.execute("DELETE FROM channel_history WHERE channel_id IN (SELECT id FROM tmp_ch)")
        self.conn.execute("DELETE FROM channels WHERE id IN (SELECT id FROM tmp_ch)")
        self.conn.execute(
            "INSERT INTO channels SELECT *, CURRENT_TIMESTAMP FROM tmp_ch"
        )
        self.conn.execute("DROP TABLE IF EXISTS tmp_ch")
        logger.info("Upserted %d channels", len(channels_df))

    def upsert_videos(self, videos_df: pd.DataFrame, channel_id: str | None = None):
        """動画を UPSERT（video_history の外部キーを先に削除）

        channel_id を指定した場合、そのチャンネルの全動画を入れ替え。
        """
        if videos_df.empty:
            return
        if channel_id:
            # 子テーブルを先に削除
            self.conn.execute(
                "DELETE FROM comments WHERE video_id IN (SELECT id FROM videos WHERE channel_id = ?)",
                [channel_id],
            )
            self.conn.execute(
                "DELETE FROM transcripts WHERE video_id IN (SELECT id FROM videos WHERE channel_id = ?)",
                [channel_id],
            )
            self.conn.execute(
                "DELETE FROM thumbnails WHERE entity_type = 'video' AND entity_id IN (SELECT id FROM videos WHERE channel_id = ?)",
                [channel_id],
            )
            self.conn.execute(
                "DELETE FROM video_history WHERE video_id IN (SELECT id FROM videos WHERE channel_id = ?)",
                [channel_id],
            )
            self.conn.execute(
                "DELETE FROM videos WHERE channel_id = ?", [channel_id]
            )
        else:
            self.conn.execute(
                "CREATE OR REPLACE TEMP TABLE tmp_vid_ids AS SELECT id FROM videos_df"
            )
            self.conn.execute(
                "DELETE FROM comments WHERE video_id IN (SELECT id FROM tmp_vid_ids)"
            )
            self.conn.execute(
                "DELETE FROM transcripts WHERE video_id IN (SELECT id FROM tmp_vid_ids)"
            )
            self.conn.execute(
                "DELETE FROM thumbnails WHERE entity_type = 'video' AND entity_id IN (SELECT id FROM tmp_vid_ids)"
            )
            self.conn.execute(
                "DELETE FROM video_history WHERE video_id IN (SELECT id FROM tmp_vid_ids)"
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

    def upsert_comments(self, comments_df: pd.DataFrame, video_id: str):
        """コメントを UPSERT（指定動画のコメントを入れ替え）"""
        self.conn.execute("DELETE FROM comments WHERE video_id = ?", [video_id])
        if comments_df.empty:
            return
        self.conn.execute(
            "CREATE OR REPLACE TEMP TABLE tmp_com AS SELECT * FROM comments_df"
        )
        self.conn.execute(
            "INSERT INTO comments SELECT *, CURRENT_TIMESTAMP FROM tmp_com"
        )
        self.conn.execute("DROP TABLE IF EXISTS tmp_com")
        logger.info("Upserted %d comments for %s", len(comments_df), video_id)

    def upsert_thumbnail(self, entity_type: str, entity_id: str, url: str,
                         content: bytes, content_type: str):
        """サムネ画像（BLOB）を UPSERT"""
        self.conn.execute(
            "DELETE FROM thumbnails WHERE entity_type = ? AND entity_id = ?",
            [entity_type, entity_id],
        )
        self.conn.execute(
            "INSERT INTO thumbnails VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
            [entity_type, entity_id, url, content, content_type, len(content)],
        )
        logger.info("Upserted thumbnail %s/%s (%d bytes)", entity_type, entity_id, len(content))

    def upsert_transcript(self, video_id: str, language: str, is_generated: bool,
                          text: str, segments_json: str):
        """文字起こしを UPSERT（動画 ID + 言語で一意）"""
        self.conn.execute(
            "DELETE FROM transcripts WHERE video_id = ? AND language = ?",
            [video_id, language],
        )
        self.conn.execute(
            "INSERT INTO transcripts VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
            [video_id, language, is_generated, text, segments_json],
        )
        logger.info("Upserted transcript %s/%s (%d chars)", video_id, language, len(text))

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
            "SELECT "
            "(SELECT COUNT(*) FROM channels) AS channels, "
            "(SELECT COUNT(*) FROM videos) AS videos, "
            "(SELECT COUNT(*) FROM comments) AS comments, "
            "(SELECT COUNT(*) FROM transcripts) AS transcripts, "
            "(SELECT COUNT(*) FROM thumbnails) AS thumbnails"
        ).fetchone()
        return {
            "channels": row[0],
            "videos": row[1],
            "comments": row[2],
            "transcripts": row[3],
            "thumbnails": row[4],
        }

    def get_channel_ids(self) -> list[str]:
        """登録済みチャンネル ID 一覧を取得"""
        rows = self.conn.execute("SELECT id FROM channels ORDER BY title").fetchall()
        return [r[0] for r in rows]

    def get_video_ids_without_comments(self, channel_id: str | None = None,
                                       limit: int = 0) -> list[str]:
        """コメント未取得の動画 ID を返す"""
        sql = (
            "SELECT v.id FROM videos v "
            "WHERE NOT EXISTS (SELECT 1 FROM comments c WHERE c.video_id = v.id) "
            "AND v.comment_count > 0"
        )
        params: list = []
        if channel_id:
            sql += " AND v.channel_id = ?"
            params.append(channel_id)
        sql += " ORDER BY v.published_at DESC"
        if limit > 0:
            sql += f" LIMIT {int(limit)}"
        return [r[0] for r in self.conn.execute(sql, params).fetchall()]

    def get_entities_without_thumbnail(self, entity_type: str,
                                       channel_id: str | None = None,
                                       limit: int = 0) -> list[tuple[str, str]]:
        """サムネ画像未取得の entity を (id, url) で返す

        entity_type: 'channel' | 'video'
        """
        if entity_type == "channel":
            sql = (
                "SELECT c.id, c.thumbnail_url FROM channels c "
                "WHERE c.thumbnail_url <> '' "
                "AND NOT EXISTS ("
                "  SELECT 1 FROM thumbnails t "
                "  WHERE t.entity_type = 'channel' AND t.entity_id = c.id"
                ")"
            )
            params: list = []
            if channel_id:
                sql += " AND c.id = ?"
                params.append(channel_id)
            sql += " ORDER BY c.title"
        elif entity_type == "video":
            sql = (
                "SELECT v.id, v.thumbnail_url FROM videos v "
                "WHERE v.thumbnail_url <> '' "
                "AND NOT EXISTS ("
                "  SELECT 1 FROM thumbnails t "
                "  WHERE t.entity_type = 'video' AND t.entity_id = v.id"
                ")"
            )
            params = []
            if channel_id:
                sql += " AND v.channel_id = ?"
                params.append(channel_id)
            sql += " ORDER BY v.published_at DESC"
        else:
            raise ValueError(f"無効な entity_type: {entity_type}")
        if limit > 0:
            sql += f" LIMIT {int(limit)}"
        return [(r[0], r[1]) for r in self.conn.execute(sql, params).fetchall()]

    def get_video_ids_without_transcript(self, channel_id: str | None = None,
                                         language: str = "ja",
                                         limit: int = 0) -> list[str]:
        """指定言語の文字起こし未取得の動画 ID を返す"""
        sql = (
            "SELECT v.id FROM videos v "
            "WHERE NOT EXISTS ("
            "  SELECT 1 FROM transcripts t "
            "  WHERE t.video_id = v.id AND t.language = ?"
            ")"
        )
        params: list = [language]
        if channel_id:
            sql += " AND v.channel_id = ?"
            params.append(channel_id)
        sql += " ORDER BY v.published_at DESC"
        if limit > 0:
            sql += f" LIMIT {int(limit)}"
        return [r[0] for r in self.conn.execute(sql, params).fetchall()]
