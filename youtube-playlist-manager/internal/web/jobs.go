package web

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/ysksm/my_logic_example/youtube-playlist-manager/internal/jobs"
	"github.com/ysksm/my_logic_example/youtube-playlist-manager/internal/service"
	"github.com/ysksm/my_logic_example/youtube-playlist-manager/internal/store"
	"github.com/ysksm/my_logic_example/youtube-playlist-manager/internal/transcript"
)

// start launches fn as a background job and answers 202 with the job.
func (h *handlers) start(w http.ResponseWriter, kind, target, label string, fn jobs.Func) {
	j, err := h.jobs.Start(kind, target, label, fn)
	if err != nil {
		writeErr(w, err, nil)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"job": j})
}

func (h *handlers) channelLabel(id string) (store.Channel, error) {
	return h.st.Channel(id)
}

var fetchLabels = map[service.FetchMode]string{
	service.FetchLatest:  "差分更新",
	service.FetchOlder:   "古い動画を取得",
	service.FetchAll:     "全動画を取得",
	service.FetchRefetch: "全動画を再取得",
}

// POST /api/channels/{id}/fetch?mode=latest|older|all|refetch&max=N
func (h *handlers) fetchVideos(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ch, err := h.channelLabel(id)
	if err != nil {
		writeErr(w, err, nil)
		return
	}
	mode := service.FetchMode(r.URL.Query().Get("mode"))
	if mode == "" {
		mode = service.FetchLatest
	}
	label, ok := fetchLabels[mode]
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("unknown mode: %q", mode)})
		return
	}
	max := intParam(r, "max", 0)
	h.start(w, "videos", "channel:"+id, ch.Title+": "+label, func(ctx context.Context, report jobs.Report) (any, error) {
		return h.svc.FetchVideos(ctx, id, mode, max, service.Progress(report))
	})
}

func (h *handlers) refreshStats(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ch, err := h.channelLabel(id)
	if err != nil {
		writeErr(w, err, nil)
		return
	}
	h.start(w, "stats", "channel:"+id, ch.Title+": 統計を更新", func(ctx context.Context, report jobs.Report) (any, error) {
		return h.svc.RefreshStats(ctx, id, service.Progress(report))
	})
}

func (h *handlers) fetchPlaylists(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ch, err := h.channelLabel(id)
	if err != nil {
		writeErr(w, err, nil)
		return
	}
	h.start(w, "playlists", "playlists:"+id, ch.Title+": 再生リスト一覧を取得", func(ctx context.Context, report jobs.Report) (any, error) {
		return h.svc.FetchPlaylists(ctx, id, service.Progress(report))
	})
}

// POST /api/playlists/{id}/fetch?max=N (0 = whole playlist)
func (h *handlers) fetchPlaylistVideos(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	pl, err := h.st.Playlist(id)
	if err != nil {
		writeErr(w, err, nil)
		return
	}
	max := intParam(r, "max", 0)
	h.start(w, "playlist-videos", "playlist:"+id, "「"+pl.Title+"」の動画を取得", func(ctx context.Context, report jobs.Report) (any, error) {
		return h.svc.FetchPlaylistVideos(ctx, id, max, service.Progress(report))
	})
}

func transcriptMode(r *http.Request) service.TranscriptMode {
	if r.URL.Query().Get("mode") == string(service.TranscriptsAll) {
		return service.TranscriptsAll
	}
	return service.TranscriptsMissing
}

func transcriptLabel(m service.TranscriptMode) string {
	if m == service.TranscriptsAll {
		return "字幕をすべて再取得"
	}
	return "字幕を取得（未取得分）"
}

// POST /api/channels/{id}/transcripts?mode=missing|all
func (h *handlers) fetchChannelTranscripts(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ch, err := h.channelLabel(id)
	if err != nil {
		writeErr(w, err, nil)
		return
	}
	mode := transcriptMode(r)
	h.start(w, "transcripts", "transcripts:"+id, ch.Title+": "+transcriptLabel(mode), func(ctx context.Context, report jobs.Report) (any, error) {
		return h.svc.FetchTranscripts(ctx, service.TranscriptScope{ChannelID: id}, mode, service.Progress(report))
	})
}

// POST /api/playlists/{id}/transcripts?mode=missing|all
func (h *handlers) fetchPlaylistTranscripts(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	pl, err := h.st.Playlist(id)
	if err != nil {
		writeErr(w, err, nil)
		return
	}
	mode := transcriptMode(r)
	h.start(w, "transcripts", "transcripts:"+id, "「"+pl.Title+"」: "+transcriptLabel(mode), func(ctx context.Context, report jobs.Report) (any, error) {
		return h.svc.FetchTranscripts(ctx, service.TranscriptScope{PlaylistID: id}, mode, service.Progress(report))
	})
}

// GET /api/videos/{id}/transcript
func (h *handlers) getTranscript(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	t, err := h.st.Transcript(id)
	if err != nil {
		meta, _ := h.st.TranscriptMeta(id)
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "字幕は未取得です", "meta": meta})
		return
	}
	writeJSON(w, http.StatusOK, t)
}

// POST /api/videos/{id}/transcript — fetches synchronously (one video).
func (h *handlers) fetchTranscript(w http.ResponseWriter, r *http.Request) {
	t, err := h.svc.FetchTranscript(r.Context(), r.PathValue("id"))
	if err != nil {
		status := http.StatusBadGateway
		switch {
		case errors.Is(err, store.ErrNotFound):
			status = http.StatusNotFound
		case errors.Is(err, transcript.ErrNoTranscript), errors.Is(err, transcript.ErrUnavailable):
			status = http.StatusUnprocessableEntity
		case errors.Is(err, transcript.ErrBlocked):
			status = http.StatusTooManyRequests
		}
		meta, _ := h.st.TranscriptMeta(r.PathValue("id"))
		writeJSON(w, status, map[string]any{"error": err.Error(), "meta": meta})
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (h *handlers) listJobs(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, h.jobs.List())
}

func (h *handlers) cancelJob(w http.ResponseWriter, r *http.Request) {
	if err := h.jobs.Cancel(r.PathValue("id")); err != nil {
		writeErr(w, err, nil)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
