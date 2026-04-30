package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

type API struct {
	storage *Storage
	scrape  *ScrapeManager
}

type apiEnvelope struct {
	Status    string      `json:"status"`
	Data      interface{} `json:"data,omitempty"`
	ErrorType string      `json:"errorType,omitempty"`
	Error     string      `json:"error,omitempty"`
}

func writeJSON(w http.ResponseWriter, code int, body apiEnvelope) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(body)
}

func writeOK(w http.ResponseWriter, data interface{}) {
	writeJSON(w, http.StatusOK, apiEnvelope{Status: "success", Data: data})
}

func writeErr(w http.ResponseWriter, errType, msg string) {
	writeJSON(w, http.StatusBadRequest, apiEnvelope{Status: "error", ErrorType: errType, Error: msg})
}

func (a *API) Routes(mux *http.ServeMux) {
	mux.HandleFunc("/api/v1/query", a.handleQuery)
	mux.HandleFunc("/api/v1/query_range", a.handleQueryRange)
	mux.HandleFunc("/api/v1/labels", a.handleLabels)
	mux.HandleFunc("/api/v1/label/", a.handleLabelValues)
	mux.HandleFunc("/api/v1/series", a.handleSeries)
	mux.HandleFunc("/api/v1/targets", a.handleTargets)
	mux.HandleFunc("/api/v1/status/buildinfo", a.handleBuildInfo)
	mux.HandleFunc("/api/v1/metadata", a.handleMetadata)
	mux.HandleFunc("/-/healthy", okHandler)
	mux.HandleFunc("/-/ready", okHandler)
}

func okHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok\n"))
}

func parseTime(s string, def int64) (int64, error) {
	if s == "" {
		return def, nil
	}
	if v, err := strconv.ParseFloat(s, 64); err == nil {
		return int64(v * 1000), nil
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return 0, err
	}
	return t.UnixMilli(), nil
}

func parseDuration(s string) (time.Duration, error) {
	if v, err := strconv.ParseFloat(s, 64); err == nil {
		return time.Duration(v * float64(time.Second)), nil
	}
	return parseDur(s)
}

func (a *API) handleQuery(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("query")
	if q == "" {
		writeErr(w, "bad_data", "missing query")
		return
	}
	ts, err := parseTime(r.URL.Query().Get("time"), time.Now().UnixMilli())
	if err != nil {
		writeErr(w, "bad_data", "bad time: "+err.Error())
		return
	}
	expr, err := ParsePromQL(q)
	if err != nil {
		writeErr(w, "bad_data", err.Error())
		return
	}
	v, err := NewEngine(a.storage).Instant(expr, ts)
	if err != nil {
		writeErr(w, "execution", err.Error())
		return
	}
	writeOK(w, instantResult(v))
}

func instantResult(v Value) interface{} {
	switch x := v.(type) {
	case Scalar:
		return map[string]interface{}{
			"resultType": "scalar",
			"result":     []interface{}{float64(x.T) / 1000.0, fmt.Sprintf("%g", x.V)},
		}
	case Vector:
		out := make([]map[string]interface{}, 0, len(x))
		for _, s := range x {
			out = append(out, map[string]interface{}{
				"metric": s.Labels.Map(),
				"value":  []interface{}{float64(s.T) / 1000.0, fmt.Sprintf("%g", s.V)},
			})
		}
		return map[string]interface{}{"resultType": "vector", "result": out}
	}
	return map[string]interface{}{"resultType": "vector", "result": []interface{}{}}
}

