package core

import (
	"database/sql"
	"fmt"
	"log/slog"
	"sort"
	"time"
)

const dailyStatusEventsSQL = `
	WITH
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
	created_events AS (
		SELECT dt, status, COUNT(*) as delta
		FROM init GROUP BY dt, status
	),
	change_out AS (
		SELECT CAST(changed_at AS DATE) as dt, from_string as status, -COUNT(*) as delta
		FROM issue_change_history
		WHERE field = 'status' AND from_string IS NOT NULL
		GROUP BY dt, status
	),
	change_in AS (
		SELECT CAST(changed_at AS DATE) as dt, to_string as status, COUNT(*) as delta
		FROM issue_change_history
		WHERE field = 'status' AND to_string IS NOT NULL
		GROUP BY dt, status
	),
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
`

// ComputeDailyStatusCounts computes cumulative daily status counts.
func ComputeDailyStatusCounts(db *sql.DB) ([]DailyStatusCount, error) {
	rows, err := db.Query(dailyStatusEventsSQL)
	if err != nil {
		return nil, fmt.Errorf("query daily events: %w", err)
	}
	defer rows.Close()

	type event struct {
		date   string
		status string
		delta  int
	}
	var events []event
	allStatuses := make(map[string]bool)
	var minDate, maxDate string

	for rows.Next() {
		var e event
		if err := rows.Scan(&e.date, &e.status, &e.delta); err != nil {
			return nil, err
		}
		// Normalize date to YYYY-MM-DD
		if len(e.date) > 10 {
			e.date = e.date[:10]
		}
		events = append(events, e)
		allStatuses[e.status] = true
		if minDate == "" || e.date < minDate {
			minDate = e.date
		}
		if maxDate == "" || e.date > maxDate {
			maxDate = e.date
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(events) == 0 {
		return nil, nil
	}

	// Build delta map: date -> status -> delta
	deltaMap := make(map[string]map[string]int)
	for _, e := range events {
		if deltaMap[e.date] == nil {
			deltaMap[e.date] = make(map[string]int)
		}
		deltaMap[e.date][e.status] += e.delta
	}

	// Generate all dates in range
	startDate, _ := time.Parse("2006-01-02", minDate)
	endDate, _ := time.Parse("2006-01-02", maxDate)

	// Compute cumulative sums
	cumulative := make(map[string]int)
	var result []DailyStatusCount

	for d := startDate; !d.After(endDate); d = d.AddDate(0, 0, 1) {
		dateStr := d.Format("2006-01-02")
		if deltas, ok := deltaMap[dateStr]; ok {
			for status, delta := range deltas {
				cumulative[status] += delta
			}
		}
		for status := range allStatuses {
			count := cumulative[status]
			if count > 0 {
				result = append(result, DailyStatusCount{
					Date:   dateStr,
					Status: status,
					Count:  count,
				})
			}
		}
	}

	// Sort by date, then status
	sort.Slice(result, func(i, j int) bool {
		if result[i].Date != result[j].Date {
			return result[i].Date < result[j].Date
		}
		return result[i].Status < result[j].Status
	})

	slog.Info("Computed daily status counts", "rows", len(result), "range", fmt.Sprintf("%s - %s", minDate, maxDate))
	return result, nil
}

const snapshotSQL = `
	WITH target AS (
		SELECT id, key, summary, status, priority, assignee, issue_type,
			   resolution, created_date, updated_date
		FROM issues WHERE "key" LIKE ? AND CAST(created_date AS DATE) <= CAST(? AS DATE)
	),
	st AS (
		SELECT issue_key, to_string as v,
			   ROW_NUMBER() OVER (PARTITION BY issue_key ORDER BY changed_at DESC) as rn
		FROM issue_change_history
		WHERE issue_key LIKE ? AND field = 'status' AND CAST(changed_at AS DATE) <= CAST(? AS DATE)
	),
	asg AS (
		SELECT issue_key, to_string as v,
			   ROW_NUMBER() OVER (PARTITION BY issue_key ORDER BY changed_at DESC) as rn
		FROM issue_change_history
		WHERE issue_key LIKE ? AND field = 'assignee' AND CAST(changed_at AS DATE) <= CAST(? AS DATE)
	),
	pri AS (
		SELECT issue_key, to_string as v,
			   ROW_NUMBER() OVER (PARTITION BY issue_key ORDER BY changed_at DESC) as rn
		FROM issue_change_history
		WHERE issue_key LIKE ? AND field = 'priority' AND CAST(changed_at AS DATE) <= CAST(? AS DATE)
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
`

// GetSnapshotAtDate restores issue state at a given date for a specific project.
func GetSnapshotAtDate(db *sql.DB, projectKey, targetDate string) ([]SnapshotIssue, error) {
	keyPattern := projectKey + "-%"
	rows, err := db.Query(snapshotSQL, keyPattern, targetDate, keyPattern, targetDate, keyPattern, targetDate, keyPattern, targetDate)
	if err != nil {
		return nil, fmt.Errorf("query snapshot: %w", err)
	}
	defer rows.Close()

	var result []SnapshotIssue
	for rows.Next() {
		var si SnapshotIssue
		var status, priority, assignee, issueType, createdDate sql.NullString
		if err := rows.Scan(&si.Key, &si.Summary, &status, &priority, &assignee, &issueType, &createdDate); err != nil {
			return nil, err
		}
		si.Status = status.String
		si.Priority = priority.String
		si.Assignee = assignee.String
		si.IssueType = issueType.String
		si.CreatedDate = createdDate.String
		result = append(result, si)
	}
	return result, rows.Err()
}
