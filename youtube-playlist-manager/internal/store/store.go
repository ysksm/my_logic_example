// Package store persists channels, videos, playlists and quota usage in a
// single JSON file. It is small enough for tens of thousands of videos and
// keeps the binary free of cgo so it cross-compiles to any OS.
package store

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// Channel is a registered channel.
type Channel struct {
	ID                string    `json:"id"`
	Title             string    `json:"title"`
	Description       string    `json:"description"`
	CustomURL         string    `json:"customUrl"`
	ThumbnailURL      string    `json:"thumbnailUrl"`
	UploadsPlaylistID string    `json:"uploadsPlaylistId"`
	SubscriberCount   int64     `json:"subscriberCount"`
	VideoCount        int64     `json:"videoCount"`
	ViewCount         int64     `json:"viewCount"`
	AddedAt           time.Time `json:"addedAt"`
	// LastFetchedAt is when the video list was last fetched (zero = never).
	LastFetchedAt time.Time `json:"lastFetchedAt"`
	// OlderPageToken continues the uploads playlist past what we already have.
	// Empty together with ReachedEnd=true means every video has been fetched.
	OlderPageToken string `json:"olderPageToken"`
	ReachedEnd     bool   `json:"reachedEnd"`
	// Derived, filled in by the store on read.
	StoredVideoCount    int `json:"storedVideoCount"`
	StoredPlaylistCount int `json:"storedPlaylistCount"`
}

// Video is a fetched video with the metadata the UI shows.
type Video struct {
	ID           string    `json:"id"`
	ChannelID    string    `json:"channelId"`
	ChannelTitle string    `json:"channelTitle"`
	Title        string    `json:"title"`
	Description  string    `json:"description"`
	ThumbnailURL string    `json:"thumbnailUrl"`
	PublishedAt  time.Time `json:"publishedAt"`
	Duration     string    `json:"duration"`
	ViewCount    int64     `json:"viewCount"`
	LikeCount    int64     `json:"likeCount"`
	CommentCount int64     `json:"commentCount"`
	FetchedAt    time.Time `json:"fetchedAt"`
}

// Playlist is a channel's public playlist.
type Playlist struct {
	ID            string    `json:"id"`
	ChannelID     string    `json:"channelId"`
	Title         string    `json:"title"`
	Description   string    `json:"description"`
	ThumbnailURL  string    `json:"thumbnailUrl"`
	PublishedAt   time.Time `json:"publishedAt"`
	ItemCount     int       `json:"itemCount"`
	VideoIDs      []string  `json:"videoIds"`
	LastFetchedAt time.Time `json:"lastFetchedAt"`
}

// Quota tracks API units used on the current Pacific-time day
// (the YouTube quota resets at midnight America/Los_Angeles).
type Quota struct {
	Date  string         `json:"date"`
	Used  int            `json:"used"`
	Calls map[string]int `json:"calls"`
}

// Settings are user-editable settings.
type Settings struct {
	APIKey     string `json:"apiKey"`
	DailyLimit int    `json:"dailyLimit"`
}

type data struct {
	Settings  Settings             `json:"settings"`
	Quota     Quota                `json:"quota"`
	Channels  map[string]*Channel  `json:"channels"`
	Videos    map[string]*Video    `json:"videos"`
	Playlists map[string]*Playlist `json:"playlists"`
}

// Store is a concurrency-safe JSON file store.
type Store struct {
	mu   sync.RWMutex
	path string
	d    data
	now  func() time.Time
}

// ErrNotFound is returned when an entity does not exist.
var ErrNotFound = errors.New("not found")