func (a *API) handleQueryRange(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("query")
	if q == "" {
		writeErr(w, "bad_data", "missing query")
		return
	}
	start, err := parseTime(r.URL.Query().Get("start"), 0)
	if err != nil {
		writeErr(w, "bad_data", "bad start: "+err.Error())
		return
	}
	end, err := parseTime(r.URL.Query().Get("end"), 0)
	if err != nil {
		writeErr(w, "bad_data", "bad end: "+err.Error())
		return
	}
	step, err := parseDuration(r.URL.Query().Get("step"))
	if err != nil {
		writeErr(w, "bad_data", "bad step: "+err.Error())
		return
	}
	expr, err := ParsePromQL(q)
	if err != nil {
		writeErr(w, "bad_data", err.Error())
		return
	}
	mat, err := NewEngine(a.storage).Range(expr, start, end, step)
	if err != nil {
		writeErr(w, "execution", err.Error())
		return
	}
	res := make([]map[string]interface{}, 0, len(mat))
	for _, m := range mat {
		vs := make([][]interface{}, 0, len(m.Samples))
		for _, s := range m.Samples {
			vs = append(vs, []interface{}{float64(s.T) / 1000.0, fmt.Sprintf("%g", s.V)})
		}
		res = append(res, map[string]interface{}{"metric": m.Labels.Map(), "values": vs})
	}
	writeOK(w, map[string]interface{}{"resultType": "matrix", "result": res})
}

func (a *API) handleLabels(w http.ResponseWriter, r *http.Request) {
	writeOK(w, a.storage.LabelNames())
}

func (a *API) handleLabelValues(w http.ResponseWriter, r *http.Request) {
	// path is /api/v1/label/<name>/values
	rest := strings.TrimPrefix(r.URL.Path, "/api/v1/label/")
	rest = strings.TrimSuffix(rest, "/values")
	if rest == "" || strings.Contains(rest, "/") {
		writeErr(w, "bad_data", "bad label path")
		return
	}
	writeOK(w, a.storage.LabelValues(rest))
}

func (a *API) handleSeries(w http.ResponseWriter, r *http.Request) {
	matches := r.URL.Query()["match[]"]
	if len(matches) == 0 {
		writeErr(w, "bad_data", "missing match[]")
		return
	}
	out := []map[string]string{}
	for _, m := range matches {
		expr, err := ParsePromQL(m)
		if err != nil {
			writeErr(w, "bad_data", err.Error())
			return
		}
		vs, ok := expr.(*VectorSelector)
		if !ok {
			writeErr(w, "bad_data", "match[] must be a selector")
			return
		}
		for _, s := range a.storage.Select(vs.Matchers) {
			out = append(out, s.Labels.Map())
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return fmt.Sprint(out[i]) < fmt.Sprint(out[j])
	})
	writeOK(w, out)
}

func (a *API) handleTargets(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")
	out := make([]map[string]interface{}, 0)
	for _, t := range a.scrape.Targets() {
		if state == "active" || state == "" {
			out = append(out, map[string]interface{}{
				"discoveredLabels": map[string]string{
					"__address__":      strings.TrimPrefix(strings.TrimPrefix(t.URL, "http://"), "https://"),
					"__metrics_path__": "/metrics",
					"__scheme__":       "http",
					"job":              t.JobName,
				},
				"labels": map[string]string{
					"instance": parseInstance(t.URL),
					"job":      t.JobName,
				},
				"scrapePool":         t.JobName,
				"scrapeUrl":          t.URL,
				"globalUrl":          t.URL,
				"lastError":          t.LastError,
				"lastScrape":         t.LastScrape.Format(time.RFC3339Nano),
				"lastScrapeDuration": t.LastDurMS / 1000.0,
				"health":             t.Health,
			})
		}
	}
	writeOK(w, map[string]interface{}{"activeTargets": out, "droppedTargets": []interface{}{}})
}

func parseInstance(url string) string {
	s := strings.TrimPrefix(strings.TrimPrefix(url, "http://"), "https://")
	if i := strings.Index(s, "/"); i >= 0 {
		s = s[:i]
	}
	return s
}

func (a *API) handleBuildInfo(w http.ResponseWriter, r *http.Request) {
	writeOK(w, map[string]interface{}{
		"version":   "0.1.0",
		"revision":  "mini-prometheus-go",
		"branch":    "poc",
		"buildUser": "claude",
		"goVersion": "n/a",
	})
}

func (a *API) handleMetadata(w http.ResponseWriter, r *http.Request) {
	writeOK(w, map[string]interface{}{})
}
