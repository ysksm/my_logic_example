// Package youtube is a minimal YouTube Data API v3 client.
//
// It only implements the endpoints the app needs and deliberately avoids the
// expensive search endpoint (100 units) wherever possible. Every call reports
// its quota cost through OnCall so the caller can keep a running total.
//
// Quota cost per request (as documented by Google):
//
//	channels.list       1
//	playlistItems.list  1
//	playlists.list      1
//	videos.list         1
//	search.list       100  (only used as a last-resort for /c/custom URLs)
package youtube

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// DefaultBaseURL is the production endpoint of the YouTube Data API v3.
const DefaultBaseURL = "https://www.googleapis.com/youtube/v3"

// Client talks to the YouTube Data API.
type Client struct {
	BaseURL string
	APIKey  string
	HTTP    *http.Client
	// OnCall is invoked after every request that reached the API (including
	// ones answered with an error, since those still consume quota).
	OnCall func(endpoint string, cost int)
}

// New returns a Client for the production API.
func New(apiKey string) *Client {
	return &Client{
		BaseURL: DefaultBaseURL,
		APIKey:  apiKey,
		HTTP:    &http.Client{Timeout: 30 * time.Second},
	}
}

// APIError is a structured error returned by the API.
type APIError struct {
	Status  int
	Reason  string
	Message string
}

func (e *APIError) Error() string {
	if e.Reason != "" {
		return fmt.Sprintf("youtube api: %d %s: %s", e.Status, e.Reason, e.Message)
	}
	return fmt.Sprintf("youtube api: %d: %s", e.Status, e.Message)
}

// IsQuotaExceeded reports whether err means the daily quota is used up.
func IsQuotaExceeded(err error) bool {
	var ae *APIError
	return errors.As(err, &ae) && (ae.Reason == "quotaExceeded" || ae.Reason == "dailyLimitExceeded")
}

// ErrNoAPIKey is returned when a request is attempted without an API key.
var ErrNoAPIKey = errors.New("YouTube API キーが設定されていません")

var costs = map[string]int{
	"channels":      1,
	"playlistItems": 1,
	"playlists":     1,
	"videos":        1,
	"search":        100,
}

// Cost returns the quota cost of one request to endpoint.
func Cost(endpoint string) int {
	if c, ok := costs[endpoint]; ok {
		return c
	}
	return 1
}

func (c *Client) get(ctx context.Context, endpoint string, params url.Values, out any) error {
	if c.APIKey == "" {
		return ErrNoAPIKey
	}
	q := url.Values{}
	for k, v := range params {
		q[k] = v
	}
	q.Set("key", c.APIKey)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+"/"+endpoint+"?"+q.Encode(), nil)
	if err != nil {
		return err
	}
	httpc := c.HTTP
	if httpc == nil {
		httpc = http.DefaultClient
	}
	resp, err := httpc.Do(req)
	if err != nil {
		return fmt.Errorf("youtube api %s: %w", endpoint, err)
	}
	defer resp.Body.Close()
	if c.OnCall != nil {
		c.OnCall(endpoint, Cost(endpoint))
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode >= 400 {
		return parseError(resp.StatusCode, body)
	}
	return json.Unmarshal(body, out)
}

func parseError(status int, body []byte) error {
	var env struct {
		Error struct {
			Message string `json:"message"`
			Errors  []struct {
				Reason string `json:"reason"`
			} `json:"errors"`
		} `json:"error"`
	}
	ae := &APIError{Status: status}
	if json.Unmarshal(body, &env) == nil && env.Error.Message != "" {
		ae.Message = env.Error.Message
		if len(env.Error.Errors) > 0 {
			ae.Reason = env.Error.Errors[0].Reason
		}
	} else {
		ae.Message = strings.TrimSpace(string(body))
		if len(ae.Message) > 200 {
			ae.Message = ae.Message[:200]
		}
	}
	return ae
}

// ── Response types ───────────────────────────────────────

// Thumbnails is the thumbnails object shared by several resources.
type Thumbnails map[string]struct {
	URL string `json:"url"`
}

// Best returns the URL of a reasonably sized thumbnail.
func (t Thumbnails) Best() string {
	for _, k := range []string{"medium", "high", "standard", "maxres", "default"} {
		if v, ok := t[k]; ok && v.URL != "" {
			return v.URL
		}
	}
	return ""
}

