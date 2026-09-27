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

	transcriptBase  string        // overridable for tests
	transcriptDelay time.Duration // pause between videos in bulk runs
}

// New creates a Service. envAPIKey, when non-empty, overrides the key saved
// in settings.
func New(st *store.Store, envAPIKey string) *Service {
	return &Service{
		st: st, baseURL: youtube.DefaultBaseURL, envKey: envAPIKey, busy: map[string]bool{},
		transcriptDelay: 1500 * time.Millisecond,
	}
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

// Progress receives progress updates of long operations. total <= 0 means
// unknown. It may be nil.
type Progress func(done, total int, message string)

func (p Progress) report(done, total int, msg string) {
	if p != nil {
		p(done, total, msg)
	}
}

// FetchMode selects which part of the uploads list to read.
type FetchMode string

const (
	// FetchLatest is the incremental update: read from the newest upload and
	// stop at the first page containing an already stored video.
	FetchLatest FetchMode = "latest"
	// FetchOlder continues past the oldest video fetched so far.
	FetchOlder FetchMode = "older"
	// FetchAll fetches every video not stored yet (latest + older to the end).
	FetchAll FetchMode = "all"
	// FetchRefetch re-reads the whole channel: every video's title,
	// description and statistics are refreshed and videos that no longer
	// exist on the channel are removed.
	FetchRefetch FetchMode = "refetch"
)

// FetchResult summarises a fetch.
type FetchResult struct {
	Usage
	Fetched    int  `json:"fetched"`
	New        int  `json:"new"`
	Removed    int  `json:"removed"`
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

// FetchVideos fetches videos of a channel. max limits the number of new
// videos for FetchLatest / FetchOlder (0 = no limit) and is ignored by
// FetchAll / FetchRefetch.
//
// Videos are stored page by page (50 at a time), so an interrupted run
// (quota exhausted, cancellation) keeps everything fetched so far and the
// next FetchOlder / FetchAll resumes where it stopped.
func (s *Service) FetchVideos(ctx context.Context, channelID string, mode FetchMode, max int, progress Progress) (FetchResult, error) {
	var res FetchResult
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
	total := int(ch.VideoCount)

	switch mode {
	case FetchLatest, FetchOlder:
		err = s.walk(ctx, c, ch, mode, max, &res, total, progress)
	case FetchAll:
		// New uploads first, then everything older than what we have.
		if err = s.walk(ctx, c, ch, FetchLatest, 0, &res, total, progress); err == nil {
			ch, _ = s.st.Channel(channelID)
			err = s.walk(ctx, c, ch, FetchOlder, 0, &res, total, progress)
		}
	case FetchRefetch:
		err = s.refetch(ctx, c, ch, &res, total, progress)
	default:
		return res, fmt.Errorf("unknown mode: %q", mode)
	}
	if ch, gerr := s.st.Channel(channelID); gerr == nil {
		res.ReachedEnd, res.HasOlder = ch.ReachedEnd, !ch.ReachedEnd
	}
	return res, err
}

// walk implements FetchLatest and FetchOlder.
func (s *Service) walk(ctx context.Context, c *youtube.Client, ch store.Channel, mode FetchMode, max int, res *FetchResult, total int, progress Progress) error {
	neverFetched := ch.LastFetchedAt.IsZero()
	token := ""
	if mode == FetchOlder {
		if ch.ReachedEnd {
			return nil
		}
		// An empty cursor means "start from the newest upload"; stored
		// videos are skipped so only unseen ones count toward max.
		token = ch.OlderPageToken
	}
	// Only move the "older" cursor when this run walks the list from the
	// cursor's position (older mode, or the very first latest run).
	moveCursor := mode == FetchOlder || neverFetched
	newCount, hitKnown := 0, false
	for max <= 0 || newCount < max {
		if err := ctx.Err(); err != nil {
			return err
		}
		per := 50
		if max > 0 {
			per = min(50, max-newCount)
		}
		page, next, _, err := c.PlaylistItemsPage(ctx, ch.UploadsPlaylistID, token, per)
		if err != nil {
			return err
		}
		var ids []string
		for _, id := range page {
			if s.st.HasVideo(id) {
				hitKnown = true
				continue
			}
			ids = append(ids, id)
		}
		n, err := s.storeVideos(ctx, c, ids)
		res.Fetched += n
		res.New += len(ids)
		newCount += len(ids)
		if err != nil {
			return err
		}
		if mode == FetchLatest && hitKnown {
			moveCursor = false
		}
		exhausted := next == ""
		if err := s.st.UpdateChannel(ch.ID, func(c *store.Channel) {
			c.LastFetchedAt = time.Now()
			if moveCursor {
				c.OlderPageToken, c.ReachedEnd = next, exhausted
			}
		}); err != nil {
			return err
		}
		stored := len(s.st.VideoIDsByChannel(ch.ID))
		progress.report(stored, total, fmt.Sprintf("保存済み %d 本（今回の新規 %d 本）", stored, res.New))
		token = next
		if exhausted || (mode == FetchLatest && hitKnown) {
			break
		}
	}
	return nil
}

// refetch re-reads the whole uploads list and every video's details.
func (s *Service) refetch(ctx context.Context, c *youtube.Client, ch store.Channel, res *FetchResult, total int, progress Progress) error {
	seen := map[string]bool{}
	token := ""
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		page, next, _, err := c.PlaylistItemsPage(ctx, ch.UploadsPlaylistID, token, 50)
		if err != nil {
			return err
		}
		for _, id := range page {
			if !s.st.HasVideo(id) {
				res.New++
			}
			seen[id] = true
		}
		n, err := s.storeVideos(ctx, c, page)
		res.Fetched += n
		if err != nil {
			return err
		}
		progress.report(len(seen), total, fmt.Sprintf("再取得 %d 本", len(seen)))
		if next == "" {
			break
		}
		token = next
	}
	// The walk completed, so anything not listed is gone from the channel.
	removed, err := s.st.PruneChannelVideos(ch.ID, seen)
	res.Removed = removed
	if err != nil {
		return err
	}
	return s.st.UpdateChannel(ch.ID, func(c *store.Channel) {
		c.LastFetchedAt = time.Now()
		c.OlderPageToken, c.ReachedEnd = "", true
	})
}

// RefreshStats re-reads statistics of every stored video of a channel.
// Cost: 1 unit per 50 stored videos.
func (s *Service) RefreshStats(ctx context.Context, channelID string, progress Progress) (FetchResult, error) {
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
	ids := s.st.VideoIDsByChannel(channelID)
	for i := 0; i < len(ids); i += 50 {
		if err := ctx.Err(); err != nil {
			return res, err
		}
		n, err := s.storeVideos(ctx, c, ids[i:min(i+50, len(ids))])
		res.Fetched += n
		if err != nil {
			return res, err
		}
		progress.report(res.Fetched, len(ids), fmt.Sprintf("統計更新 %d / %d 本", res.Fetched, len(ids)))
	}
	return res, nil
}

// ── Playlists ────────────────────────────────────────────

// PlaylistsResult summarises FetchPlaylists.
type PlaylistsResult struct {
	Usage
	Fetched int `json:"fetched"`
}

// FetchPlaylists fetches all public playlists of a channel (1 unit / 50).
func (s *Service) FetchPlaylists(ctx context.Context, channelID string, progress Progress) (PlaylistsResult, error) {
	var res PlaylistsResult
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
	for {
		if err := ctx.Err(); err != nil {
			return res, err
		}
		ps, next, err := c.PlaylistsPage(ctx, channelID, token)
		if err != nil {
			return res, err
		}
		page := make([]store.Playlist, 0, len(ps))
		for _, p := range ps {
			pub, _ := time.Parse(time.RFC3339, p.Snippet.PublishedAt)
			page = append(page, store.Playlist{
				ID: p.ID, ChannelID: channelID, Title: p.Snippet.Title,
				Description: p.Snippet.Description, ThumbnailURL: p.Snippet.Thumbnails.Best(),
				PublishedAt: pub, ItemCount: p.ContentDetails.ItemCount,
			})
		}
		if err := s.st.UpsertPlaylists(page); err != nil {
			return res, err
		}
		res.Fetched += len(page)
		progress.report(res.Fetched, 0, fmt.Sprintf("再生リスト %d 件", res.Fetched))
		if next == "" {
			return res, nil
		}
		token = next
	}
}

// FetchPlaylistVideos fetches the videos of a playlist in order
// (max <= 0 = the whole playlist). Re-running it re-reads the playlist and
// refreshes every video's details.
func (s *Service) FetchPlaylistVideos(ctx context.Context, playlistID string, max int, progress Progress) (FetchResult, error) {
	var res FetchResult
	unlock, err := s.lock("pl:" + playlistID)
	if err != nil {
		return res, err
	}
	defer unlock()
	defer s.st.Flush()
	pl, err := s.st.Playlist(playlistID)
	if err != nil {
		return res, err
	}
	c := s.client(&res.Usage)
	var ids []string
	token := ""
	for max <= 0 || len(ids) < max {
		if err := ctx.Err(); err != nil {
			return res, err
		}
		per := 50
		if max > 0 {
			per = min(50, max-len(ids))
		}
		page, next, _, err := c.PlaylistItemsPage(ctx, playlistID, token, per)
		if err != nil {
			return res, err
		}
		for _, id := range page {
			if !s.st.HasVideo(id) {
				res.New++
			}
		}
		n, err := s.storeVideos(ctx, c, page)
		res.Fetched += n
		if err != nil {
			return res, err
		}
		ids = append(ids, page...)
		progress.report(len(ids), pl.ItemCount, fmt.Sprintf("再生リストの動画 %d 本", len(ids)))
		if next == "" {
			res.ReachedEnd = true
			break
		}
		token = next
	}
	return res, s.st.SetPlaylistVideos(playlistID, ids)
}
