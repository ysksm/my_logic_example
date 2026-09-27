package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ysksm/my_logic_example/youtube-playlist-manager/internal/service"
	"github.com/ysksm/my_logic_example/youtube-playlist-manager/internal/store"
)

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "d.json"))
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(Handler(service.New(st, "")))
	t.Cleanup(srv.Close)
	return srv
}

func TestStaticAndStatus(t *testing.T) {
	srv := newTestServer(t)

	for _, p := range []string{"/", "/app.js", "/style.css"} {
		res, err := http.Get(srv.URL + p)
		if err != nil || res.StatusCode != 200 {
			t.Fatalf("GET %s: %v %v", p, err, res.StatusCode)
		}
		res.Body.Close()
	}

	res, err := http.Get(srv.URL + "/api/status")
	if err != nil {
		t.Fatal(err)
	}
	var st map[string]any
	_ = json.NewDecoder(res.Body).Decode(&st)
	res.Body.Close()
	if st["apiKeySource"] != "" {
		t.Fatalf("unexpected key source: %v", st)
	}

	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/settings", strings.NewReader(`{"apiKey":"AIzaSyTESTKEY1234"}`))
	req.Header.Set("Content-Type", "application/json")
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = json.NewDecoder(res.Body).Decode(&st)
	res.Body.Close()
	if st["apiKeySource"] != "settings" || strings.Contains(st["apiKeyMasked"].(string), "TESTKEY") {
		t.Fatalf("settings not applied or key leaked: %v", st)
	}
}

func TestAddChannelWithoutKey(t *testing.T) {
	srv := newTestServer(t)
	res, err := http.Post(srv.URL+"/api/channels", "application/json", strings.NewReader(`{"input":"@x"}`))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusPreconditionFailed {
		t.Fatalf("want 412, got %d", res.StatusCode)
	}
}

func TestExportCSV(t *testing.T) {
	srv := newTestServer(t)
	res, err := http.Get(srv.URL + "/api/export?format=csv")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if !strings.HasPrefix(res.Header.Get("Content-Type"), "text/csv") {
		t.Fatalf("content-type: %s", res.Header.Get("Content-Type"))
	}
}
