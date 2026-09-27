// Package service holds the use cases: registering channels and fetching
// their videos / playlists on demand while keeping quota usage low.
//
// Video lists are read from each channel's "uploads" playlist
// (playlistItems.list, 1 unit / 50 videos) instead of search.list
// (100 units / 50 videos), then enriched with videos.list (1 unit / 50).
package service

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/ysksm/my_logic_example/youtube-playlist-manager/internal/store"
	"github.com/ysksm/my_logic_example/youtube-playlist-manager/internal/youtube"
)

// Service coordinates the YouTube client and the store.
type Service struct {
	st      *store.Store
	baseURL string // overridable for tests
	envKey  string // API key from the environment (takes precedence)

	mu   sync.Mutex
	busy map[string]bool
}

// New creates a Service. envAPIKey, when non-empty, overrides the key saved
// in settings.
func New(st *store.Store, envAPIKey string) *Service {
	return &Service{st: st, baseURL: youtube.DefaultBaseURL, envKey: envAPIKey, busy: map[string]bool{}}
}

// SetBaseURL points the service at a different API endpoint (tests).
func (s *Service) SetBaseURL(u string) { s.baseURL = u }

// Store exposes the underlying store for read-only handlers.
func (s *Service) Store() *store.Store { return s.st }

// APIKeySource reports where the active key comes from: "env", "settings" or "".
func (s *Service) APIKeySource() string {
	switch {
	case s.envKey != "":
		return "env"
	case s.st.Settings().APIKey != "":
		return "settings"
	}
	return ""
}

// Usage is the quota consumed by one operation.
type Usage struct {
	Units int            `json:"units"`
	Calls map[string]int `json:"calls"`
}

func (s *Service) client(u *Usage) *youtube.Client {
	key := s.envKey
	if key == "" {
		key = s.st.Settings().APIKey
	}
	c := youtube.New(key)
	c.BaseURL = s.baseURL
	u.Calls = map[string]int{}
	c.OnCall = func(endpoint string, cost int) {
		s.st.AddQuota(endpoint, cost)
		u.Units += cost
		u.Calls[endpoint]++
	}
	return c
}

// ErrBusy is returned when the same target is already being fetched.
var ErrBusy = errors.New("このチャンネル / 再生リストは取得中です")

func (s *Service) lock(key string) (func(), error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.busy[key] {
		return nil, ErrBusy
	}
	s.busy[key] = true
	return func() {
		s.mu.Lock()
		delete(s.busy, key)
		s.mu.Unlock()
	}, nil
}

// ── Channels ─────────────────────────────────────────────

func toChannel(c *youtube.Channel) store.Channel {
	return store.Channel{
		ID:                c.ID,
		Title:             c.Snippet.Title,
		Description:       c.Snippet.Description,
		CustomURL:         c.Snippet.CustomURL,
		ThumbnailURL:      c.Snippet.Thumbnails.Best(),
		UploadsPlaylistID: c.ContentDetails.RelatedPlaylists.Uploads,
		SubscriberCount:   youtube.Atoi(c.Statistics.SubscriberCount),
		VideoCount:        youtube.Atoi(c.Statistics.VideoCount),
		ViewCount:         youtube.Atoi(c.Statistics.ViewCount),
	}
}

// AddChannel resolves input (URL / ID / @handle) and registers the channel.
// It does not fetch any videos.
func (s *Service) AddChannel(ctx context.Context, input string) (store.Channel, Usage, error) {
	var u Usage
	defer s.st.Flush()
	yc, err := s.client(&u).ResolveChannel(ctx, input)
	if err != nil {
		return store.Channel{}, u, err
	}
	ch, err := s.st.UpsertChannel(toChannel(yc))
	return ch, u, err
}

// RefreshChannel re-reads channel metadata (subscriber count etc.). 1 unit.
func (s *Service) RefreshChannel(ctx context.Context, id string) (store.Channel, Usage, error) {
	var u Usage
	defer s.st.Flush()
	if _, err := s.st.Channel(id); err != nil {
		return store.Channel{}, u, err
	}
	chs, err := s.client(&u).Channels(ctx, []string{id})
	if err != nil {
		return store.Channel{}, u, err
	}
	if len(chs) == 0 {
		return store.Channel{}, u, fmt.Errorf("チャンネルが見つかりません: %s", id)
	}
	ch, err := s.st.UpsertChannel(toChannel(&chs[0]))
	return ch, u, err
}

