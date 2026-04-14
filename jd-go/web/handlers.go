package web

import (
	"context"
	"encoding/json"
	"fmt"
	"html/template"
	"log/slog"
	"net/http"

	"github.com/ysksm/jd-go/core"
)

func jsonResponse(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	tmpl, err := template.ParseFS(embeddedFS, "templates/layout.html")
	if err != nil {
		http.Error(w, "Template error", http.StatusInternalServerError)
		slog.Error("Template parse error", "error", err)
		return
	}
	tmpl.Execute(w, nil)
}

func (s *Server) handleProjects(w http.ResponseWriter, r *http.Request) {
	if s.client == nil {
		jsonError(w, "Jira credentials not configured", http.StatusServiceUnavailable)
		return
	}
	projects, err := s.client.FetchProjects(r.Context())
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	type projectItem struct {
		ID   string `json:"id"`
		Key  string `json:"key"`
		Name string `json:"name"`
	}
	var items []projectItem
	for _, p := range projects {
		id, _ := p["id"].(string)
		key, _ := p["key"].(string)
		name, _ := p["name"].(string)
		items = append(items, projectItem{ID: id, Key: key, Name: name})
	}
	jsonResponse(w, items)
}

func (s *Server) handleMetadata(w http.ResponseWriter, r *http.Request) {
	projectKey := r.PathValue("projectKey")
	if s.client == nil {
		jsonError(w, "Jira credentials not configured", http.StatusServiceUnavailable)
		return
	}

	statuses, err := s.client.FetchProjectStatuses(r.Context(), projectKey)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	rawPriorities, _ := s.client.FetchPriorities(r.Context())
	priorities := core.TransformRawPriorities(rawPriorities)

	// Find project ID
	rawProjects, _ := s.client.FetchProjects(r.Context())
	var projectID string
	for _, p := range rawProjects {
		if k, _ := p["key"].(string); k == projectKey {
			projectID, _ = p["id"].(string)
			break
		}
	}

	var issueTypes []core.IssueTypeMeta
	if projectID != "" {
		rawIT, _ := s.client.FetchIssueTypes(r.Context(), projectID)
		issueTypes = core.TransformRawIssueTypes(rawIT)
	}

	rawFields, _ := s.client.FetchFields(r.Context())
	fields := core.TransformRawFields(rawFields)

	jsonResponse(w, map[string]interface{}{
		"statuses":    statuses,
		"priorities":  priorities,
		"issue_types": issueTypes,
		"fields":      fields,
	})
}

func (s *Server) handleSyncStatus(w http.ResponseWriter, r *http.Request) {
	projectKey := r.PathValue("projectKey")
	lastSync, _ := s.syncState.GetLastSync(projectKey)
	checkpoint, _ := s.syncState.GetCheckpoint(projectKey)
	jsonResponse(w, map[string]interface{}{
		"last_sync":  lastSync,
		"checkpoint": checkpoint,
	})
}

func (s *Server) handleSyncStart(w http.ResponseWriter, r *http.Request) {
	projectKey := r.PathValue("projectKey")
	mode := r.FormValue("mode")
	if mode == "" {
		mode = "full"
	}

	if s.client == nil {
		jsonError(w, "Jira credentials not configured", http.StatusServiceUnavailable)
		return
	}

	if !s.syncMu.TryLock() {
		jsonError(w, "Sync already in progress", http.StatusConflict)
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	s.activeSyncCancel = cancel

	go func() {
		defer s.syncMu.Unlock()
		defer cancel()

		s.broadcastSSE(SSEEvent{Event: "sync_start", Data: fmt.Sprintf(`{"project":"%s","mode":"%s"}`, projectKey, mode)})

		// Fetch metadata
		rawProjects, _ := s.client.FetchProjects(ctx)
		projects := core.TransformRawProjects(rawProjects)

		var projectID string
		for _, p := range rawProjects {
			if k, _ := p["key"].(string); k == projectKey {
				projectID, _ = p["id"].(string)
				break
			}
		}

		statuses, _ := s.client.FetchProjectStatuses(ctx, projectKey)
		rawPriorities, _ := s.client.FetchPriorities(ctx)
		priorities := core.TransformRawPriorities(rawPriorities)

		var issueTypes []core.IssueTypeMeta
		if projectID != "" {
			rawIT, _ := s.client.FetchIssueTypes(ctx, projectID)
			issueTypes = core.TransformRawIssueTypes(rawIT)
		}

		rawFields, _ := s.client.FetchFields(ctx)
		fields := core.TransformRawFields(rawFields)

		svc := core.NewSyncService(s.client, s.db, s.syncState)
		result, err := svc.Execute(ctx, core.SyncOptions{
			ProjectKey: projectKey,
			Mode:       mode,
			Projects:   projects,
			Statuses:   statuses,
			Priorities: priorities,
			IssueTypes: issueTypes,
			Fields:     fields,
			OnProgress: func(fetched, total int) {
				s.broadcastSSE(SSEEvent{
					Event: "progress",
					Data:  fmt.Sprintf(`{"fetched":%d,"total":%d}`, fetched, total),
				})
			},
		})

		if err != nil {
			slog.Error("Sync failed", "error", err)
			s.broadcastSSE(SSEEvent{Event: "error", Data: fmt.Sprintf(`{"error":"%s"}`, err.Error())})
			return
		}

		resultJSON, _ := json.Marshal(result)
		s.broadcastSSE(SSEEvent{Event: "complete", Data: string(resultJSON)})
	}()

	jsonResponse(w, map[string]string{"status": "started"})
}

func (s *Server) handleSyncCancel(w http.ResponseWriter, r *http.Request) {
	if s.activeSyncCancel != nil {
		s.activeSyncCancel()
		jsonResponse(w, map[string]string{"status": "cancelled"})
	} else {
		jsonError(w, "No active sync", http.StatusBadRequest)
	}
}

func (s *Server) handleQuery(w http.ResponseWriter, r *http.Request) {
	query := r.FormValue("query")
	if query == "" {
		jsonError(w, "query parameter required", http.StatusBadRequest)
		return
	}
	results, columns, err := s.db.ExecuteQuery(query)
	if err != nil {
		jsonError(w, err.Error(), http.StatusBadRequest)
		return
	}
	jsonResponse(w, map[string]interface{}{
		"columns": columns,
		"rows":    results,
		"count":   len(results),
	})
}

// Chart handlers
func (s *Server) handleChartStatus(w http.ResponseWriter, r *http.Request) {
	results, _, err := s.db.ExecuteQuery(
		`SELECT status, COUNT(*) as count FROM issues WHERE "key" LIKE '` + r.PathValue("projectKey") + `-%' GROUP BY status ORDER BY count DESC`)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, results)
}