// Open loads the store at path, creating an empty one if missing.
func Open(path string) (*Store, error) {
	s := &Store{path: path, now: time.Now}
	s.d = data{
		Settings:  Settings{DailyLimit: 10000},
		Channels:  map[string]*Channel{},
		Videos:    map[string]*Video{},
		Playlists: map[string]*Playlist{},
	}
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(b, &s.d); err != nil {
		return nil, err
	}
	if s.d.Channels == nil {
		s.d.Channels = map[string]*Channel{}
	}
	if s.d.Videos == nil {
		s.d.Videos = map[string]*Video{}
	}
	if s.d.Playlists == nil {
		s.d.Playlists = map[string]*Playlist{}
	}
	if s.d.Settings.DailyLimit <= 0 {
		s.d.Settings.DailyLimit = 10000
	}
	return s, nil
}

// saveLocked writes the file atomically. Caller holds s.mu (write).
func (s *Store) saveLocked() error {
	if s.path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(&s.d, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// ── Settings / quota ─────────────────────────────────────

// Settings returns the current settings.
func (s *Store) Settings() Settings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.d.Settings
}

// UpdateSettings replaces the settings.
func (s *Store) UpdateSettings(fn func(*Settings)) (Settings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	fn(&s.d.Settings)
	if s.d.Settings.DailyLimit <= 0 {
		s.d.Settings.DailyLimit = 10000
	}
	return s.d.Settings, s.saveLocked()
}

var pacific = func() *time.Location {
	loc, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		return time.FixedZone("PST", -8*3600)
	}
	return loc
}()

func (s *Store) today() string { return s.now().In(pacific).Format("2006-01-02") }

func (s *Store) rollQuotaLocked() {
	if d := s.today(); s.d.Quota.Date != d {
		s.d.Quota = Quota{Date: d, Calls: map[string]int{}}
	}
	if s.d.Quota.Calls == nil {
		s.d.Quota.Calls = map[string]int{}
	}
}

// AddQuota records cost units for endpoint. It is kept in memory; the next
// save (which every fetch performs) persists it.
func (s *Store) AddQuota(endpoint string, cost int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rollQuotaLocked()
	s.d.Quota.Used += cost
	s.d.Quota.Calls[endpoint]++
}

// Quota returns today's usage.
func (s *Store) Quota() Quota {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rollQuotaLocked()
	q := s.d.Quota
	q.Calls = make(map[string]int, len(s.d.Quota.Calls))
	for k, v := range s.d.Quota.Calls {
		q.Calls[k] = v
	}
	return q
}

// Flush persists in-memory changes (e.g. quota counters).
func (s *Store) Flush() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saveLocked()
}

// ── Channels ─────────────────────────────────────────────

func (s *Store) decorateLocked(c Channel) Channel {
	c.StoredVideoCount, c.StoredPlaylistCount = 0, 0
	for _, v := range s.d.Videos {
		if v.ChannelID == c.ID {
			c.StoredVideoCount++
		}
	}
	for _, p := range s.d.Playlists {
		if p.ChannelID == c.ID {
			c.StoredPlaylistCount++
		}
	}
	return c
}

// Channels returns all channels in registration order.
func (s *Store) Channels() []Channel {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Channel, 0, len(s.d.Channels))
	for _, c := range s.d.Channels {
		out = append(out, s.decorateLocked(*c))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].AddedAt.Before(out[j].AddedAt) })
	return out
}

// Channel returns one channel.
func (s *Store) Channel(id string) (Channel, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	c, ok := s.d.Channels[id]
	if !ok {
		return Channel{}, ErrNotFound
	}
	return s.decorateLocked(*c), nil
}

// UpsertChannel inserts or updates a channel, preserving fetch state.
func (s *Store) UpsertChannel(c Channel) (Channel, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if old, ok := s.d.Channels[c.ID]; ok {
		c.AddedAt = old.AddedAt
		c.LastFetchedAt = old.LastFetchedAt
		c.OlderPageToken = old.OlderPageToken
		c.ReachedEnd = old.ReachedEnd
	} else if c.AddedAt.IsZero() {
		c.AddedAt = s.now()
	}
	cp := c
	s.d.Channels[c.ID] = &cp
	return s.decorateLocked(cp), s.saveLocked()
}

