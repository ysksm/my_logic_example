package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/ysksm/my_logic_example/youtube-playlist-manager/internal/store"
	"github.com/ysksm/my_logic_example/youtube-playlist-manager/internal/transcript"
)

// fakeCaptions serves watch pages, the innertube player API and timedtext.
// v000 has Japanese captions, v001 has none, v002 is unavailable; others
// get a caption "text <id>". After blockAfter player calls it starts
// answering with the bot check.
type fakeCaptions struct {
	mu          sync.Mutex
	playerCalls int
	blockAfter  int
}

func (f *fakeCaptions) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/watch":
		fmt.Fprint(w, `"INNERTUBE_API_KEY": "K"`)
	case "/youtubei/v1/player":
		f.mu.Lock()
		f.playerCalls++
		blocked := f.blockAfter > 0 && f.playerCalls > f.blockAfter
		f.mu.Unlock()
		var body struct {
			VideoID string `json:"videoId"`
		}
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &body)
		switch {
		case blocked:
			fmt.Fprint(w, `{"playabilityStatus":{"status":"LOGIN_REQUIRED","reason":"Sign in to confirm you’re not a bot"}}`)
		case body.VideoID == "v001":
			fmt.Fprint(w, `{"playabilityStatus":{"status":"OK"}}`)
		case body.VideoID == "v002":
			fmt.Fprint(w, `{"playabilityStatus":{"status":"ERROR","reason":"This video is unavailable"}}`)
		default:
			fmt.Fprintf(w, `{"playabilityStatus":{"status":"OK"},"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[
				{"baseUrl":"http://%s/api/timedtext?v=%s","languageCode":"ja","name":{"runs":[{"text":"日本語"}]}}]}}}`, r.Host, body.VideoID)
		}
	case "/api/timedtext":
		fmt.Fprintf(w, `<transcript><text start="0" dur="1">text %s</text><text start="1" dur="1">line2</text></transcript>`, r.URL.Query().Get("v"))
	default:
		http.NotFound(w, r)
	}
}

func setupTranscripts(t *testing.T, n int, fc *fakeCaptions) (*Service, *store.Store, string) {
	t.Helper()
	svc, _, st := setup(t, n)
	srv := httptest.NewServer(fc)
	t.Cleanup(srv.Close)
	svc.SetTranscriptBaseURL(srv.URL)
	svc.SetTranscriptDelay(0)
	ctx := context.Background()
	if _, _, err := svc.AddChannel(ctx, "@fake"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.FetchVideos(ctx, chID, FetchAll, 0, nil); err != nil {
		t.Fatal(err)
	}
	return svc, st, srv.URL
}

func TestFetchTranscripts(t *testing.T) {
	ctx := context.Background()
	fc := &fakeCaptions{}
	svc, st, _ := setupTranscripts(t, 5, fc)

	var last string
	res, err := svc.FetchTranscripts(ctx, TranscriptScope{ChannelID: chID}, TranscriptsMissing, func(_, _ int, msg string) { last = msg })
	if err != nil {
		t.Fatal(err)
	}
	if res.Fetched != 3 || res.None != 1 || res.Failed != 1 || res.Skipped != 0 {
		t.Fatalf("first run: %+v", res)
	}
	if !strings.Contains(last, "5 / 5") {
		t.Fatalf("progress message: %q", last)
	}

	tr, err := st.Transcript("v003")
	if err != nil || tr.Text != "text v003\nline2" || tr.Language != "ja" || len(tr.Segments) != 2 {
		t.Fatalf("stored transcript: %+v %v", tr, err)
	}
	if v, _ := st.Video("v001"); v.TranscriptStatus != store.TranscriptNone {
		t.Fatalf("v001 status = %q", v.TranscriptStatus)
	}
	if v, _ := st.Video("v002"); v.TranscriptStatus != store.TranscriptError {
		t.Fatalf("v002 status = %q", v.TranscriptStatus)
	}
	if ch, _ := st.Channel(chID); ch.StoredTranscriptCount != 3 {
		t.Fatalf("channel transcript count = %d", ch.StoredTranscriptCount)
	}

	// "missing" retries only the failed one.
	fc.playerCalls = 0
	res, err = svc.FetchTranscripts(ctx, TranscriptScope{ChannelID: chID}, TranscriptsMissing, nil)
	if err != nil || res.Skipped != 4 || res.Failed != 1 || fc.playerCalls != 1 {
		t.Fatalf("missing run: %+v %v calls=%d", res, err, fc.playerCalls)
	}

	// "all" re-fetches everything.
	res, err = svc.FetchTranscripts(ctx, TranscriptScope{ChannelID: chID}, TranscriptsAll, nil)
	if err != nil || res.Fetched != 3 || res.Skipped != 0 {
		t.Fatalf("all run: %+v %v", res, err)
	}

	// Single-video re-fetch.
	one, err := svc.FetchTranscript(ctx, "v000")
	if err != nil || one.Text != "text v000\nline2" {
		t.Fatalf("single: %+v %v", one, err)
	}
	if _, err := svc.FetchTranscript(ctx, "v001"); !errors.Is(err, transcript.ErrNoTranscript) {
		t.Fatalf("single none: %v", err)
	}
}

func TestFetchTranscriptsStopsWhenBlocked(t *testing.T) {
	fc := &fakeCaptions{blockAfter: 1}
	svc, st, _ := setupTranscripts(t, 6, fc)
	res, err := svc.FetchTranscripts(context.Background(), TranscriptScope{ChannelID: chID}, TranscriptsMissing, nil)
	if !errors.Is(err, transcript.ErrBlocked) {
		t.Fatalf("want ErrBlocked, got %v", err)
	}
	if res.Fetched != 1 || res.Failed != 1 || fc.playerCalls != 2 {
		t.Fatalf("must stop right after being blocked: %+v calls=%d", res, fc.playerCalls)
	}
	// The successful one is kept; untouched videos stay pending for a retry.
	if ch, _ := st.Channel(chID); ch.StoredTranscriptCount != 1 {
		t.Fatalf("stored transcripts = %d, want 1", ch.StoredTranscriptCount)
	}
	pending := 0
	for _, v := range st.Videos(store.VideoFilter{ChannelID: chID}) {
		if v.TranscriptStatus == "" {
			pending++
		}
	}
	if pending != 4 {
		t.Fatalf("pending = %d, want 4", pending)
	}
}

func TestTranscriptPersistence(t *testing.T) {
	ctx := context.Background()
	fc := &fakeCaptions{}
	svc, _, _ := setupTranscripts(t, 1, fc)
	if _, err := svc.FetchTranscript(ctx, "v000"); err != nil {
		t.Fatal(err)
	}
	path := svc.Store().Path()
	st2, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	tr, err := st2.Transcript("v000")
	if err != nil || tr.Text != "text v000\nline2" {
		t.Fatalf("reload: %+v %v", tr, err)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(path), "transcripts", "v000.json")); err != nil {
		t.Fatalf("transcript body should be its own file: %v", err)
	}
	// Deleting the channel removes transcripts too.
	if err := st2.DeleteChannel(chID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := st2.Transcript("v000"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("transcript should be gone, got %v", err)
	}
}
