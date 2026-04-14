package core

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	_ "github.com/marcboeker/go-duckdb"
)

var ddl = []string{
	`CREATE TABLE IF NOT EXISTS projects (
		id VARCHAR PRIMARY KEY, key VARCHAR NOT NULL, name VARCHAR NOT NULL,
		description TEXT, raw_data JSON,
		created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE IF NOT EXISTS issues (
		id VARCHAR PRIMARY KEY, project_id VARCHAR NOT NULL,
		key VARCHAR NOT NULL, summary TEXT NOT NULL, description TEXT,
		status VARCHAR, priority VARCHAR, assignee VARCHAR, reporter VARCHAR,
		issue_type VARCHAR, resolution VARCHAR, labels JSON, components JSON,
		fix_versions JSON, sprint VARCHAR, parent_key VARCHAR,
		due_date VARCHAR, created_date VARCHAR, updated_date VARCHAR,
		raw_data JSON, synced_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE IF NOT EXISTS issue_change_history (
		issue_id VARCHAR NOT NULL, issue_key VARCHAR NOT NULL,
		history_id VARCHAR NOT NULL, author_account_id VARCHAR,
		author_display_name VARCHAR, field VARCHAR NOT NULL,
		field_type VARCHAR, from_value TEXT, from_string TEXT,
		to_value TEXT, to_string TEXT, changed_at VARCHAR NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS statuses (
		project_key VARCHAR NOT NULL, name VARCHAR NOT NULL,
		description VARCHAR, category VARCHAR,
		PRIMARY KEY (project_key, name))`,
	`CREATE TABLE IF NOT EXISTS priorities (
		name VARCHAR PRIMARY KEY, description VARCHAR)`,
	`CREATE TABLE IF NOT EXISTS issue_types (
		name VARCHAR PRIMARY KEY, description VARCHAR,
		subtask BOOLEAN DEFAULT false)`,
	`CREATE TABLE IF NOT EXISTS jira_fields (
		id VARCHAR PRIMARY KEY, key VARCHAR NOT NULL,
		name VARCHAR NOT NULL, custom BOOLEAN DEFAULT false,
		searchable BOOLEAN DEFAULT false, navigable BOOLEAN DEFAULT false,
		orderable BOOLEAN DEFAULT false, schema_type VARCHAR,
		schema_items VARCHAR, schema_system VARCHAR,
		schema_custom VARCHAR, schema_custom_id BIGINT,
		created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE IF NOT EXISTS sync_history (
		id INTEGER PRIMARY KEY, project_key VARCHAR NOT NULL,
		sync_type VARCHAR NOT NULL, started_at TIMESTAMPTZ NOT NULL,
		completed_at TIMESTAMPTZ, status VARCHAR NOT NULL,
		items_synced INTEGER, checkpoint_updated_at TIMESTAMPTZ)`,
	"CREATE SEQUENCE IF NOT EXISTS sync_history_seq START 1",
	`CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id)`,
	`CREATE INDEX IF NOT EXISTS idx_issues_key ON issues("key")`,
	`CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status)`,
	`CREATE INDEX IF NOT EXISTS idx_ch_issue_id ON issue_change_history(issue_id)`,
	`CREATE INDEX IF NOT EXISTS idx_ch_field ON issue_change_history(field)`,
}

// Database wraps a DuckDB connection.
type Database struct {
	DB   *sql.DB
	Path string
}

// NewDatabase opens a DuckDB database and initializes the schema.
func NewDatabase(dbPath string) (*Database, error) {
	dir := filepath.Dir(dbPath)
	if dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("create db dir: %w", err)
		}
	}
	db, err := sql.Open("duckdb", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open duckdb: %w", err)
	}
	d := &Database{DB: db, Path: dbPath}
	if err := d.initSchema(); err != nil {
		db.Close()
		return nil, err
	}
	slog.Info("Connected to database", "path", dbPath)
	return d, nil
}

