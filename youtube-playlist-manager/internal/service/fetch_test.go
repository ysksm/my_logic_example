package service

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ysksm/my_logic_example/youtube-playlist-manager/internal/store"
)

func TestFetchAllAndRefetch(t *testing.T) {
	ctx := context.Background()
	svc, f, st := setup(t, 120)
	if _, _, err := svc.AddChannel(ctx, "@fake"); err != nil {
		t.Fatal(err)
	}

	var reports int
	r, err := svc.FetchVideos(ctx, chID, FetchAll, 0, func(done, total int, msg string) {
		reports++
		if total != 120 {
			t.Errorf("total should be the channel's video count, got %d", total)
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	// 3 pages × (playlistItems + videos) = 6 units.
	if r.New != 120 || !r.ReachedEnd || r.Units != 6 || reports != 3 {
		t.Fatalf("all: %+v reports=%d", r, reports)
	}

	// Nothing left: another "all" only re-checks the first page.
	r, err = svc.FetchVideos(ctx, chID, FetchAll, 0, nil)
	if err != nil || r.New != 0 || r.Units != 1 {
		t.Fatalf("all#2: %+v %v", r, err)
	}

	// A video disappears and titles change → refetch updates and prunes.
	f.mu.Lock()
	f.uploads = append(f.uploads[:10], f.uploads[11:]...) // drop v010
	f.titleTag = " (edited)"
	f.mu.Unlock()
	if err := st.SaveTranscript(store.Transcript{VideoID: "v010", Text: "x"}); err != nil {
		t.Fatal(err)
	}
	r, err = svc.FetchVideos(ctx, chID, FetchRefetch, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	if r.Fetched != 119 || r.Removed != 1 || r.New != 0 || !r.ReachedEnd {
		t.Fatalf("refetch: %+v", r)
	}
	if st.HasVideo("v010") {
		t.Fatal("removed video must be pruned")
	}
	if _, ok := st.TranscriptMeta("v010"); ok {
		t.Fatal("pruned video's transcript must be deleted")
	}
	v, _ := st.Video("v050")
	if !strings.HasSuffix(v.Title, "(edited)") {
		t.Fatalf("title not refreshed: %q", v.Title)
	}
}

// failAfter makes the fake API fail every request after n successful ones,
// like a quota running out mid-fetch.
type failAfter struct {
	h http.Handler
	n int
}

func (f *failAfter) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if f.n <= 0 {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":{"code":403,"message":"quota","errors":[{"reason":"quotaExceeded"}]}}`))
		return
	}
	f.n--
	f.h.ServeHTTP(w, r)
}

func TestAllResumesAfterInterruption(t *testing.T) {
	ctx := context.Background()
	fake := newFake(120)
	gate := &failAfter{h: fake, n: 1 + 4} // AddChannel + 2 pages (items+videos)
	srv := httptest.NewServer(gate)
	defer srv.Close()
	st, _ := store.Open(filepath.Join(t.TempDir(), "d.json"))
	svc := New(st, "k")
	svc.SetBaseURL(srv.URL)
	if _, _, err := svc.AddChannel(ctx, "@fake"); err != nil {
		t.Fatal(err)
	}

	r, err := svc.FetchVideos(ctx, chID, FetchAll, 0, nil)
	if err == nil || r.New != 100 {
		t.Fatalf("expected an interruption after 100 videos, got %+v %v", r, err)
	}
	if got := len(st.VideoIDsByChannel(chID)); got != 100 {
		t.Fatalf("pages fetched before the failure must be kept, got %d", got)
	}

	// Quota is back: "all" picks up where it stopped.
	gate.n = 1 << 30
	r, err = svc.FetchVideos(ctx, chID, FetchAll, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := len(st.VideoIDsByChannel(chID)); got != 120 || !r.ReachedEnd {
		t.Fatalf("resume: stored %d, %+v", got, r)
	}
}

func TestFetchCanceled(t *testing.T) {
	svc, _, _ := setup(t, 10)
	if _, _, err := svc.AddChannel(context.Background(), "@fake"); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := svc.FetchVideos(ctx, chID, FetchAll, 0, nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("want context.Canceled, got %v", err)
	}
}
