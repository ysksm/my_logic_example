// Package transcript fetches YouTube captions (manual, auto-generated or
// auto-translated) without the Data API, so it costs no API quota.
//
// It follows the same approach as the Python youtube-transcript-api library
// (used by ../youtube_list): read INNERTUBE_API_KEY from the watch page, ask
// the innertube player endpoint for the caption tracks, then download the
// chosen track as timedtext XML.
package transcript

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// DefaultBaseURL is where watch pages and the innertube API live.
const DefaultBaseURL = "https://www.youtube.com"

var innertubeContext = map[string]any{
	"client": map[string]any{"clientName": "ANDROID", "clientVersion": "20.10.38"},
}

// Segment is one caption line.
type Segment struct {
	Start    float64 `json:"start"`
	Duration float64 `json:"duration"`
	Text     string  `json:"text"`
}

// Transcript is a downloaded caption track.
type Transcript struct {
	Language     string    `json:"language"`
	LanguageName string    `json:"languageName"`
	IsGenerated  bool      `json:"isGenerated"`
	IsTranslated bool      `json:"isTranslated"`
	Segments     []Segment `json:"segments"`
}

// Text joins all segments with newlines.
func (t *Transcript) Text() string {
	var b strings.Builder
	for _, s := range t.Segments {
		if s.Text == "" {
			continue
		}
		if b.Len() > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(s.Text)
	}
	return b.String()
}

// Errors. ErrNoTranscript and ErrUnavailable are "normal" outcomes for a
// video; ErrBlocked means YouTube is throttling us and the caller should stop.
var (
	ErrNoTranscript = errors.New("この動画には字幕がありません")
	ErrUnavailable  = errors.New("動画を再生できないため字幕を取得できません")
	ErrBlocked      = errors.New("YouTube に一時的にブロックされました。しばらく時間をおいて再実行してください")
	ErrPoToken      = errors.New("この字幕の取得には PO トークンが必要なため取得できません")
)

// Fetcher downloads transcripts.
type Fetcher struct {
	BaseURL string
	HTTP    *http.Client
	// Languages in order of preference. Manual captions are preferred over
	// auto-generated ones in the same language.
	Languages []string
	// TranslateTo, when non-empty, auto-translates another track into this
	// language if none of Languages is available.
	TranslateTo string
}

// New returns a Fetcher preferring Japanese.
func New() *Fetcher {
	jar, _ := cookiejar.New(nil)
	return &Fetcher{
		BaseURL:     DefaultBaseURL,
		HTTP:        &http.Client{Timeout: 30 * time.Second, Jar: jar},
		Languages:   []string{"ja", "ja-JP"},
		TranslateTo: "ja",
	}
}

type captionTrack struct {
	BaseURL      string `json:"baseUrl"`
	LanguageCode string `json:"languageCode"`
	Kind         string `json:"kind"`
	Name         struct {
		Runs []struct {
			Text string `json:"text"`
		} `json:"runs"`
	} `json:"name"`
	IsTranslatable bool `json:"isTranslatable"`
}

func (c captionTrack) name() string {
	if len(c.Name.Runs) > 0 {
		return c.Name.Runs[0].Text
	}
	return c.LanguageCode
}

type playerResponse struct {
	PlayabilityStatus struct {
		Status string `json:"status"`
		Reason string `json:"reason"`
	} `json:"playabilityStatus"`
	Captions struct {
		Renderer *struct {
			CaptionTracks        []captionTrack `json:"captionTracks"`
			TranslationLanguages []struct {
				LanguageCode string `json:"languageCode"`
				LanguageName struct {
					Runs []struct {
						Text string `json:"text"`
					} `json:"runs"`
				} `json:"languageName"`
			} `json:"translationLanguages"`
		} `json:"playerCaptionsTracklistRenderer"`
	} `json:"captions"`
}

var (
	reAPIKey      = regexp.MustCompile(`"INNERTUBE_API_KEY":\s*"([a-zA-Z0-9_-]+)"`)
	reConsentV    = regexp.MustCompile(`name="v" value="(.*?)"`)
	consentMarker = `action="https://consent.youtube.com/s"`
)

func (f *Fetcher) do(req *http.Request) ([]byte, error) {
	req.Header.Set("Accept-Language", "en-US")
	resp, err := f.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, ErrBlocked
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("youtube: HTTP %d", resp.StatusCode)
	}
	return body, nil
}

func (f *Fetcher) get(ctx context.Context, u string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	return f.do(req)
}

func (f *Fetcher) watchHTML(ctx context.Context, videoID string) (string, error) {
	watch := f.BaseURL + "/watch?v=" + url.QueryEscape(videoID)
	body, err := f.get(ctx, watch)
	if err != nil {
		return "", err
	}
	page := html.UnescapeString(string(body))
	if strings.Contains(page, consentMarker) {
		// EU consent interstitial: set the consent cookie and retry once.
		m := reConsentV.FindStringSubmatch(page)
		if m == nil || f.HTTP.Jar == nil {
			return "", errors.New("YouTube の同意画面を通過できませんでした")
		}
		u, _ := url.Parse(f.BaseURL)
		// Host-only cookie for the watch host (www.youtube.com in production).
		f.HTTP.Jar.SetCookies(u, []*http.Cookie{{Name: "CONSENT", Value: "YES+" + m[1], Path: "/"}})
		if body, err = f.get(ctx, watch); err != nil {
			return "", err
		}
		page = html.UnescapeString(string(body))
		if strings.Contains(page, consentMarker) {
			return "", errors.New("YouTube の同意画面を通過できませんでした")
		}
	}
	return page, nil
}