// Channel is a channels.list item.
type Channel struct {
	ID      string `json:"id"`
	Snippet struct {
		Title       string     `json:"title"`
		Description string     `json:"description"`
		CustomURL   string     `json:"customUrl"`
		PublishedAt string     `json:"publishedAt"`
		Thumbnails  Thumbnails `json:"thumbnails"`
	} `json:"snippet"`
	ContentDetails struct {
		RelatedPlaylists struct {
			Uploads string `json:"uploads"`
		} `json:"relatedPlaylists"`
	} `json:"contentDetails"`
	Statistics struct {
		ViewCount       string `json:"viewCount"`
		SubscriberCount string `json:"subscriberCount"`
		VideoCount      string `json:"videoCount"`
	} `json:"statistics"`
}

// Video is a videos.list item.
type Video struct {
	ID      string `json:"id"`
	Snippet struct {
		ChannelID    string     `json:"channelId"`
		ChannelTitle string     `json:"channelTitle"`
		Title        string     `json:"title"`
		Description  string     `json:"description"`
		PublishedAt  string     `json:"publishedAt"`
		Thumbnails   Thumbnails `json:"thumbnails"`
	} `json:"snippet"`
	ContentDetails struct {
		Duration string `json:"duration"`
	} `json:"contentDetails"`
	Statistics struct {
		ViewCount    string `json:"viewCount"`
		LikeCount    string `json:"likeCount"`
		CommentCount string `json:"commentCount"`
	} `json:"statistics"`
}

// Playlist is a playlists.list item.
type Playlist struct {
	ID      string `json:"id"`
	Snippet struct {
		ChannelID   string     `json:"channelId"`
		Title       string     `json:"title"`
		Description string     `json:"description"`
		PublishedAt string     `json:"publishedAt"`
		Thumbnails  Thumbnails `json:"thumbnails"`
	} `json:"snippet"`
	ContentDetails struct {
		ItemCount int `json:"itemCount"`
	} `json:"contentDetails"`
}

// PlaylistItem is a playlistItems.list item (only the fields we use).
type PlaylistItem struct {
	ContentDetails struct {
		VideoID string `json:"videoId"`
	} `json:"contentDetails"`
}

type page[T any] struct {
	NextPageToken string `json:"nextPageToken"`
	PageInfo      struct {
		TotalResults int `json:"totalResults"`
	} `json:"pageInfo"`
	Items []T `json:"items"`
}

// Atoi parses a statistics counter; missing / hidden values become 0.
func Atoi(s string) int64 {
	n, _ := strconv.ParseInt(s, 10, 64)
	return n
}

// ── Channel resolution ──────────────────────────────────

// Identifier is a parsed user input that points at a channel.
type Identifier struct {
	Kind  string // "id", "handle", "user", "custom"
	Value string
}

var (
	reChannelID = regexp.MustCompile(`^UC[0-9A-Za-z_-]{22}$`)
	urlPatterns = []struct {
		re   *regexp.Regexp
		kind string
	}{
		{regexp.MustCompile(`youtube\.com/channel/([^/?&#]+)`), "id"},
		{regexp.MustCompile(`youtube\.com/@([^/?&#]+)`), "handle"},
		{regexp.MustCompile(`youtube\.com/user/([^/?&#]+)`), "user"},
		{regexp.MustCompile(`youtube\.com/c/([^/?&#]+)`), "custom"},
	}
)

// ParseIdentifier accepts a channel URL, a UC... channel ID or an @handle.
func ParseIdentifier(input string) (Identifier, error) {
	s := strings.TrimSpace(input)
	if s == "" {
		return Identifier{}, errors.New("チャンネルが指定されていません")
	}
	for _, p := range urlPatterns {
		if m := p.re.FindStringSubmatch(s); m != nil {
			v, err := url.PathUnescape(m[1])
			if err != nil {
				v = m[1]
			}
			return Identifier{Kind: p.kind, Value: v}, nil
		}
	}
	if reChannelID.MatchString(s) {
		return Identifier{Kind: "id", Value: s}, nil
	}
	if strings.HasPrefix(s, "@") && len(s) > 1 && !strings.ContainsAny(s, " /") {
		return Identifier{Kind: "handle", Value: s[1:]}, nil
	}
	return Identifier{}, fmt.Errorf("チャンネル URL / ID / @ハンドルとして解釈できません: %q", input)
}

