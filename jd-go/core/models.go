package core

import "encoding/json"

// Config holds all environment-driven configuration.
type Config struct {
	JiraBaseURL   string
	JiraUsername  string
	JiraAPIToken  string
	DBPath        string
	Project       string // optional default project key
	AutoSync      string // optional: full / incremental
	SyncStatePath string
}

// Project mirrors the projects table.
type Project struct {
	ID          string
	Key         string
	Name        string
	Description string
	RawData     json.RawMessage
}

// Issue mirrors the issues table.
type Issue struct {
	ID          string
	ProjectID   string
	Key         string
	Summary     string
	Description *string
	Status      *string
	Priority    *string
	Assignee    *string
	Reporter    *string
	IssueType   *string
	Resolution  *string
	Labels      *string
	Components  *string
	FixVersions *string
	Sprint      *string
	ParentKey   *string
	DueDate     *string
	CreatedDate *string
	UpdatedDate *string
	RawData     string
}

// ChangeHistory mirrors the issue_change_history table.
type ChangeHistory struct {
	IssueID           string
	IssueKey          string
	HistoryID         string
	AuthorAccountID   *string
	AuthorDisplayName *string
	Field             string
	FieldType         *string
	FromValue         *string
	FromString        *string
	ToValue           *string
	ToString          *string
	ChangedAt         string
}

// Status represents a Jira status.
type Status struct {
	Name        string
	Description string
	Category    string
}

// Priority represents a Jira priority.
type Priority struct {
	Name        string
	Description string
}

// IssueTypeMeta represents a Jira issue type.
type IssueTypeMeta struct {
	Name        string
	Description string
	Subtask     bool
}

// JiraField mirrors the jira_fields table.
type JiraField struct {
	ID             string
	Key            string
	Name           string
	Custom         bool
	Searchable     bool
	Navigable      bool
	Orderable      bool
	SchemaType     *string
	SchemaItems    *string
	SchemaSystem   *string
	SchemaCustom   *string
	SchemaCustomID *int64
}

// SyncResult is the return value from SyncService.Execute.
type SyncResult struct {
	Mode     string       `json:"mode"`
	Fetched  int          `json:"fetched"`
	History  int          `json:"history"`
	Expanded ExpandResult `json:"expanded"`
	Summary  DBSummary    `json:"summary"`
}

// ExpandResult holds field expansion statistics.
type ExpandResult struct {
	Expanded     int `json:"expanded"`
	Columns      int `json:"columns"`
	CustomFields int `json:"custom_fields"`
}

// DBSummary holds DB overview counts.
type DBSummary struct {
	Issues  int `json:"issues"`
	History int `json:"history"`
}

// SyncOptions bundles parameters for SyncService.Execute.
type SyncOptions struct {
	ProjectKey string
	Mode       string // "full", "incremental", "resume"
	Projects   []Project
	Statuses   []Status
	Priorities []Priority
	IssueTypes []IssueTypeMeta
	Fields     []JiraField
	OnProgress ProgressCallback
}

// ProgressCallback reports sync progress.
type ProgressCallback func(fetched, total int)

// SyncCheckpoint persisted in JSON file.
type SyncCheckpoint struct {
	StartedAt          string  `json:"started_at"`
	ItemsSynced        int     `json:"items_synced"`
	CheckpointUpdatedAt *string `json:"checkpoint_updated_at"`
}

// LastSync records a completed sync.
type LastSync struct {
	CompletedAt string `json:"completed_at"`
	ItemsSynced int    `json:"items_synced"`
	SyncType    string `json:"sync_type"`
}

// DailyStatusCount for history analysis.
type DailyStatusCount struct {
	Date   string `json:"date"`
	Status string `json:"status"`
	Count  int    `json:"count"`
}

// SnapshotIssue for point-in-time reconstruction.
type SnapshotIssue struct {
	Key         string `json:"key"`
	Summary     string `json:"summary"`
	Status      string `json:"status"`
	Priority    string `json:"priority"`
	Assignee    string `json:"assignee"`
	IssueType   string `json:"issue_type"`
	CreatedDate string `json:"created_date"`
}
