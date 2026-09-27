package youtube

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestParseIdentifier(t *testing.T) {
	cases := []struct {
		in, kind, value string
	}{
		{"https://www.youtube.com/@GoogleDevelopers", "handle", "GoogleDevelopers"},
		{"https://www.youtube.com/@GoogleDevelopers/videos", "handle", "GoogleDevelopers"},
		{"@foo_bar", "handle", "foo_bar"},
		{"https://youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw", "id", "UC_x5XG1OV2P6uZZ5FSM9Ttw"},
		{"UC_x5XG1OV2P6uZZ5FSM9Ttw", "id", "UC_x5XG1OV2P6uZZ5FSM9Ttw"},
		{"https://www.youtube.com/user/GoogleDevelopers", "user", "GoogleDevelopers"},
		{"https://www.youtube.com/c/GoogleDevelopers?x=1", "custom", "GoogleDevelopers"},
		{"https://www.youtube.com/@%E3%83%86%E3%82%B9%E3%83%88", "handle", "テスト"},
	}
	for _, c := range cases {
		got, err := ParseIdentifier(c.in)
		if err != nil {
			t.Errorf("%q: %v", c.in, err)
			continue
		}
		if got.Kind != c.kind || got.Value != c.value {
			t.Errorf("%q: got %+v, want %s/%s", c.in, got, c.kind, c.value)
		}
	}
	for _, bad := range []string{"", "hello world", "https://example.com/"} {
		if _, err := ParseIdentifier(bad); err == nil {
			t.Errorf("%q: expected error", bad)
		}
	}
}

func TestQuotaExceededError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":{"code":403,"message":"The request cannot be completed because you have exceeded your quota.","errors":[{"reason":"quotaExceeded"}]}}`))
	}))
	defer srv.Close()

	calls := 0
	c := New("k")
	c.BaseURL = srv.URL
	c.OnCall = func(string, int) { calls++ }
	_, err := c.Videos(context.Background(), []string{"a"})
	if !IsQuotaExceeded(err) {
		t.Fatalf("want quota error, got %v", err)
	}
	if calls != 1 {
		t.Fatalf("failed calls must still be counted, got %d", calls)
	}
}

func TestNoAPIKey(t *testing.T) {
	c := New("")
	if _, err := c.Videos(context.Background(), []string{"a"}); err != ErrNoAPIKey {
		t.Fatalf("want ErrNoAPIKey, got %v", err)
	}
}

func TestChunk(t *testing.T) {
	ids := make([]string, 120)
	got := chunk(ids, 50)
	if len(got) != 3 || len(got[0]) != 50 || len(got[2]) != 20 {
		t.Fatalf("unexpected chunks: %d", len(got))
	}
}