// ResolveChannel resolves user input into a full channel resource.
// Cost: 1 unit in the common case (ID / @handle / user), +100 for /c/ URLs.
func (c *Client) ResolveChannel(ctx context.Context, input string) (*Channel, error) {
	id, err := ParseIdentifier(input)
	if err != nil {
		return nil, err
	}
	params := url.Values{"part": {"snippet,contentDetails,statistics"}}
	switch id.Kind {
	case "id":
		params.Set("id", id.Value)
	case "handle":
		params.Set("forHandle", id.Value)
	case "user":
		params.Set("forUsername", id.Value)
	case "custom":
		// Legacy custom URLs have no direct lookup; try it as a handle first
		// (most custom names were migrated to identical handles).
		params.Set("forHandle", id.Value)
	}
	var res page[Channel]
	if err := c.get(ctx, "channels", params, &res); err != nil {
		return nil, err
	}
	if len(res.Items) > 0 {
		return &res.Items[0], nil
	}
	if id.Kind == "custom" {
		var sr page[struct {
			Snippet struct {
				ChannelID string `json:"channelId"`
			} `json:"snippet"`
		}]
		if err := c.get(ctx, "search", url.Values{
			"part": {"snippet"}, "q": {id.Value}, "type": {"channel"}, "maxResults": {"1"},
		}, &sr); err != nil {
			return nil, err
		}
		if len(sr.Items) > 0 {
			chs, err := c.Channels(ctx, []string{sr.Items[0].Snippet.ChannelID})
			if err != nil {
				return nil, err
			}
			if len(chs) > 0 {
				return &chs[0], nil
			}
		}
	}
	return nil, fmt.Errorf("チャンネルが見つかりません: %s", input)
}

// Channels fetches channel resources by ID (up to 50 per request).
func (c *Client) Channels(ctx context.Context, ids []string) ([]Channel, error) {
	var out []Channel
	for _, batch := range chunk(ids, 50) {
		var res page[Channel]
		if err := c.get(ctx, "channels", url.Values{
			"part": {"snippet,contentDetails,statistics"},
			"id":   {strings.Join(batch, ",")},
		}, &res); err != nil {
			return out, err
		}
		out = append(out, res.Items...)
	}
	return out, nil
}

// PlaylistItemsPage returns one page of video IDs from a playlist.
// Cost: 1 unit per call (max 50 items).
func (c *Client) PlaylistItemsPage(ctx context.Context, playlistID, pageToken string, maxResults int) (ids []string, next string, total int, err error) {
	params := url.Values{
		"part":       {"contentDetails"},
		"playlistId": {playlistID},
		"maxResults": {strconv.Itoa(clamp(maxResults, 1, 50))},
	}
	if pageToken != "" {
		params.Set("pageToken", pageToken)
	}
	var res page[PlaylistItem]
	if err := c.get(ctx, "playlistItems", params, &res); err != nil {
		return nil, "", 0, err
	}
	for _, it := range res.Items {
		if it.ContentDetails.VideoID != "" {
			ids = append(ids, it.ContentDetails.VideoID)
		}
	}
	return ids, res.NextPageToken, res.PageInfo.TotalResults, nil
}

// PlaylistsPage returns one page of a channel's public playlists.
// Cost: 1 unit per call (max 50 items).
func (c *Client) PlaylistsPage(ctx context.Context, channelID, pageToken string) ([]Playlist, string, error) {
	params := url.Values{
		"part":       {"snippet,contentDetails"},
		"channelId":  {channelID},
		"maxResults": {"50"},
	}
	if pageToken != "" {
		params.Set("pageToken", pageToken)
	}
	var res page[Playlist]
	if err := c.get(ctx, "playlists", params, &res); err != nil {
		return nil, "", err
	}
	return res.Items, res.NextPageToken, nil
}

// Videos fetches video details (title, description, stats…) by ID.
// Cost: 1 unit per 50 videos.
func (c *Client) Videos(ctx context.Context, ids []string) ([]Video, error) {
	var out []Video
	for _, batch := range chunk(ids, 50) {
		var res page[Video]
		if err := c.get(ctx, "videos", url.Values{
			"part": {"snippet,contentDetails,statistics"},
			"id":   {strings.Join(batch, ",")},
		}, &res); err != nil {
			return out, err
		}
		out = append(out, res.Items...)
	}
	return out, nil
}

func chunk(ids []string, n int) [][]string {
	var out [][]string
	for len(ids) > 0 {
		k := min(n, len(ids))
		out = append(out, ids[:k])
		ids = ids[k:]
	}
	return out
}

func clamp(v, lo, hi int) int {
	return max(lo, min(v, hi))
}
