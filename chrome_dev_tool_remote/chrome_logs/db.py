"""DuckDB database for Chrome DevTools logs."""

from __future__ import annotations

import json
from pathlib import Path

import duckdb
import pandas as pd


class Database:
    """DuckDB wrapper for storing Chrome logs."""

    def __init__(self, db_path: str = "./data/chrome_logs.duckdb"):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = duckdb.connect(db_path)
        self._ensure_sequences()
        self._init_schema()

    def _ensure_sequences(self):
        for seq in ["console_log_seq", "network_req_seq", "page_error_seq"]:
            self.conn.execute(f"CREATE SEQUENCE IF NOT EXISTS {seq}")

    def _init_schema(self):
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS console_logs (
                id INTEGER PRIMARY KEY DEFAULT nextval('console_log_seq'),
                session_id TEXT NOT NULL,
                timestamp TIMESTAMPTZ DEFAULT now(),
                level TEXT,
                message TEXT,
                url TEXT,
                line_number INTEGER,
                column_number INTEGER,
                stack_trace TEXT,
                raw_data JSON
            )
        """)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS network_requests (
                id INTEGER PRIMARY KEY DEFAULT nextval('network_req_seq'),
                session_id TEXT NOT NULL,
                request_id TEXT,
                timestamp TIMESTAMPTZ DEFAULT now(),
                method TEXT,
                url TEXT,
                status_code INTEGER,
                mime_type TEXT,
                request_headers JSON,
                response_headers JSON,
                timing JSON,
                encoded_data_length BIGINT,
                raw_data JSON
            )
        """)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS page_errors (
                id INTEGER PRIMARY KEY DEFAULT nextval('page_error_seq'),
                session_id TEXT NOT NULL,
                timestamp TIMESTAMPTZ DEFAULT now(),
                error_type TEXT,
                message TEXT,
                url TEXT,
                line_number INTEGER,
                column_number INTEGER,
                stack_trace TEXT,
                raw_data JSON
            )
        """)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                started_at TIMESTAMPTZ DEFAULT now(),
                ended_at TIMESTAMPTZ,
                target_url TEXT,
                target_title TEXT,
                target_id TEXT
            )
        """)

    def insert_console_log(self, session_id: str, level: str, message: str,
                           url: str | None = None, line: int | None = None,
                           col: int | None = None, stack: str | None = None,
                           raw: dict | None = None):
        self.conn.execute("""
            INSERT INTO console_logs (session_id, level, message, url, line_number,
                                      column_number, stack_trace, raw_data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, [session_id, level, message, url, line, col, stack,
              json.dumps(raw) if raw else None])

    def insert_network_request(self, session_id: str, request_id: str,
                               method: str, url: str, status: int | None = None,
                               mime_type: str | None = None,
                               req_headers: dict | None = None,
                               res_headers: dict | None = None,
                               timing: dict | None = None,
                               size: int | None = None,
                               raw: dict | None = None):
        self.conn.execute("""
            INSERT INTO network_requests (session_id, request_id, method, url,
                status_code, mime_type, request_headers, response_headers,
                timing, encoded_data_length, raw_data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [session_id, request_id, method, url, status, mime_type,
              json.dumps(req_headers) if req_headers else None,
              json.dumps(res_headers) if res_headers else None,
              json.dumps(timing) if timing else None,
              size, json.dumps(raw) if raw else None])

    def insert_page_error(self, session_id: str, error_type: str, message: str,
                          url: str | None = None, line: int | None = None,
                          col: int | None = None, stack: str | None = None,
                          raw: dict | None = None):
        self.conn.execute("""
            INSERT INTO page_errors (session_id, error_type, message, url,
                                     line_number, column_number, stack_trace, raw_data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, [session_id, error_type, message, url, line, col, stack,
              json.dumps(raw) if raw else None])

    def start_session(self, session_id: str, target_url: str = "",
                      target_title: str = "", target_id: str = ""):
        self.conn.execute("""
            INSERT INTO sessions (session_id, target_url, target_title, target_id)
            VALUES (?, ?, ?, ?)
        """, [session_id, target_url, target_title, target_id])

    def end_session(self, session_id: str):
        self.conn.execute("""
            UPDATE sessions SET ended_at = now() WHERE session_id = ?
        """, [session_id])

    def query(self, sql: str) -> pd.DataFrame:
        return self.conn.execute(sql).fetchdf()

    def close(self):
        self.conn.close()