func (s *Server) handleChartPriority(w http.ResponseWriter, r *http.Request) {
	results, _, err := s.db.ExecuteQuery(
		`SELECT priority, COUNT(*) as count FROM issues WHERE "key" LIKE '` + r.PathValue("projectKey") + `-%' AND priority IS NOT NULL GROUP BY priority ORDER BY count DESC`)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, results)
}

func (s *Server) handleChartType(w http.ResponseWriter, r *http.Request) {
	results, _, err := s.db.ExecuteQuery(
		`SELECT issue_type, COUNT(*) as count FROM issues WHERE "key" LIKE '` + r.PathValue("projectKey") + `-%' AND issue_type IS NOT NULL GROUP BY issue_type ORDER BY count DESC`)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, results)
}

func (s *Server) handleChartAssignee(w http.ResponseWriter, r *http.Request) {
	results, _, err := s.db.ExecuteQuery(
		`SELECT COALESCE(assignee, '未割当') as assignee, COUNT(*) as count FROM issues WHERE "key" LIKE '` + r.PathValue("projectKey") + `-%' GROUP BY assignee ORDER BY count DESC LIMIT 15`)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, results)
}

func (s *Server) handleChartMonthly(w http.ResponseWriter, r *http.Request) {
	results, _, err := s.db.ExecuteQuery(
		`SELECT STRFTIME(CAST(created_date AS TIMESTAMP), '%Y-%m') as month, COUNT(*) as count FROM issues WHERE "key" LIKE '` + r.PathValue("projectKey") + `-%' AND created_date IS NOT NULL GROUP BY month ORDER BY month`)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, results)
}

func (s *Server) handleChartTransitions(w http.ResponseWriter, r *http.Request) {
	pk := r.PathValue("projectKey")
	results, _, err := s.db.ExecuteQuery(
		`SELECT COALESCE(from_string, '(新規)') as from_status, to_string as to_status, COUNT(*) as count FROM issue_change_history WHERE issue_key LIKE '` + pk + `-%' AND field = 'status' AND to_string IS NOT NULL GROUP BY from_status, to_status ORDER BY count DESC`)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, results)
}

func (s *Server) handleChartFieldChanges(w http.ResponseWriter, r *http.Request) {
	pk := r.PathValue("projectKey")
	results, _, err := s.db.ExecuteQuery(
		`SELECT field, COUNT(*) as count FROM issue_change_history WHERE issue_key LIKE '` + pk + `-%' GROUP BY field ORDER BY count DESC LIMIT 10`)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, results)
}

func (s *Server) handleChartDailyStatus(w http.ResponseWriter, r *http.Request) {
	counts, err := core.ComputeDailyStatusCounts(s.db.DB)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if counts == nil {
		counts = []core.DailyStatusCount{}
	}
	jsonResponse(w, counts)
}

func (s *Server) handleChartCreatedResolved(w http.ResponseWriter, r *http.Request) {
	pk := r.PathValue("projectKey")
	results, _, err := s.db.ExecuteQuery(`
		WITH cr AS (SELECT CAST(created_date AS DATE) as dt, COUNT(*) as c FROM issues WHERE "key" LIKE '` + pk + `-%' AND created_date IS NOT NULL GROUP BY dt),
		rv AS (SELECT CAST(changed_at AS DATE) as dt, COUNT(*) as c FROM issue_change_history
			   WHERE issue_key LIKE '` + pk + `-%' AND field='status' AND to_string IN ('Done','完了','Closed','Resolved') GROUP BY dt)
		SELECT COALESCE(c.dt,r.dt) as date, COALESCE(c.c,0) as created, COALESCE(r.c,0) as resolved
		FROM cr c FULL OUTER JOIN rv r ON c.dt=r.dt ORDER BY date`)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, results)
}

func (s *Server) handleHistorySnapshot(w http.ResponseWriter, r *http.Request) {
	projectKey := r.PathValue("projectKey")
	date := r.URL.Query().Get("date")
	if date == "" {
		jsonError(w, "date parameter required", http.StatusBadRequest)
		return
	}
	snapshot, err := core.GetSnapshotAtDate(s.db.DB, projectKey, date)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if snapshot == nil {
		snapshot = []core.SnapshotIssue{}
	}
	jsonResponse(w, snapshot)
}