func (f *Fetcher) player(ctx context.Context, videoID string) (*playerResponse, error) {
	page, err := f.watchHTML(ctx, videoID)
	if err != nil {
		return nil, err
	}
	m := reAPIKey.FindStringSubmatch(page)
	if m == nil {
		if strings.Contains(page, `class="g-recaptcha"`) {
			return nil, ErrBlocked
		}
		return nil, errors.New("YouTube のページを解析できませんでした")
	}
	payload, _ := json.Marshal(map[string]any{"context": innertubeContext, "videoId": videoID})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		f.BaseURL+"/youtubei/v1/player?key="+url.QueryEscape(m[1]), bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	body, err := f.do(req)
	if err != nil {
		return nil, err
	}
	var pr playerResponse
	if err := json.Unmarshal(body, &pr); err != nil {
		return nil, fmt.Errorf("youtube player: %w", err)
	}
	switch st := pr.PlayabilityStatus; {
	case st.Status == "" || st.Status == "OK":
	case st.Status == "LOGIN_REQUIRED" && strings.Contains(st.Reason, "not a bot"):
		return nil, ErrBlocked
	default:
		return nil, fmt.Errorf("%w (%s: %s)", ErrUnavailable, st.Status, st.Reason)
	}
	return &pr, nil
}

// pick chooses a track: manual in a preferred language, then generated in a
// preferred language, then a translation, then whatever exists.
func (f *Fetcher) pick(pr *playerResponse) (tr captionTrack, translated bool, name string, ok bool) {
	r := pr.Captions.Renderer
	if r == nil || len(r.CaptionTracks) == 0 {
		return captionTrack{}, false, "", false
	}
	for _, generated := range []bool{false, true} {
		for _, lang := range f.Languages {
			for _, t := range r.CaptionTracks {
				if t.LanguageCode == lang && (t.Kind == "asr") == generated {
					return t, false, t.name(), true
				}
			}
		}
	}
	if f.TranslateTo != "" {
		for _, t := range r.CaptionTracks {
			if !t.IsTranslatable {
				continue
			}
			for _, tl := range r.TranslationLanguages {
				if tl.LanguageCode == f.TranslateTo {
					n := tl.LanguageCode
					if len(tl.LanguageName.Runs) > 0 {
						n = tl.LanguageName.Runs[0].Text
					}
					t.BaseURL += "&tlang=" + url.QueryEscape(f.TranslateTo)
					t.LanguageCode = f.TranslateTo
					return t, true, n, true
				}
			}
		}
	}
	// Prefer manual over generated for the fallback too.
	for _, t := range r.CaptionTracks {
		if t.Kind != "asr" {
			return t, false, t.name(), true
		}
	}
	t := r.CaptionTracks[0]
	return t, false, t.name(), true
}

type timedText struct {
	Texts []struct {
		Start string `xml:"start,attr"`
		Dur   string `xml:"dur,attr"`
		Body  string `xml:",chardata"`
	} `xml:"text"`
}

var reTags = regexp.MustCompile(`<[^>]*>`)

// Fetch downloads the best transcript for videoID.
func (f *Fetcher) Fetch(ctx context.Context, videoID string) (*Transcript, error) {
	pr, err := f.player(ctx, videoID)
	if err != nil {
		return nil, err
	}
	tr, translated, name, ok := f.pick(pr)
	if !ok {
		return nil, ErrNoTranscript
	}
	u := strings.Replace(tr.BaseURL, "&fmt=srv3", "", 1)
	if strings.Contains(u, "&exp=xpe") {
		return nil, ErrPoToken
	}
	body, err := f.get(ctx, u)
	if err != nil {
		return nil, err
	}
	var tt timedText
	if err := xml.Unmarshal(body, &tt); err != nil {
		return nil, fmt.Errorf("字幕データを解析できませんでした: %w", err)
	}
	out := &Transcript{
		Language:     tr.LanguageCode,
		LanguageName: name,
		IsGenerated:  tr.Kind == "asr" || translated,
		IsTranslated: translated,
		Segments:     make([]Segment, 0, len(tt.Texts)),
	}
	for _, t := range tt.Texts {
		start, _ := strconv.ParseFloat(t.Start, 64)
		dur, _ := strconv.ParseFloat(t.Dur, 64)
		text := strings.TrimSpace(reTags.ReplaceAllString(html.UnescapeString(t.Body), ""))
		out.Segments = append(out.Segments, Segment{Start: start, Duration: dur, Text: text})
	}
	if len(out.Segments) == 0 {
		return nil, ErrNoTranscript
	}
	return out, nil
}
