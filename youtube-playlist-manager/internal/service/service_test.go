package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ysksm/my_logic_example/youtube-playlist-manager/internal/store"
)

const chID = "UCabcdefghijklmnopqrstuv"

// fakeYT is a tiny in-memory YouTube Data API.
type fakeYT struct {
	mu        sync.Mutex
	uploads   []string // newest first
	playlists map[string][]string
	calls     map[string]int
}

func newFake(n int) *fakeYT {
	f := &fakeYT{calls: map[string]int{}, playlists: map[string][]string{}}
	for i := 0; i < n; i++ {
		f.uploads = append(f.uploads, fmt.Sprintf("v%03d", i))
	}
	f.playlists["PL1"] = []string{"v005", "v001", "other1"}
	return f
}

func (f *fakeYT) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	ep := strings.TrimPrefix(r.URL.Path, "/")
	f.calls[ep]++
	q := r.URL.Query()
	var items []any
	next := ""
	switch ep {
	case "channels":
		if q.Get("forHandle") == "fake" || q.Get("id") == chID {
			items = append(items, map[string]any{
				"id":             chID,
				"snippet":        map[string]any{"title": "Fake Channel", "customUrl": "@fake"},
				"contentDetails": map[string]any{"relatedPlaylists": map[string]any{"uploads": "UU" + chID[2:]}},
				"statistics":     map[string]any{"videoCount": strconv.Itoa(len(f.uploads)), "subscriberCount": "1000"},
			})
		}
	case "playlistItems":
		list := f.uploads
		if pid := q.Get("playlistId"); !strings.HasPrefix(pid, "UU") {
			list = f.playlists[pid]
		}
		off, _ := strconv.Atoi(q.Get("pageToken"))
		n, _ := strconv.Atoi(q.Get("maxResults"))
		end := min(off+n, len(list))
		for _, id := range list[off:end] {
			items = append(items, map[string]any{"contentDetails": map[string]any{"videoId": id}})
		}
		if end < len(list) {
			next = strconv.Itoa(end)
		}
	case "videos":
		ids := strings.Split(q.Get("id"), ",")
		if len(ids) > 50 {
			http.Error(w, "too many ids", 400)
			return
		}
		for _, id := range ids {
			owner := chID
			if strings.HasPrefix(id, "other") {
				owner = "UCzzzzzzzzzzzzzzzzzzzzzz"
			}
			items = append(items, map[string]any{
				"id": id,
				"snippet": map[string]any{
					"channelId": owner, "title": "Title " + id, "description": "desc",
					"publishedAt": time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339),
				},
				"contentDetails": map[string]any{"duration": "PT4M13S"},
				"statistics":     map[string]any{"viewCount": "100", "likeCount": "10", "commentCount": "3"},
			})
		}
	case "playlists":
		items = append(items, map[string]any{
			"id":             "PL1",
			"snippet":        map[string]any{"title": "My list", "channelId": chID},
			"contentDetails": map[string]any{"itemCount": 3},
		})
	default:
		http.NotFound(w, r)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"items": items, "nextPageToken": next})
}

func setup(t *testing.T, n int) (*Service, *fakeYT, *store.Store) {
	t.Helper()
	f := newFake(n)
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	st, err := store.Open(filepath.Join(t.TempDir(), "data.json"))
	if err != nil {
		t.Fatal(err)
	}
	svc := New(st, "test-key")
	svc.SetBaseURL(srv.URL)
	return svc, f, st
}

