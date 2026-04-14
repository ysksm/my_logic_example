package core

import (
	"encoding/json"
	"log/slog"
	"strings"
)

// IssuesTableColumns defines the column order matching DDL.
var IssuesTableColumns = []string{
	"id", "project_id", "key", "summary", "description",
	"status", "priority", "assignee", "reporter", "issue_type",
	"resolution", "labels", "components", "fix_versions", "sprint",
	"parent_key", "due_date", "created_date", "updated_date", "raw_data",
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func safeJSON(val interface{}) *string {
	if val == nil {
		return nil
	}
	b, err := json.Marshal(val)
	if err != nil {
		return nil
	}
	s := string(b)
	return &s
}

func getNestedString(m map[string]interface{}, keys ...string) *string {
	var current interface{} = m
	for _, k := range keys {
		cm, ok := current.(map[string]interface{})
		if !ok || cm == nil {
			return nil
		}
		current = cm[k]
	}
	s, ok := current.(string)
	if !ok || s == "" {
		return nil
	}
	return &s
}

func extractSprint(fields map[string]interface{}) *string {
	fieldIDs := []string{"sprint", "customfield_10020", "customfield_10104", "customfield_10000"}
	for _, fid := range fieldIDs {
		val := fields[fid]
		if val == nil {
			continue
		}
		if arr, ok := val.([]interface{}); ok {
			// First pass: prefer active/closed sprints (reversed)
			for i := len(arr) - 1; i >= 0; i-- {
				sp, ok := arr[i].(map[string]interface{})
				if !ok {
					continue
				}
				name, _ := sp["name"].(string)
				if name == "" {
					continue
				}
				state, _ := sp["state"].(string)
				if state == "active" || state == "closed" || state == "" {
					return &name
				}
			}
			// Second pass: any sprint with a name
			for _, item := range arr {
				sp, ok := item.(map[string]interface{})
				if !ok {
					continue
				}
				name, _ := sp["name"].(string)
				if name != "" {
					return &name
				}
			}
		} else if s, ok := val.(string); ok && strings.Contains(s, "name=") {
			start := strings.Index(s, "name=") + 5
			end := strings.Index(s[start:], ",")
			if end == -1 {
				end = strings.Index(s[start:], "]")
			}
			if end != -1 {
				name := s[start : start+end]
				return &name
			}
		}
	}
	return nil
}

// TransformIssues converts raw Jira API responses to Issue structs.
func TransformIssues(rawIssues []map[string]interface{}) []Issue {
	issues := make([]Issue, 0, len(rawIssues))
	for _, issue := range rawIssues {
		f, _ := issue["fields"].(map[string]interface{})
		if f == nil {
			f = map[string]interface{}{}
		}

		// Extract components names
		var componentNames []string
		if comps, ok := f["components"].([]interface{}); ok {
			for _, c := range comps {
				if cm, ok := c.(map[string]interface{}); ok {
					if name, ok := cm["name"].(string); ok {
						componentNames = append(componentNames, name)
					}
				}
			}
		}

		// Extract fix version names
		var fixVersionNames []string
		if versions, ok := f["fixVersions"].([]interface{}); ok {
			for _, v := range versions {
				if vm, ok := v.(map[string]interface{}); ok {
					if name, ok := vm["name"].(string); ok {
						fixVersionNames = append(fixVersionNames, name)
					}
				}
			}
		}

		// Description may be a complex object in API v3
		var desc *string
		if d := f["description"]; d != nil {
			switch v := d.(type) {
			case string:
				desc = &v
			default:
				b, _ := json.Marshal(v)
				s := string(b)
				desc = &s
			}
		}

		rawJSON, _ := json.Marshal(issue)

		projectID := ""
		if proj, ok := f["project"].(map[string]interface{}); ok {
			projectID, _ = proj["id"].(string)
		}

		iss := Issue{
			ID:          issue["id"].(string),
			Key:         issue["key"].(string),
			ProjectID:   projectID,
			Summary:     getString(f, "summary"),
			Description: desc,
			Status:      getNestedString(f, "status", "name"),
			Priority:    getNestedString(f, "priority", "name"),
			Assignee:    getNestedString(f, "assignee", "displayName"),
			Reporter:    getNestedString(f, "reporter", "displayName"),
			IssueType:   getNestedString(f, "issuetype", "name"),
			Resolution:  getNestedString(f, "resolution", "name"),
			Labels:      safeJSON(f["labels"]),
			Components:  safeJSON(componentNames),
			FixVersions: safeJSON(fixVersionNames),
			Sprint:      extractSprint(f),
			ParentKey:   getNestedString(f, "parent", "key"),
			DueDate:     getStringPtr(f, "duedate"),
			CreatedDate: getStringPtr(f, "created"),
			UpdatedDate: getStringPtr(f, "updated"),
			RawData:     string(rawJSON),
		}
		issues = append(issues, iss)
	}
	slog.Info("Transformed issues", "count", len(issues))
	return issues
}

func getString(m map[string]interface{}, key string) string {
	s, _ := m[key].(string)
	return s
}

func getStringPtr(m map[string]interface{}, key string) *string {
	v := m[key]
	if v == nil {
		return nil
	}
	s, ok := v.(string)
	if !ok || s == "" {
		return nil
	}
	return &s
}

// TransformChangeHistory extracts change history from raw issues.
func TransformChangeHistory(rawIssues []map[string]interface{}) []ChangeHistory {
	var rows []ChangeHistory
	for _, issue := range rawIssues {
		issueID, _ := issue["id"].(string)
		issueKey, _ := issue["key"].(string)

		changelog, _ := issue["changelog"].(map[string]interface{})
		histories, _ := changelog["histories"].([]interface{})

		for _, h := range histories {
			hist, ok := h.(map[string]interface{})
			if !ok {
				continue
			}
			historyID, _ := hist["id"].(string)
			changedAt, _ := hist["created"].(string)
			var authorAccountID, authorDisplayName *string
			if author, ok := hist["author"].(map[string]interface{}); ok {
				authorAccountID = getStringPtr(author, "accountId")
				authorDisplayName = getStringPtr(author, "displayName")
			}

			items, _ := hist["items"].([]interface{})
			for _, it := range items {
				item, ok := it.(map[string]interface{})
				if !ok {
					continue
				}
				field, _ := item["field"].(string)
				rows = append(rows, ChangeHistory{
					IssueID:           issueID,
					IssueKey:          issueKey,
					HistoryID:         historyID,
					AuthorAccountID:   authorAccountID,
					AuthorDisplayName: authorDisplayName,
					Field:             field,
					FieldType:         getStringPtr(item, "fieldtype"),
					FromValue:         getStringPtr(item, "from"),
					FromString:        getStringPtr(item, "fromString"),
					ToValue:           getStringPtr(item, "to"),
					ToString:          getStringPtr(item, "toString"),
					ChangedAt:         changedAt,
				})
			}
		}
	}
	slog.Info("Extracted change history records", "count", len(rows))
	return rows
}
