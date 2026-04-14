package core

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// JiraClient is a Jira REST API v3 client.
type JiraClient struct {
	baseURL    string
	httpClient *http.Client
	headers    http.Header
}

// NewJiraClient creates a new Jira REST API client with Basic Auth.
func NewJiraClient(baseURL, username, apiToken string) *JiraClient {
	creds := base64.StdEncoding.EncodeToString([]byte(username + ":" + apiToken))
	h := http.Header{}
	h.Set("Authorization", "Basic "+creds)
	h.Set("Accept", "application/json")
	return &JiraClient{
		baseURL:    strings.TrimRight(baseURL, "/"),
		httpClient: &http.Client{Timeout: 30 * time.Second},
		headers:    h,
	}
}

// get performs a GET request with rate-limit retry.
func (c *JiraClient) get(ctx context.Context, path string, params url.Values) (json.RawMessage, error) {
	u := fmt.Sprintf("%s/rest/api/3/%s", c.baseURL, path)
	if len(params) > 0 {
		u += "?" + params.Encode()
	}

	maxRetries := 3
	for attempt := 0; attempt <= maxRetries; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
		if err != nil {
			return nil, fmt.Errorf("create request: %w", err)
		}
		req.Header = c.headers.Clone()

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, fmt.Errorf("do request: %w", err)
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode == http.StatusTooManyRequests {
			wait := 1 << (attempt + 1)
			if ra := resp.Header.Get("Retry-After"); ra != "" {
				if v, err := strconv.Atoi(ra); err == nil {
					wait = v
				}
			}
			slog.Warn("Rate limited, waiting", "seconds", wait)
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(time.Duration(wait) * time.Second):
			}
			continue
		}

		if err != nil {
			return nil, fmt.Errorf("read body: %w", err)
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body))
		}
		return json.RawMessage(body), nil
	}
	return nil, fmt.Errorf("max retries exceeded")
}

// FetchProjects returns all Jira projects.
func (c *JiraClient) FetchProjects(ctx context.Context) ([]map[string]interface{}, error) {
	data, err := c.get(ctx, "project", nil)
	if err != nil {
		return nil, err
	}
	var result []map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("unmarshal projects: %w", err)
	}
	return result, nil
}

// FetchFields returns Jira field definitions.
func (c *JiraClient) FetchFields(ctx context.Context) ([]map[string]interface{}, error) {
	data, err := c.get(ctx, "field", nil)
	if err != nil {
		return nil, err
	}
	var result []map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("unmarshal fields: %w", err)
	}
	return result, nil
}

// FetchProjectStatuses returns deduplicated statuses for a project.
func (c *JiraClient) FetchProjectStatuses(ctx context.Context, projectKey string) ([]Status, error) {
	data, err := c.get(ctx, fmt.Sprintf("project/%s/statuses", projectKey), nil)
	if err != nil {
		return nil, err
	}
	var raw []map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("unmarshal statuses: %w", err)
	}

	seen := make(map[string]bool)
	var statuses []Status
	for _, issueType := range raw {
		statusList, _ := issueType["statuses"].([]interface{})
		for _, s := range statusList {
			sm, ok := s.(map[string]interface{})
			if !ok {
				continue
			}
			name, _ := sm["name"].(string)
			if name == "" || seen[name] {
				continue
			}
			seen[name] = true
			desc, _ := sm["description"].(string)
			cat := ""
			if sc, ok := sm["statusCategory"].(map[string]interface{}); ok {
				cat, _ = sc["key"].(string)
			}
			statuses = append(statuses, Status{Name: name, Description: desc, Category: cat})
		}
	}
	return statuses, nil
}

// FetchPriorities returns all Jira priorities.
func (c *JiraClient) FetchPriorities(ctx context.Context) ([]map[string]interface{}, error) {
	data, err := c.get(ctx, "priority", nil)
	if err != nil {
		return nil, err
	}
	var result []map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("unmarshal priorities: %w", err)
	}
	return result, nil
}

// FetchIssueTypes returns issue types for a project.
func (c *JiraClient) FetchIssueTypes(ctx context.Context, projectID string) ([]map[string]interface{}, error) {
	data, err := c.get(ctx, fmt.Sprintf("issuetype/project?projectId=%s", projectID), nil)
	if err != nil {
		return nil, err
	}
	var result []map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("unmarshal issue types: %w", err)
	}
	return result, nil
}

// FetchAllIssues fetches all issues matching jql with changelog.
// Step 1: Collect all keys with fields=key
// Step 2: Batch-fetch with expand=changelog
func (c *JiraClient) FetchAllIssues(ctx context.Context, jql string, onProgress ProgressCallback) ([]map[string]interface{}, error) {
	// Step 1: Collect all issue keys
	var allKeys []string
	var pageToken string
	for {
		params := url.Values{
			"jql":        {jql},
			"fields":     {"key"},
			"maxResults": {"1000"},
		}
		if pageToken != "" {
			params.Set("nextPageToken", pageToken)
		}
		data, err := c.get(ctx, "search/jql", params)
		if err != nil {
			return nil, fmt.Errorf("fetch keys: %w", err)
		}
		var resp struct {
			Issues        []map[string]interface{} `json:"issues"`
			NextPageToken string                   `json:"nextPageToken"`
		}
		if err := json.Unmarshal(data, &resp); err != nil {
			return nil, fmt.Errorf("unmarshal keys: %w", err)
		}
		for _, iss := range resp.Issues {
			if key, ok := iss["key"].(string); ok {
				allKeys = append(allKeys, key)
			}
		}
		if resp.NextPageToken == "" {
			break
		}
		pageToken = resp.NextPageToken
	}

	total := len(allKeys)
	slog.Info("Found issue keys", "count", total)
	if onProgress != nil {
		onProgress(0, total)
	}

	// Step 2: Batch fetch with changelog
	var allIssues []map[string]interface{}
	batchSize := 50
	for i := 0; i < total; i += batchSize {
		end := i + batchSize
		if end > total {
			end = total
		}
		batchKeys := allKeys[i:end]
		keysJQL := fmt.Sprintf("key in (%s) ORDER BY updated ASC", strings.Join(batchKeys, ","))

		var batchPageToken string
		for {
			params := url.Values{
				"jql":        {keysJQL},
				"fields":     {"*navigable,created,updated"},
				"expand":     {"changelog"},
				"maxResults": {strconv.Itoa(batchSize)},
			}
			if batchPageToken != "" {
				params.Set("nextPageToken", batchPageToken)
			}
			data, err := c.get(ctx, "search/jql", params)
			if err != nil {
				return nil, fmt.Errorf("fetch batch: %w", err)
			}
			var resp struct {
				Issues        []map[string]interface{} `json:"issues"`
				NextPageToken string                   `json:"nextPageToken"`
			}
			if err := json.Unmarshal(data, &resp); err != nil {
				return nil, fmt.Errorf("unmarshal batch: %w", err)
			}
			allIssues = append(allIssues, resp.Issues...)
			if resp.NextPageToken == "" {
				break
			}
			batchPageToken = resp.NextPageToken
		}
		if onProgress != nil {
			onProgress(len(allIssues), total)
		}
	}

	slog.Info("Fetched issues with changelog", "count", len(allIssues))
	return allIssues, nil
}
