package core

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"
)

const marginMinutes = 5

// SyncState manages sync state persistence in a JSON file.
type SyncState struct {
	path string
}

// NewSyncState creates a new SyncState.
func NewSyncState(path string) *SyncState {
	return &SyncState{path: path}
}

func (s *SyncState) load() map[string]map[string]json.RawMessage {
	data, err := os.ReadFile(s.path)
	if err != nil {
		return make(map[string]map[string]json.RawMessage)
	}
	var state map[string]map[string]json.RawMessage
	if err := json.Unmarshal(data, &state); err != nil {
		return make(map[string]map[string]json.RawMessage)
	}
	return state
}

func (s *SyncState) save(state map[string]map[string]json.RawMessage) error {
	dir := filepath.Dir(s.path)
	if dir != "" && dir != "." {
		os.MkdirAll(dir, 0o755)
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, data, 0o644)
}

// GetLastSync returns the last sync info for a project.
func (s *SyncState) GetLastSync(projectKey string) (*LastSync, error) {
	state := s.load()
	proj, ok := state[projectKey]
	if !ok {
		return nil, nil
	}
	raw, ok := proj["last_sync"]
	if !ok {
		return nil, nil
	}
	var ls LastSync
	if err := json.Unmarshal(raw, &ls); err != nil {
		return nil, err
	}
	return &ls, nil
}

// GetCheckpoint returns the checkpoint for a project.
func (s *SyncState) GetCheckpoint(projectKey string) (*SyncCheckpoint, error) {
	state := s.load()
	proj, ok := state[projectKey]
	if !ok {
		return nil, nil
	}
	raw, ok := proj["checkpoint"]
	if !ok {
		return nil, nil
	}
	var cp SyncCheckpoint
	if err := json.Unmarshal(raw, &cp); err != nil {
		return nil, err
	}
	return &cp, nil
}

// SaveCheckpoint saves a sync checkpoint.
func (s *SyncState) SaveCheckpoint(projectKey, startedAt string, itemsSynced int, checkpointUpdatedAt *string) error {
	state := s.load()
	if state[projectKey] == nil {
		state[projectKey] = make(map[string]json.RawMessage)
	}
	cp := SyncCheckpoint{
		StartedAt:          startedAt,
		ItemsSynced:        itemsSynced,
		CheckpointUpdatedAt: checkpointUpdatedAt,
	}
	data, _ := json.Marshal(cp)
	state[projectKey]["checkpoint"] = data
	return s.save(state)
}

// CompleteSync marks a sync as complete.
func (s *SyncState) CompleteSync(projectKey, completedAt string, itemsSynced int, syncType string) error {
	state := s.load()
	if state[projectKey] == nil {
		state[projectKey] = make(map[string]json.RawMessage)
	}
	delete(state[projectKey], "checkpoint")
	ls := LastSync{
		CompletedAt: completedAt,
		ItemsSynced: itemsSynced,
		SyncType:    syncType,
	}
	data, _ := json.Marshal(ls)
	state[projectKey]["last_sync"] = data
	return s.save(state)
}

// SyncService orchestrates syncs.
type SyncService struct {
	Client    *JiraClient
	DB        *Database
	SyncState *SyncState
}

// NewSyncService creates a new SyncService.
func NewSyncService(client *JiraClient, db *Database, syncState *SyncState) *SyncService {
	return &SyncService{Client: client, DB: db, SyncState: syncState}
}

// BuildJQL builds a JQL query based on sync mode.
func (svc *SyncService) BuildJQL(projectKey, mode string) string {
	base := fmt.Sprintf("project = %s ORDER BY updated ASC, key ASC", projectKey)

	if mode == "resume" {
		cp, _ := svc.SyncState.GetCheckpoint(projectKey)
		if cp != nil && cp.CheckpointUpdatedAt != nil {
			t, err := time.Parse(time.RFC3339, *cp.CheckpointUpdatedAt)
			if err == nil {
				t = t.Add(-time.Duration(marginMinutes) * time.Minute)
				dateStr := t.Format("2006-01-02 15:04")
				return fmt.Sprintf(`project = %s AND updated >= "%s" ORDER BY updated ASC, key ASC`,
					projectKey, dateStr)
			}
		}
	}

	if mode == "incremental" {
		last, _ := svc.SyncState.GetLastSync(projectKey)
		if last != nil && last.CompletedAt != "" {
			t, err := time.Parse(time.RFC3339, last.CompletedAt)
			if err == nil {
				t = t.Add(-time.Duration(marginMinutes) * time.Minute)
				dateStr := t.Format("2006-01-02 15:04")
				return fmt.Sprintf(`project = %s AND updated >= "%s" ORDER BY updated ASC, key ASC`,
					projectKey, dateStr)
			}
		}
	}

	return base
}