// ── Videos ───────────────────────────────────────────────

// FetchMode selects which part of the uploads list to read.
type FetchMode string

const (
	// FetchLatest reads from the newest upload and stops as soon as it meets
	// an already stored video (incremental update).
	FetchLatest FetchMode = "latest"
	// FetchOlder continues past the oldest video fetched so far.
	FetchOlder FetchMode = "older"
)

// FetchResult summarises a fetch.
type FetchResult struct {
	Usage
	Fetched    int  `json:"fetched"`
	New        int  `json:"new"`
	ReachedEnd bool `json:"reachedEnd"`
	HasOlder   bool `json:"hasOlder"`
}

func toVideo(v *youtube.Video, now time.Time) store.Video {
	pub, _ := time.Parse(time.RFC3339, v.Snippet.PublishedAt)
	return store.Video{
		ID:           v.ID,
		ChannelID:    v.Snippet.ChannelID,
		ChannelTitle: v.Snippet.ChannelTitle,
		Title:        v.Snippet.Title,
		Description:  v.Snippet.Description,
		ThumbnailURL: v.Snippet.Thumbnails.Best(),
		PublishedAt:  pub,
		Duration:     v.ContentDetails.Duration,
		ViewCount:    youtube.Atoi(v.Statistics.ViewCount),
		LikeCount:    youtube.Atoi(v.Statistics.LikeCount),
		CommentCount: youtube.Atoi(v.Statistics.CommentCount),
		FetchedAt:    now,
	}
}

func (s *Service) storeVideos(ctx context.Context, c *youtube.Client, ids []string) (int, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	vs, err := c.Videos(ctx, ids)
	now := time.Now()
	out := make([]store.Video, 0, len(vs))
	for i := range vs {
		out = append(out, toVideo(&vs[i], now))
	}
	if serr := s.st.UpsertVideos(out); serr != nil && err == nil {
		err = serr
	}
	return len(out), err
}

// FetchVideos fetches up to max videos of a channel.
func (s *Service) FetchVideos(ctx context.Context, channelID string, mode FetchMode, max int) (FetchResult, error) {
	var res FetchResult
	if max <= 0 {
		max = 50
	}
	unlock, err := s.lock("ch:" + channelID)
	if err != nil {
		return res, err
	}
	defer unlock()
	defer s.st.Flush()

	ch, err := s.st.Channel(channelID)
	if err != nil {
		return res, err
	}
	if ch.UploadsPlaylistID == "" {
		return res, errors.New("このチャンネルには uploads 再生リストがありません")
	}
	c := s.client(&res.Usage)

	neverFetched := ch.LastFetchedAt.IsZero()
	token := ""
	if mode == FetchOlder {
		if ch.ReachedEnd {
			res.ReachedEnd = true
			return res, nil
		}
		// An empty cursor means "start from the newest upload"; stored
		// videos are skipped below so only unseen ones count toward max.
		token = ch.OlderPageToken
	} else if mode != FetchLatest {
		return res, fmt.Errorf("unknown mode: %q", mode)
	}

	var ids []string
	hitKnown, exhausted := false, false
	for len(ids) < max {
		page, next, _, err := c.PlaylistItemsPage(ctx, ch.UploadsPlaylistID, token, max-len(ids))
		if err != nil {
			// Keep whatever we managed to collect.
			n, _ := s.storeVideos(ctx, c, ids)
			res.Fetched = n
			return res, err
		}
		for _, id := range page {
			if s.st.HasVideo(id) {
				hitKnown = true
				continue
			}
			ids = append(ids, id)
		}
		token = next
		if next == "" {
			exhausted = true
			break
		}
		if mode == FetchLatest && hitKnown {
			break
		}
	}

	res.New = len(ids)
	n, err := s.storeVideos(ctx, c, ids)
	res.Fetched = n
	if err != nil {
		return res, err
	}

	uerr := s.st.UpdateChannel(channelID, func(c *store.Channel) {
		c.LastFetchedAt = time.Now()
		// Only move the "older" cursor when this run walked the list from
		// the cursor's position (older mode, or the very first latest run).
		if mode == FetchOlder || (neverFetched && !hitKnown) {
			c.OlderPageToken = token
			c.ReachedEnd = exhausted
		}
		res.ReachedEnd = c.ReachedEnd
		res.HasOlder = !c.ReachedEnd
	})
	return res, uerr
}