func (d *Database) initSchema() error {
	for _, s := range ddl {
		if _, err := d.DB.Exec(s); err != nil {
			return fmt.Errorf("execute DDL: %w\nSQL: %s", err, s)
		}
	}
	return nil
}

// Close closes the database connection.
func (d *Database) Close() error {
	return d.DB.Close()
}

// UpsertProjects upserts projects.
func (d *Database) UpsertProjects(projects []Project) error {
	for _, p := range projects {
		rawData := string(p.RawData)
		if rawData == "" {
			rawData = "{}"
		}
		_, err := d.DB.Exec(
			`INSERT INTO projects (id, key, name, description, raw_data)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT (id) DO UPDATE SET
				key = EXCLUDED.key, name = EXCLUDED.name,
				description = EXCLUDED.description, raw_data = EXCLUDED.raw_data`,
			p.ID, p.Key, p.Name, p.Description, rawData,
		)
		if err != nil {
			return fmt.Errorf("upsert project %s: %w", p.Key, err)
		}
	}
	slog.Info("Upserted projects", "count", len(projects))
	return nil
}

// UpsertIssues upserts issues.
// full=true: delete all issues for the project and re-insert.
// full=false: delete only the issues being inserted.
func (d *Database) UpsertIssues(issues []Issue, projectKey string, full bool) error {
	if len(issues) == 0 {
		return nil
	}

	// Delete phase
	if full {
		if _, err := d.DB.Exec(`DELETE FROM issues WHERE "key" LIKE ?`, projectKey+"-%"); err != nil {
			return fmt.Errorf("delete issues: %w", err)
		}
	} else {
		placeholders := make([]string, len(issues))
		args := make([]interface{}, len(issues))
		for i, iss := range issues {
			placeholders[i] = "?"
			args[i] = iss.ID
		}
		if _, err := d.DB.Exec(
			"DELETE FROM issues WHERE id IN ("+strings.Join(placeholders, ",")+")",
			args...,
		); err != nil {
			return fmt.Errorf("delete issues: %w", err)
		}
	}

	// Insert phase - batch in chunks to avoid huge statements
	const batchSize = 100
	for start := 0; start < len(issues); start += batchSize {
		end := start + batchSize
		if end > len(issues) {
			end = len(issues)
		}
		batch := issues[start:end]

		for _, iss := range batch {
			if _, err := d.DB.Exec(
				`INSERT OR IGNORE INTO issues (id, project_id, key, summary, description,
					status, priority, assignee, reporter, issue_type,
					resolution, labels, components, fix_versions, sprint,
					parent_key, due_date, created_date, updated_date, raw_data)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				iss.ID, iss.ProjectID, iss.Key, iss.Summary, iss.Description,
				iss.Status, iss.Priority, iss.Assignee, iss.Reporter, iss.IssueType,
				iss.Resolution, iss.Labels, iss.Components, iss.FixVersions, iss.Sprint,
				iss.ParentKey, iss.DueDate, iss.CreatedDate, iss.UpdatedDate, iss.RawData,
			); err != nil {
				return fmt.Errorf("insert issue %s: %w", iss.Key, err)
			}
		}
	}

	slog.Info("Upserted issues", "count", len(issues), "full", full)
	return nil
}

// UpsertChangeHistory replaces change history for a project.
func (d *Database) UpsertChangeHistory(history []ChangeHistory, projectKey string) error {
	if _, err := d.DB.Exec("DELETE FROM issue_change_history WHERE issue_key LIKE ?", projectKey+"-%"); err != nil {
		return fmt.Errorf("delete history: %w", err)
	}

	for _, h := range history {
		if _, err := d.DB.Exec(
			`INSERT INTO issue_change_history
			(issue_id, issue_key, history_id, author_account_id, author_display_name,
			 field, field_type, from_value, from_string, to_value, to_string, changed_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			h.IssueID, h.IssueKey, h.HistoryID, h.AuthorAccountID, h.AuthorDisplayName,
			h.Field, h.FieldType, h.FromValue, h.FromString, h.ToValue, h.ToString, h.ChangedAt,
		); err != nil {
			return fmt.Errorf("insert history: %w", err)
		}
	}

	slog.Info("Upserted change history records", "count", len(history))
	return nil
}

// UpsertMetadata updates statuses, priorities, issue types, and fields.
// Each table is updated in its own transaction to avoid DuckDB index conflicts.
func (d *Database) UpsertMetadata(projectKey string, statuses []Status, priorities []Priority, issueTypes []IssueTypeMeta, fields []JiraField) error {
	// Statuses
	if _, err := d.DB.Exec("DELETE FROM statuses WHERE project_key = ?", projectKey); err != nil {
		return fmt.Errorf("delete statuses: %w", err)
	}
	for _, s := range statuses {
		if _, err := d.DB.Exec("INSERT INTO statuses VALUES (?, ?, ?, ?)",
			projectKey, s.Name, s.Description, s.Category); err != nil {
			return fmt.Errorf("insert status: %w", err)
		}
	}

	// Priorities (deduplicate by name)
	if len(priorities) > 0 {
		if _, err := d.DB.Exec("DELETE FROM priorities"); err != nil {
			return fmt.Errorf("delete priorities: %w", err)
		}
		seen := make(map[string]bool)
		for _, p := range priorities {
			if seen[p.Name] {
				continue
			}
			seen[p.Name] = true
			if _, err := d.DB.Exec("INSERT OR IGNORE INTO priorities VALUES (?, ?)", p.Name, p.Description); err != nil {
				return fmt.Errorf("insert priority: %w", err)
			}
		}
	}

	// Issue Types (deduplicate by name)
	if len(issueTypes) > 0 {
		if _, err := d.DB.Exec("DELETE FROM issue_types"); err != nil {
			return fmt.Errorf("delete issue types: %w", err)
		}
		seen := make(map[string]bool)
		for _, it := range issueTypes {
			if seen[it.Name] {
				continue
			}
			seen[it.Name] = true
			if _, err := d.DB.Exec("INSERT OR IGNORE INTO issue_types VALUES (?, ?, ?)",
				it.Name, it.Description, it.Subtask); err != nil {
				return fmt.Errorf("insert issue type: %w", err)
			}
		}
	}

	// Fields (deduplicate by id)
	if len(fields) > 0 {
		if _, err := d.DB.Exec("DELETE FROM jira_fields"); err != nil {
			return fmt.Errorf("delete fields: %w", err)
		}
		seen := make(map[string]bool)
		for _, f := range fields {
			if seen[f.ID] {
				continue
			}
			seen[f.ID] = true
			if _, err := d.DB.Exec(
				`INSERT OR IGNORE INTO jira_fields (id, key, name, custom, searchable, navigable,
					orderable, schema_type, schema_items, schema_system, schema_custom,
					schema_custom_id, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
				f.ID, f.Key, f.Name, f.Custom, f.Searchable, f.Navigable,
				f.Orderable, f.SchemaType, f.SchemaItems, f.SchemaSystem, f.SchemaCustom, f.SchemaCustomID); err != nil {
				return fmt.Errorf("insert field: %w", err)
			}
		}
	}

	slog.Info("Updated metadata", "project", projectKey)
	return nil
}

// RecordSync records a sync history entry.
func (d *Database) RecordSync(projectKey, syncType, startedAt, completedAt string, itemsSynced int, checkpoint *string) error {
	_, err := d.DB.Exec(
		`INSERT INTO sync_history VALUES (
			nextval('sync_history_seq'), ?, ?, ?, ?, 'completed', ?, ?)`,
		projectKey, syncType, startedAt, completedAt, itemsSynced, checkpoint,
	)
	return err
}

// GetSummary returns the DB overview.
func (d *Database) GetSummary() (DBSummary, error) {
	var s DBSummary
	err := d.DB.QueryRow(
		`SELECT COUNT(*) AS issues,
		(SELECT COUNT(*) FROM issue_change_history) AS history
		FROM issues`,
	).Scan(&s.Issues, &s.History)
	return s, err
}

// ExecuteQuery runs an arbitrary SQL query and returns rows as maps.
func (d *Database) ExecuteQuery(query string) ([]map[string]interface{}, []string, error) {
	rows, err := d.DB.Query(query)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	columns, err := rows.Columns()
	if err != nil {
		return nil, nil, err
	}

	var results []map[string]interface{}
	for rows.Next() {
		values := make([]interface{}, len(columns))
		ptrs := make([]interface{}, len(columns))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, nil, err
		}
		row := make(map[string]interface{}, len(columns))
		for i, col := range columns {
			val := values[i]
			// Convert []byte to string for JSON serialization
			if b, ok := val.([]byte); ok {
				row[col] = string(b)
			} else {
				row[col] = val
			}
		}
		results = append(results, row)
	}
	return results, columns, rows.Err()
}

// TransformRawProjects converts raw API response maps to Project structs.
func TransformRawProjects(raw []map[string]interface{}) []Project {
	projects := make([]Project, 0, len(raw))
	for _, p := range raw {
		id, _ := p["id"].(string)
		key, _ := p["key"].(string)
		name, _ := p["name"].(string)
		desc, _ := p["description"].(string)
		rawData, _ := json.Marshal(p)
		projects = append(projects, Project{
			ID: id, Key: key, Name: name, Description: desc, RawData: rawData,
		})
	}
	return projects
}

// TransformRawPriorities converts raw API response to Priority structs.
func TransformRawPriorities(raw []map[string]interface{}) []Priority {
	priorities := make([]Priority, 0, len(raw))
	for _, p := range raw {
		name, _ := p["name"].(string)
		desc, _ := p["description"].(string)
		priorities = append(priorities, Priority{Name: name, Description: desc})
	}
	return priorities
}

// TransformRawIssueTypes converts raw API response to IssueTypeMeta structs.
func TransformRawIssueTypes(raw []map[string]interface{}) []IssueTypeMeta {
	types := make([]IssueTypeMeta, 0, len(raw))
	for _, it := range raw {
		name, _ := it["name"].(string)
		desc, _ := it["description"].(string)
		subtask, _ := it["subtask"].(bool)
		types = append(types, IssueTypeMeta{Name: name, Description: desc, Subtask: subtask})
	}
	return types
}

// TransformRawFields converts raw API response to JiraField structs.
func TransformRawFields(raw []map[string]interface{}) []JiraField {
	fields := make([]JiraField, 0, len(raw))
	for _, f := range raw {
		id, _ := f["id"].(string)
		key, _ := f["key"].(string)
		name, _ := f["name"].(string)
		custom, _ := f["custom"].(bool)
		searchable, _ := f["searchable"].(bool)
		navigable, _ := f["navigable"].(bool)
		orderable, _ := f["orderable"].(bool)

		jf := JiraField{
			ID: id, Key: key, Name: name,
			Custom: custom, Searchable: searchable,
			Navigable: navigable, Orderable: orderable,
		}

		if schema, ok := f["schema"].(map[string]interface{}); ok {
			jf.SchemaType = getStringPtr(schema, "type")
			jf.SchemaItems = getStringPtr(schema, "items")
			jf.SchemaSystem = getStringPtr(schema, "system")
			jf.SchemaCustom = getStringPtr(schema, "custom")
			if cid, ok := schema["customId"].(float64); ok {
				v := int64(cid)
				jf.SchemaCustomID = &v
			}
		}

		fields = append(fields, jf)
	}
	return fields
}
