// Package web exposes the JSON API and serves the embedded SPA.
package web

import (
	"embed"
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ysksm/my_logic_example/youtube-playlist-manager/internal/jobs"
	"github.com/ysksm/my_logic_example/youtube-playlist-manager/internal/service"
	"github.com/ysksm/my_logic_example/youtube-playlist-manager/internal/store"
	"github.com/ysksm/my_logic_example/youtube-playlist-manager/internal/youtube"
)

//go:embed static
var staticFS embed.FS

// Handler returns the root http.Handler.
func Handler(svc *service.Service, jm *jobs.Manager) http.Handler {
	h := &handlers{svc: svc, st: svc.Store(), jobs: jm}
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/status", h.status)
	mux.HandleFunc("PUT /api/settings", h.putSettings)

	mux.HandleFunc("GET /api/channels", h.listChannels)
	mux.HandleFunc("POST /api/channels", h.addChannel)
	mux.HandleFunc("DELETE /api/channels/{id}", h.deleteChannel)
	mux.HandleFunc("POST /api/channels/{id}/refresh", h.refreshChannel)
	mux.HandleFunc("POST /api/channels/{id}/fetch", h.fetchVideos)
	mux.HandleFunc("POST /api/channels/{id}/refresh-stats", h.refreshStats)
	mux.HandleFunc("POST /api/channels/{id}/playlists/fetch", h.fetchPlaylists)
	mux.HandleFunc("POST /api/channels/{id}/transcripts", h.fetchChannelTranscripts)

	mux.HandleFunc("GET /api/playlists", h.listPlaylists)
	mux.HandleFunc("POST /api/playlists/{id}/fetch", h.fetchPlaylistVideos)
	mux.HandleFunc("POST /api/playlists/{id}/transcripts", h.fetchPlaylistTranscripts)

	mux.HandleFunc("GET /api/videos", h.listVideos)
	mux.HandleFunc("GET /api/videos/{id}/transcript", h.getTranscript)
	mux.HandleFunc("POST /api/videos/{id}/transcript", h.fetchTranscript)

	mux.HandleFunc("GET /api/jobs", h.listJobs)
	mux.HandleFunc("POST /api/jobs/{id}/cancel", h.cancelJob)
	mux.HandleFunc("GET /api/export", h.export)

	sub, _ := fs.Sub(staticFS, "static")
	mux.Handle("GET /", http.FileServer(http.FS(sub)))
	return logging(mux)
}

type handlers struct {
	svc  *service.Service
	st   *store.Store
	jobs *jobs.Manager
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeErr maps domain errors to HTTP status codes. extra (usually quota
// usage) is included so the UI can still show what was spent.
func writeErr(w http.ResponseWriter, err error, extra any) {
	status := http.StatusInternalServerError
	var ae *youtube.APIError
	switch {
	case errors.Is(err, store.ErrNotFound), errors.Is(err, jobs.ErrNotFound):
		status = http.StatusNotFound
	case errors.Is(err, service.ErrBusy), errors.Is(err, jobs.ErrBusy):
		status = http.StatusConflict
	case errors.Is(err, youtube.ErrNoAPIKey):
		status = http.StatusPreconditionFailed
	case youtube.IsQuotaExceeded(err):
		status = http.StatusTooManyRequests
	case errors.As(err, &ae):
		status = http.StatusBadGateway
	case strings.Contains(err.Error(), "見つかりません"), strings.Contains(err.Error(), "解釈できません"),
		strings.Contains(err.Error(), "指定されていません"):
		status = http.StatusBadRequest
	}
	writeJSON(w, status, map[string]any{"error": err.Error(), "result": extra})
}

func decode(r *http.Request, v any) error {
	if r.Body == nil || r.ContentLength == 0 {
		return nil
	}
	return json.NewDecoder(r.Body).Decode(v)
}

func maskKey(k string) string {
	if len(k) <= 8 {
		return strings.Repeat("•", len(k))
	}
	return k[:4] + strings.Repeat("•", 8) + k[len(k)-4:]
}

func (h *handlers) status(w http.ResponseWriter, r *http.Request) {
	set := h.st.Settings()
	writeJSON(w, http.StatusOK, map[string]any{
		"apiKeySource": h.svc.APIKeySource(),
		"apiKeyMasked": maskKey(set.APIKey),
		"dailyLimit":   set.DailyLimit,
		"quota":        h.st.Quota(),
	})
}

func (h *handlers) putSettings(w http.ResponseWriter, r *http.Request) {
	var body struct {
		APIKey     *string `json:"apiKey"`
		DailyLimit *int    `json:"dailyLimit"`
	}
	if err := decode(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if _, err := h.st.UpdateSettings(func(s *store.Settings) {
		if body.APIKey != nil {
			s.APIKey = strings.TrimSpace(*body.APIKey)
		}
		if body.DailyLimit != nil {
			s.DailyLimit = *body.DailyLimit
		}
	}); err != nil {
		writeErr(w, err, nil)
		return
	}
	h.status(w, r)
}

func (h *handlers) listChannels(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, h.st.Channels())
}

func (h *handlers) addChannel(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Input string `json:"input"`
	}
	if err := decode(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	ch, u, err := h.svc.AddChannel(r.Context(), body.Input)
	if err != nil {
		writeErr(w, err, u)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"channel": ch, "usage": u})
}

func (h *handlers) deleteChannel(w http.ResponseWriter, r *http.Request) {
	purge := r.URL.Query().Get("purge") != "false"
	if err := h.st.DeleteChannel(r.PathValue("id"), purge); err != nil {
		writeErr(w, err, nil)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *handlers) refreshChannel(w http.ResponseWriter, r *http.Request) {
	ch, u, err := h.svc.RefreshChannel(r.Context(), r.PathValue("id"))
	if err != nil {
		writeErr(w, err, u)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"channel": ch, "usage": u})
}

func intParam(r *http.Request, name string, def int) int {
	if v, err := strconv.Atoi(r.URL.Query().Get(name)); err == nil {
		return v
	}
	return def
}

func filterFrom(r *http.Request) store.VideoFilter {
	q := r.URL.Query()
	return store.VideoFilter{ChannelID: q.Get("channelId"), PlaylistID: q.Get("playlistId")}
}

func (h *handlers) listVideos(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, h.st.Videos(filterFrom(r)))
}

func logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		if strings.HasPrefix(r.URL.Path, "/api/") {
			log.Printf("%s %s (%s)", r.Method, r.URL.RequestURI(), time.Since(start).Round(time.Millisecond))
		}
	})
}

func (h *handlers) listPlaylists(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, h.st.Playlists(r.URL.Query().Get("channelId")))
}