// RefreshStats re-reads statistics of every stored video of a channel.
// Cost: 1 unit per 50 stored videos.
func (s *Service) RefreshStats(ctx context.Context, channelID string) (FetchResult, error) {
	var res FetchResult
	unlock, err := s.lock("ch:" + channelID)
	if err != nil {
		return res, err
	}
	defer unlock()
	defer s.st.Flush()
	if _, err := s.st.Channel(channelID); err != nil {
		return res, err
	}
	c := s.client(&res.Usage)
	n, err := s.storeVideos(ctx, c, s.st.VideoIDsByChannel(channelID))
	res.Fetched = n
	return res, err
}

// ── Playlists ────────────────────────────────────────────

// PlaylistsResult summarises FetchPlaylists.
type PlaylistsResult struct {
	Usage
	Fetched int `json:"fetched"`
}

// FetchPlaylists fetches the public playlists of a channel (1 unit / 50).
func (s *Service) FetchPlaylists(ctx context.Context, channelID string, maxPages int) (PlaylistsResult, error) {
	var res PlaylistsResult
	if maxPages <= 0 {
		maxPages = 4
	}
	unlock, err := s.lock("pl-of:" + channelID)
	if err != nil {
		return res, err
	}
	defer unlock()
	defer s.st.Flush()
	if _, err := s.st.Channel(channelID); err != nil {
		return res, err
	}
	c := s.client(&res.Usage)
	token := ""
	var all []store.Playlist
	for i := 0; i < maxPages; i++ {
		ps, next, err := c.PlaylistsPage(ctx, channelID, token)
		if err != nil {
			_ = s.st.UpsertPlaylists(all)
			res.Fetched = len(all)
			return res, err
		}
		for _, p := range ps {
			pub, _ := time.Parse(time.RFC3339, p.Snippet.PublishedAt)
			all = append(all, store.Playlist{
				ID: p.ID, ChannelID: channelID, Title: p.Snippet.Title,
				Description: p.Snippet.Description, ThumbnailURL: p.Snippet.Thumbnails.Best(),
				PublishedAt: pub, ItemCount: p.ContentDetails.ItemCount,
			})
		}
		if next == "" {
			break
		}
		token = next
	}
	res.Fetched = len(all)
	return res, s.st.UpsertPlaylists(all)
}

// FetchPlaylistVideos fetches up to max videos of a playlist in order.
func (s *Service) FetchPlaylistVideos(ctx context.Context, playlistID string, max int) (FetchResult, error) {
	var res FetchResult
	if max <= 0 {
		max = 200
	}
	unlock, err := s.lock("pl:" + playlistID)
	if err != nil {
		return res, err
	}
	defer unlock()
	defer s.st.Flush()
	if _, err := s.st.Playlist(playlistID); err != nil {
		return res, err
	}
	c := s.client(&res.Usage)
	var ids []string
	token := ""
	for len(ids) < max {
		page, next, _, err := c.PlaylistItemsPage(ctx, playlistID, token, max-len(ids))
		if err != nil {
			return res, err
		}
		ids = append(ids, page...)
		if next == "" {
			res.ReachedEnd = true
			break
		}
		token = next
	}
	for _, id := range ids {
		if !s.st.HasVideo(id) {
			res.New++
		}
	}
	n, err := s.storeVideos(ctx, c, ids)
	res.Fetched = n
	if err != nil {
		return res, err
	}
	return res, s.st.SetPlaylistVideos(playlistID, ids)
}