func TestFetchFlow(t *testing.T) {
	ctx := context.Background()
	svc, f, st := setup(t, 120)

	ch, u, err := svc.AddChannel(ctx, "https://www.youtube.com/@fake")
	if err != nil {
		t.Fatal(err)
	}
	if ch.ID != chID || u.Units != 1 {
		t.Fatalf("add: %+v units=%d", ch, u.Units)
	}
	if len(st.Videos(store.VideoFilter{})) != 0 {
		t.Fatal("adding a channel must not fetch videos")
	}

	// First latest fetch: newest 50.
	r, err := svc.FetchVideos(ctx, chID, FetchLatest, 50)
	if err != nil {
		t.Fatal(err)
	}
	if r.New != 50 || r.Units != 2 || !r.HasOlder || r.ReachedEnd {
		t.Fatalf("latest#1: %+v", r)
	}

	// Continue older twice → reaches the end.
	r, err = svc.FetchVideos(ctx, chID, FetchOlder, 50)
	if err != nil || r.New != 50 {
		t.Fatalf("older#1: %+v %v", r, err)
	}
	if !st.HasVideo("v099") || st.HasVideo("v100") {
		t.Fatal("older#1 fetched the wrong range")
	}
	r, err = svc.FetchVideos(ctx, chID, FetchOlder, 50)
	if err != nil || r.New != 20 || !r.ReachedEnd {
		t.Fatalf("older#2: %+v %v", r, err)
	}
	// Further older requests cost nothing.
	r, err = svc.FetchVideos(ctx, chID, FetchOlder, 50)
	if err != nil || r.Units != 0 || !r.ReachedEnd {
		t.Fatalf("older#3: %+v %v", r, err)
	}

	// Three new uploads → incremental latest fetch reads a single page.
	f.mu.Lock()
	f.uploads = append([]string{"n2", "n1", "n0"}, f.uploads...)
	f.mu.Unlock()
	r, err = svc.FetchVideos(ctx, chID, FetchLatest, 50)
	if err != nil {
		t.Fatal(err)
	}
	if r.New != 3 || r.Units != 2 {
		t.Fatalf("latest#2: %+v", r)
	}
	if got := len(st.Videos(store.VideoFilter{ChannelID: chID})); got != 123 {
		t.Fatalf("stored %d videos, want 123", got)
	}

	// Nothing new → 1 unit (playlistItems only).
	r, err = svc.FetchVideos(ctx, chID, FetchLatest, 50)
	if err != nil || r.New != 0 || r.Units != 1 {
		t.Fatalf("latest#3: %+v %v", r, err)
	}

	// Refresh stats: 123 videos → 3 units.
	r, err = svc.RefreshStats(ctx, chID)
	if err != nil || r.Fetched != 123 || r.Units != 3 {
		t.Fatalf("stats: %+v %v", r, err)
	}

	q := st.Quota()
	if q.Used == 0 || q.Calls["videos"] == 0 {
		t.Fatalf("quota not tracked: %+v", q)
	}
}

func TestOlderWithoutPriorLatest(t *testing.T) {
	ctx := context.Background()
	svc, _, st := setup(t, 30)
	if _, _, err := svc.AddChannel(ctx, "@fake"); err != nil {
		t.Fatal(err)
	}
	// A playlist fetch stores a few of the channel's videos first.
	if _, err := svc.FetchPlaylists(ctx, chID, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.FetchPlaylistVideos(ctx, "PL1", 0); err != nil {
		t.Fatal(err)
	}
	r, err := svc.FetchVideos(ctx, chID, FetchOlder, 50)
	if err != nil {
		t.Fatal(err)
	}
	// v001 and v005 were already stored, so 28 are new.
	if r.New != 28 || !r.ReachedEnd {
		t.Fatalf("older: %+v", r)
	}
	if got := len(st.Videos(store.VideoFilter{ChannelID: chID})); got != 30 {
		t.Fatalf("stored %d, want 30", got)
	}
}

func TestPlaylists(t *testing.T) {
	ctx := context.Background()
	svc, _, st := setup(t, 10)
	if _, _, err := svc.AddChannel(ctx, "@fake"); err != nil {
		t.Fatal(err)
	}
	pr, err := svc.FetchPlaylists(ctx, chID, 0)
	if err != nil || pr.Fetched != 1 || pr.Units != 1 {
		t.Fatalf("playlists: %+v %v", pr, err)
	}
	r, err := svc.FetchPlaylistVideos(ctx, "PL1", 0)
	if err != nil || r.Fetched != 3 || !r.ReachedEnd {
		t.Fatalf("playlist videos: %+v %v", r, err)
	}
	vs := st.Videos(store.VideoFilter{PlaylistID: "PL1"})
	if len(vs) != 3 || vs[0].ID != "v005" || vs[2].ID != "other1" {
		t.Fatalf("playlist order not kept: %+v", vs)
	}
	// Re-fetching the playlist list keeps the fetched videos.
	if _, err := svc.FetchPlaylists(ctx, chID, 0); err != nil {
		t.Fatal(err)
	}
	p, _ := st.Playlist("PL1")
	if len(p.VideoIDs) != 3 {
		t.Fatal("playlist videos lost on refresh")
	}
}

func TestPersistence(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	f := newFake(5)
	srv := httptest.NewServer(f)
	defer srv.Close()

	path := filepath.Join(dir, "data.json")
	st, _ := store.Open(path)
	svc := New(st, "k")
	svc.SetBaseURL(srv.URL)
	if _, _, err := svc.AddChannel(ctx, "@fake"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.FetchVideos(ctx, chID, FetchLatest, 50); err != nil {
		t.Fatal(err)
	}

	st2, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(st2.Channels()) != 1 || len(st2.Videos(store.VideoFilter{})) != 5 || st2.Quota().Used != 3 {
		t.Fatalf("reload: ch=%d videos=%d quota=%d", len(st2.Channels()), len(st2.Videos(store.VideoFilter{})), st2.Quota().Used)
	}
	c, _ := st2.Channel(chID)
	if !c.ReachedEnd || c.StoredVideoCount != 5 {
		t.Fatalf("channel state not persisted: %+v", c)
	}
}
