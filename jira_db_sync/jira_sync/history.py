"""履歴データ分析

責務:
- 変更履歴からイベントベースで日別ステータス件数を計算
- 任意時点のスナップショット復元
"""

import logging

import pandas as pd

logger = logging.getLogger(__name__)

# 日別ステータスイベントを取得する SQL
_DAILY_STATUS_EVENTS_SQL = """
    WITH
    -- 各 issue の初期ステータス: 最初の status 変更の from_string、なければ現在の status
    init AS (
        SELECT
            i."key" as issue_key,
            CAST(i.created_date AS DATE) as dt,
            COALESCE(
                (SELECT h.from_string
                 FROM issue_change_history h
                 WHERE h.issue_key = i."key" AND h.field = 'status'
                 ORDER BY h.changed_at ASC LIMIT 1),
                i.status
            ) as status
        FROM issues i
        WHERE i.created_date IS NOT NULL
    ),
    -- 作成イベント: +1
    created_events AS (
        SELECT dt, status, COUNT(*) as delta
        FROM init GROUP BY dt, status
    ),
    -- ステータス変更: from に -1
    change_out AS (
        SELECT CAST(changed_at AS DATE) as dt, from_string as status, -COUNT(*) as delta
        FROM issue_change_history
        WHERE field = 'status' AND from_string IS NOT NULL
        GROUP BY dt, status
    ),
    -- ステータス変更: to に +1
    change_in AS (
        SELECT CAST(changed_at AS DATE) as dt, to_string as status, COUNT(*) as delta
        FROM issue_change_history
        WHERE field = 'status' AND to_string IS NOT NULL
        GROUP BY dt, status
    ),
    -- 全イベント結合 → 日 × ステータスで集約
    daily_delta AS (
        SELECT dt, status, SUM(delta) as delta
        FROM (
            SELECT * FROM created_events
            UNION ALL SELECT * FROM change_out
            UNION ALL SELECT * FROM change_in
        )
        WHERE status IS NOT NULL
        GROUP BY dt, status
    )
    SELECT dt as date, status, delta
    FROM daily_delta
    ORDER BY dt, status
"""


def compute_daily_status_counts(conn) -> pd.DataFrame:
    """日別のステータス別件数を計算

    Returns:
        DataFrame with columns: date, status, count
        各日 × 各ステータスの累積件数
    """
    events = conn.execute(_DAILY_STATUS_EVENTS_SQL).fetchdf()
    if events.empty:
        return pd.DataFrame(columns=["date", "status", "count"])

    # pivot → 日付を連続に → 累積合計 → long form
    pivot = events.pivot_table(
        index="date", columns="status", values="delta",
        aggfunc="sum", fill_value=0,
    )
    all_dates = pd.date_range(events["date"].min(), events["date"].max(), freq="D")
    pivot = pivot.reindex(all_dates, fill_value=0)
    pivot.index.name = "date"
    cumsum = pivot.cumsum()

    daily = cumsum.reset_index().melt(
        id_vars="date", var_name="status", value_name="count",
    )
    # 0以下は除外
    daily = daily[daily["count"] > 0].reset_index(drop=True)

    logger.info("Computed daily status counts: %d rows, %s - %s",
                len(daily), events["date"].min(), events["date"].max())
    return daily


def get_snapshot_at_date(conn, target_date: str) -> pd.DataFrame:
    """指定日時点の各 issue のステータス/担当者/優先度を復元

    Args:
        conn: DuckDB connection
        target_date: YYYY-MM-DD 形式の日付文字列

    Returns:
        DataFrame with columns: key, summary, status, priority, assignee, issue_type, created_date
    """
    return conn.execute("""
        WITH target AS (
            SELECT id, key, summary, status, priority, assignee, issue_type,
                   resolution, created_date, updated_date
            FROM issues WHERE CAST(created_date AS DATE) <= ?
        ),
        st AS (
            SELECT issue_key, to_string as v,
                   ROW_NUMBER() OVER (PARTITION BY issue_key ORDER BY changed_at DESC) as rn
            FROM issue_change_history
            WHERE field = 'status' AND CAST(changed_at AS DATE) <= ?
        ),
        asg AS (
            SELECT issue_key, to_string as v,
                   ROW_NUMBER() OVER (PARTITION BY issue_key ORDER BY changed_at DESC) as rn
            FROM issue_change_history
            WHERE field = 'assignee' AND CAST(changed_at AS DATE) <= ?
        ),
        pri AS (
            SELECT issue_key, to_string as v,
                   ROW_NUMBER() OVER (PARTITION BY issue_key ORDER BY changed_at DESC) as rn
            FROM issue_change_history
            WHERE field = 'priority' AND CAST(changed_at AS DATE) <= ?
        )
        SELECT
            t.key, t.summary,
            COALESCE(s.v, t.status) as status,
            COALESCE(p.v, t.priority) as priority,
            COALESCE(a.v, t.assignee) as assignee,
            t.issue_type, t.created_date
        FROM target t
        LEFT JOIN st s ON t.key = s.issue_key AND s.rn = 1
        LEFT JOIN asg a ON t.key = a.issue_key AND a.rn = 1
        LEFT JOIN pri p ON t.key = p.issue_key AND p.rn = 1
        ORDER BY t.key
    """, [target_date] * 4).fetchdf()