// Execute runs a sync.
func (svc *SyncService) Execute(ctx context.Context, opts SyncOptions) (*SyncResult, error) {
	startedAt := time.Now().UTC().Format(time.RFC3339)
	if err := svc.SyncState.SaveCheckpoint(opts.ProjectKey, startedAt, 0, nil); err != nil {
		slog.Warn("Failed to save initial checkpoint", "error", err)
	}

	// 1. Fetch issues
	jql := svc.BuildJQL(opts.ProjectKey, opts.Mode)
	slog.Info("Sync starting", "mode", opts.Mode, "jql", jql)
	rawIssues, err := svc.Client.FetchAllIssues(ctx, jql, opts.OnProgress)
	if err != nil {
		return nil, fmt.Errorf("fetch issues: %w", err)
	}

	// 2. Transform
	issues := TransformIssues(rawIssues)
	changeHistory := TransformChangeHistory(rawIssues)

	// 3. DB writes
	if len(opts.Projects) > 0 {
		if err := svc.DB.UpsertProjects(opts.Projects); err != nil {
			return nil, fmt.Errorf("upsert projects: %w", err)
		}
	}
	if err := svc.DB.UpsertIssues(issues, opts.ProjectKey, opts.Mode == "full"); err != nil {
		return nil, fmt.Errorf("upsert issues: %w", err)
	}

	// Checkpoint update
	var checkpointVal *string
	if len(issues) > 0 {
		// Find max updated_date
		var maxUpdated string
		for _, iss := range issues {
			if iss.UpdatedDate != nil && *iss.UpdatedDate > maxUpdated {
				maxUpdated = *iss.UpdatedDate
			}
		}
		if maxUpdated != "" {
			checkpointVal = &maxUpdated
			svc.SyncState.SaveCheckpoint(opts.ProjectKey, startedAt, len(issues), checkpointVal)
		}
	}

	if err := svc.DB.UpsertChangeHistory(changeHistory, opts.ProjectKey); err != nil {
		return nil, fmt.Errorf("upsert change history: %w", err)
	}

	if len(opts.Statuses) > 0 || len(opts.Fields) > 0 {
		if err := svc.DB.UpsertMetadata(opts.ProjectKey, opts.Statuses, opts.Priorities, opts.IssueTypes, opts.Fields); err != nil {
			return nil, fmt.Errorf("upsert metadata: %w", err)
		}
	}

	// 4. Field expansion
	var expandResult ExpandResult
	if len(opts.Fields) > 0 {
		expander := NewFieldExpander(svc.DB.DB, opts.Fields)
		var err error
		expandResult, err = expander.Expand(opts.ProjectKey)
		if err != nil {
			slog.Warn("Field expansion failed", "error", err)
		}
	}

	// 5. Complete sync
	completedAt := time.Now().UTC().Format(time.RFC3339)
	svc.DB.RecordSync(opts.ProjectKey, opts.Mode, startedAt, completedAt, len(issues), checkpointVal)
	svc.SyncState.CompleteSync(opts.ProjectKey, completedAt, len(issues), opts.Mode)

	summary, _ := svc.DB.GetSummary()
	slog.Info("Sync completed", "issues", summary.Issues, "history", summary.History, "expanded", expandResult)

	return &SyncResult{
		Mode:     opts.Mode,
		Fetched:  len(issues),
		History:  len(changeHistory),
		Expanded: expandResult,
		Summary:  summary,
	}, nil
}