// UpdateChannel applies fn to an existing channel and saves.
func (s *Store) UpdateChannel(id string, fn func(*Channel)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.d.Channels[id]
	if !ok {
		return ErrNotFound
	}
	fn(c)
	return s.saveLocked()
}

// DeleteChannel removes a channel and, optionally, its videos and playlists.
func (s *Store) DeleteChannel(id string, purge bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.d.Channels[id]; !ok {
		return ErrNotFound
	}
	delete(s.d.Channels, id)
	if purge {
		for vid, v := range s.d.Videos {
			if v.ChannelID == id {
				delete(s.d.Videos, vid)
			}
		}
		for pid, p := range s.d.Playlists {
			if p.ChannelID == id {
				delete(s.d.Playlists, pid)
			}
		}
	}
	return s.saveLocked()
}

// ── Videos ───────────────────────────────────────────────

// HasVideo reports whether the video is stored.
func (s *Store) HasVideo(id string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.d.Videos[id]
	return ok
}

// UpsertVideos stores videos (replacing existing entries) and saves.
func (s *Store) UpsertVideos(vs []Video) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, v := range vs {
		cp := v
		s.d.Videos[v.ID] = &cp
	}
	return s.saveLocked()
}

// VideoFilter narrows Videos().
type VideoFilter struct {
	ChannelID  string
	PlaylistID string
}

// Videos returns videos matching f, newest first (playlist order when a
// playlist is selected).
func (s *Store) Videos(f VideoFilter) []Video {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []Video
	if f.PlaylistID != "" {
		p, ok := s.d.Playlists[f.PlaylistID]
		if !ok {
			return []Video{}
		}
		for _, id := range p.VideoIDs {
			if v, ok := s.d.Videos[id]; ok {
				out = append(out, *v)
			}
		}
		if out == nil {
			out = []Video{}
		}
		return out
	}
	out = make([]Video, 0, len(s.d.Videos))
	for _, v := range s.d.Videos {
		if f.ChannelID != "" && v.ChannelID != f.ChannelID {
			continue
		}
		out = append(out, *v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].PublishedAt.After(out[j].PublishedAt) })
	return out
}

// VideoIDsByChannel returns stored video IDs of a channel.
func (s *Store) VideoIDsByChannel(channelID string) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var ids []string
	for id, v := range s.d.Videos {
		if v.ChannelID == channelID {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids
}

// ── Playlists ────────────────────────────────────────────

// UpsertPlaylists stores playlists, preserving fetched video lists.
func (s *Store) UpsertPlaylists(ps []Playlist) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, p := range ps {
		cp := p
		if old, ok := s.d.Playlists[p.ID]; ok {
			cp.VideoIDs = old.VideoIDs
			cp.LastFetchedAt = old.LastFetchedAt
		}
		s.d.Playlists[p.ID] = &cp
	}
	return s.saveLocked()
}

// Playlists returns the playlists of a channel (all when channelID is empty).
func (s *Store) Playlists(channelID string) []Playlist {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []Playlist{}
	for _, p := range s.d.Playlists {
		if channelID == "" || p.ChannelID == channelID {
			out = append(out, *p)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].PublishedAt.After(out[j].PublishedAt) })
	return out
}

// Playlist returns one playlist.
func (s *Store) Playlist(id string) (Playlist, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	p, ok := s.d.Playlists[id]
	if !ok {
		return Playlist{}, ErrNotFound
	}
	return *p, nil
}

// SetPlaylistVideos records the ordered video IDs of a playlist.
func (s *Store) SetPlaylistVideos(id string, videoIDs []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.d.Playlists[id]
	if !ok {
		return ErrNotFound
	}
	p.VideoIDs = videoIDs
	p.LastFetchedAt = s.now()
	return s.saveLocked()
}
