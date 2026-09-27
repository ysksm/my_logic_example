package transcript

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeTrack describes a caption track served by fakeYouTube.
type fakeTrack struct {
	lang, kind string
	lines      []string
}

type fakeYouTube struct {
	tracks      map[string][]fakeTrack // videoID → tracks
	blocked     bool
	consentOnce bool
	requests    []string
}

func (f *fakeYouTube) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.requests = append(f.requests, r.Method+" "+r.URL.Path)
	switch r.URL.Path {
	case "/watch":
		if f.consentOnce {
			if c, err := r.Cookie("CONSENT"); err != nil || !strings.HasPrefix(c.Value, "YES+") {
				fmt.Fprint(w, `<form action="https://consent.youtube.com/s"><input name="v" value="cb.123"></form>`)
				return
			}
		}
		fmt.Fprint(w, `<html><script>ytcfg.set({&quot;INNERTUBE_API_KEY&quot;: &quot;TESTKEY_123&quot;})</script></html>`)
	case "/youtubei/v1/player":
		if r.URL.Query().Get("key") != "TESTKEY_123" {
			http.Error(w, "bad key", 400)
			return
		}
		var body struct {
			VideoID string `json:"videoId"`
			Context struct {
				Client struct {
					ClientName string `json:"clientName"`
				} `json:"client"`
			} `json:"context"`
		}
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &body)
		if body.Context.Client.ClientName != "ANDROID" {
			http.Error(w, "bad client", 400)
			return
		}
		if f.blocked {
			fmt.Fprint(w, `{"playabilityStatus":{"status":"LOGIN_REQUIRED","reason":"Sign in to confirm you’re not a bot"}}`)
			return
		}
		tracks, ok := f.tracks[body.VideoID]
		if !ok {
			fmt.Fprint(w, `{"playabilityStatus":{"status":"ERROR","reason":"This video is unavailable"}}`)
			return
		}
		var ct []map[string]any
		for _, t := range tracks {
			ct = append(ct, map[string]any{
				"baseUrl":        fmt.Sprintf("http://%s/api/timedtext?v=%s&lang=%s&kind=%s&fmt=srv3", r.Host, body.VideoID, t.lang, t.kind),
				"languageCode":   t.lang,
				"kind":           t.kind,
				"name":           map[string]any{"runs": []map[string]string{{"text": "name-" + t.lang}}},
				"isTranslatable": true,
			})
		}
		resp := map[string]any{"playabilityStatus": map[string]string{"status": "OK"}}
		if len(ct) > 0 {
			resp["captions"] = map[string]any{"playerCaptionsTracklistRenderer": map[string]any{
				"captionTracks": ct,
				"translationLanguages": []map[string]any{
					{"languageCode": "ja", "languageName": map[string]any{"runs": []map[string]string{{"text": "日本語"}}}},
				},
			}}
		}
		_ = json.NewEncoder(w).Encode(resp)
	case "/api/timedtext":
		q := r.URL.Query()
		if q.Get("fmt") != "" {
			http.Error(w, "fmt must be stripped", 400)
			return
		}
		for _, t := range f.tracks[q.Get("v")] {
			if t.lang == q.Get("lang") && t.kind == q.Get("kind") {
				fmt.Fprint(w, `<?xml version="1.0" encoding="utf-8" ?><transcript>`)
				for i, l := range t.lines {
					prefix := ""
					if tl := q.Get("tlang"); tl != "" {
						prefix = "[" + tl + "]"
					}
					fmt.Fprintf(w, `<text start="%d.5" dur="2.25">%s%s</text>`, i, prefix, l)
				}
				fmt.Fprint(w, `</transcript>`)
				return
			}
		}
		http.NotFound(w, r)
	default:
		http.NotFound(w, r)
	}
}

func newTestFetcher(t *testing.T, f *fakeYouTube) *Fetcher {
	t.Helper()
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	fe := New()
	fe.BaseURL = srv.URL
	return fe
}

