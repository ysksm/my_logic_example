package core

import (
	"database/sql"
	"fmt"
	"log/slog"
	"strings"
)

func safeStr(s *string) string {
	if s == nil {
		return ""
	}
	return strings.ToLower(*s)
}

func toColType(schemaType, schemaItems *string) string {
	st := safeStr(schemaType)
	switch st {
	case "number", "numeric":
		return "DOUBLE"
	case "datetime":
		return "TIMESTAMPTZ"
	case "date":
		return "DATE"
	case "array", "any":
		return "JSON"
	default:
		return "VARCHAR"
	}
}

func toSelectExpr(fieldID string, schemaType, schemaItems, schemaSystem *string) string {
	st := safeStr(schemaType)
	fid := fieldID

	switch st {
	case "user":
		return fmt.Sprintf("i.raw_data->'fields'->'%s'->>'displayName'", fid)
	case "status", "priority", "resolution", "issuetype", "issuelink",
		"securitylevel", "component", "version":
		return fmt.Sprintf("i.raw_data->'fields'->'%s'->>'name'", fid)
	case "option", "option-with-child":
		return fmt.Sprintf("COALESCE(i.raw_data->'fields'->'%s'->>'value',i.raw_data->'fields'->'%s'->>'name')", fid, fid)
	case "array":
		return fmt.Sprintf("TRY_CAST(i.raw_data->'fields'->'%s' AS JSON)", fid)
	case "number":
		return fmt.Sprintf("TRY_CAST(i.raw_data->'fields'->>'%s' AS DOUBLE)", fid)
	case "datetime", "date":
		return fmt.Sprintf("TRY_CAST(i.raw_data->'fields'->>'%s' AS TIMESTAMP)", fid)
	case "progress", "any":
		return fmt.Sprintf("TRY_CAST(i.raw_data->'fields'->'%s' AS JSON)", fid)
	case "string":
		return fmt.Sprintf("i.raw_data->'fields'->>'%s'", fid)
	default:
		return fmt.Sprintf("COALESCE(i.raw_data->'fields'->'%s'->>'name',i.raw_data->'fields'->'%s'->>'value',i.raw_data->'fields'->'%s'->>'displayName',i.raw_data->'fields'->>'%s')",
			fid, fid, fid, fid)
	}
}

type fieldColDef struct {
	name    string
	colType string
}

// FieldExpander dynamically expands issue fields from raw_data.
type FieldExpander struct {
	db     *sql.DB
	fields []JiraField
}

// NewFieldExpander creates a new FieldExpander.
func NewFieldExpander(db *sql.DB, fields []JiraField) *FieldExpander {
	return &FieldExpander{db: db, fields: fields}
}

// Expand creates the issues_expanded table and issues_readable view.
func (e *FieldExpander) Expand(projectKey string) (ExpandResult, error) {
	// Filter navigable fields
	var targetFields []JiraField
	for _, f := range e.fields {
		if f.Navigable {
			targetFields = append(targetFields, f)
		}
	}

	// Fixed columns
	selectParts := []string{
		"i.id",
		"i.project_id",
		`COALESCE(i.raw_data->>'key', i."key") AS issue_key`,
	}
	colDefs := []fieldColDef{
		{"id", "VARCHAR PRIMARY KEY"},
		{"project_id", "VARCHAR NOT NULL"},
		{"issue_key", "VARCHAR NOT NULL"},
	}
	processed := map[string]bool{"id": true, "project_id": true, "issue_key": true}

	// Dynamic columns from metadata
	customCount := 0
	for _, f := range targetFields {
		col := strings.ToLower(f.ID)
		col = strings.ReplaceAll(col, "-", "_")
		col = strings.ReplaceAll(col, ".", "_")
		if processed[col] {
			continue
		}
		processed[col] = true

		ct := toColType(f.SchemaType, f.SchemaItems)
		expr := toSelectExpr(f.ID, f.SchemaType, f.SchemaItems, f.SchemaSystem)
		selectParts = append(selectParts, fmt.Sprintf(`%s AS "%s"`, expr, col))
		colDefs = append(colDefs, fieldColDef{col, ct})
		if f.Custom {
			customCount++
		}
	}

	selectParts = append(selectParts, "CURRENT_TIMESTAMP AS synced_at")
	colDefs = append(colDefs, fieldColDef{"synced_at", "TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP"})

	// Recreate table
	if _, err := e.db.Exec("DROP TABLE IF EXISTS issues_expanded"); err != nil {
		return ExpandResult{}, fmt.Errorf("drop issues_expanded: %w", err)
	}

	var createCols []string
	for _, cd := range colDefs {
		createCols = append(createCols, fmt.Sprintf(`"%s" %s`, cd.name, cd.colType))
	}
	createSQL := fmt.Sprintf("CREATE TABLE issues_expanded (%s)", strings.Join(createCols, ", "))
	if _, err := e.db.Exec(createSQL); err != nil {
		return ExpandResult{}, fmt.Errorf("create issues_expanded: %w", err)
	}

	e.db.Exec("CREATE INDEX IF NOT EXISTS idx_expanded_project ON issues_expanded(project_id)")
	e.db.Exec("CREATE INDEX IF NOT EXISTS idx_expanded_key ON issues_expanded(issue_key)")

	// Insert data
	selectSQL := strings.Join(selectParts, ",\n        ")
	insertSQL := fmt.Sprintf(`INSERT INTO issues_expanded
		SELECT %s
		FROM issues i
		WHERE i."key" LIKE '%s-%%'`, selectSQL, projectKey)
	if _, err := e.db.Exec(insertSQL); err != nil {
		return ExpandResult{}, fmt.Errorf("insert issues_expanded: %w", err)
	}

	// Create readable view
	e.createReadableView(colDefs)

	var expanded int
	e.db.QueryRow("SELECT COUNT(*) FROM issues_expanded").Scan(&expanded)

	slog.Info("Expanded issues", "count", expanded, "columns", len(colDefs), "custom", customCount)
	return ExpandResult{
		Expanded:     expanded,
		Columns:      len(colDefs),
		CustomFields: customCount,
	}, nil
}

func (e *FieldExpander) createReadableView(colDefs []fieldColDef) {
	fieldNameMap := make(map[string]string)
	for _, f := range e.fields {
		fieldNameMap[strings.ToLower(f.ID)] = f.Name
	}
	fieldNameMap["id"] = "ID"
	fieldNameMap["project_id"] = "Project ID"
	fieldNameMap["issue_key"] = "Key"
	fieldNameMap["synced_at"] = "同期日時"

	var viewCols []string
	for _, cd := range colDefs {
		display := cd.name
		if name, ok := fieldNameMap[cd.name]; ok {
			display = name
		}
		display = strings.ReplaceAll(display, `"`, `""`)
		viewCols = append(viewCols, fmt.Sprintf(`"%s" AS "%s"`, cd.name, display))
	}

	sql := fmt.Sprintf("CREATE OR REPLACE VIEW issues_readable AS SELECT %s FROM issues_expanded",
		strings.Join(viewCols, ", "))
	e.db.Exec(sql)
}