func TestPrefersManualJapanese(t *testing.T) {
	f := &fakeYouTube{tracks: map[string][]fakeTrack{
		"vid": {
			{lang: "en", kind: "", lines: []string{"hello"}},
			{lang: "ja", kind: "asr", lines: []string{"自動"}},
			{lang: "ja", kind: "", lines: []string{"こんにちは", "Tom &amp;amp; Jerry &amp;#39;s", "&lt;b&gt;太字&lt;/b&gt;"}},
		},
	}}
	tr, err := newTestFetcher(t, f).Fetch(context.Background(), "vid")
	if err != nil {
		t.Fatal(err)
	}
	if tr.Language != "ja" || tr.IsGenerated || tr.IsTranslated || tr.LanguageName != "name-ja" {
		t.Fatalf("wrong track: %+v", tr)
	}
	want := "こんにちは\nTom & Jerry 's\n太字"
	if tr.Text() != want {
		t.Fatalf("text = %q, want %q", tr.Text(), want)
	}
	if s := tr.Segments[1]; s.Start != 1.5 || s.Duration != 2.25 {
		t.Fatalf("segment timing: %+v", s)
	}
}

func TestFallsBackToGeneratedThenTranslation(t *testing.T) {
	f := &fakeYouTube{tracks: map[string][]fakeTrack{
		"gen": {{lang: "en", kind: "", lines: []string{"hi"}}, {lang: "ja", kind: "asr", lines: []string{"自動字幕"}}},
		"tr":  {{lang: "en", kind: "", lines: []string{"hi"}}},
	}}
	fe := newTestFetcher(t, f)
	tr, err := fe.Fetch(context.Background(), "gen")
	if err != nil || !tr.IsGenerated || tr.Language != "ja" || tr.Text() != "自動字幕" {
		t.Fatalf("generated: %+v %v", tr, err)
	}
	tr, err = fe.Fetch(context.Background(), "tr")
	if err != nil || !tr.IsTranslated || tr.Language != "ja" || tr.LanguageName != "日本語" || tr.Text() != "[ja]hi" {
		t.Fatalf("translated: %+v %v", tr, err)
	}
	// Without translation the original language is used.
	fe.TranslateTo = ""
	tr, err = fe.Fetch(context.Background(), "tr")
	if err != nil || tr.Language != "en" || tr.IsTranslated {
		t.Fatalf("fallback: %+v %v", tr, err)
	}
}

func TestErrors(t *testing.T) {
	f := &fakeYouTube{tracks: map[string][]fakeTrack{"nocaps": {}}}
	fe := newTestFetcher(t, f)
	if _, err := fe.Fetch(context.Background(), "nocaps"); !errors.Is(err, ErrNoTranscript) {
		t.Fatalf("want ErrNoTranscript, got %v", err)
	}
	if _, err := fe.Fetch(context.Background(), "missing"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("want ErrUnavailable, got %v", err)
	}
	f.blocked = true
	if _, err := fe.Fetch(context.Background(), "nocaps"); !errors.Is(err, ErrBlocked) {
		t.Fatalf("want ErrBlocked, got %v", err)
	}
}

func TestTooManyRequests(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer srv.Close()
	fe := New()
	fe.BaseURL = srv.URL
	if _, err := fe.Fetch(context.Background(), "x"); !errors.Is(err, ErrBlocked) {
		t.Fatalf("want ErrBlocked, got %v", err)
	}
}

func TestConsentCookie(t *testing.T) {
	f := &fakeYouTube{consentOnce: true, tracks: map[string][]fakeTrack{"v": {{lang: "ja", lines: []string{"ok"}}}}}
	tr, err := newTestFetcher(t, f).Fetch(context.Background(), "v")
	if err != nil {
		t.Fatal(err)
	}
	if tr.Text() != "ok" {
		t.Fatalf("text = %q", tr.Text())
	}
}
