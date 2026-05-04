package recorder

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/ysksm/my_logic_example/perf-investigator/pkg/events"
)

func TestRecorder_WritesNDJSON(t *testing.T) {
	dir := t.TempDir()
	r, err := New(dir, "t")
	if err != nil {
		t.Fatal(err)
	}

	for i := 0; i < 3; i++ {
		r.Emit(events.Event{
			Time:   time.Date(2026, 5, 4, 12, 0, 0, 0, time.UTC),
			Kind:   events.KindNetworkRequest,
			Source: "raw",
			Data:   json.RawMessage(`{"url":"https://example.com"}`),
		})
	}
	if err := r.Close(); err != nil {
		t.Fatal(err)
	}

	matches, _ := filepath.Glob(filepath.Join(dir, "t-2026-05-04.ndjson"))
	if len(matches) != 1 {
		t.Fatalf("expected one file, got %v", matches)
	}
	f, _ := os.Open(matches[0])
	defer f.Close()
	sc := bufio.NewScanner(f)
	count := 0
	for sc.Scan() {
		var e events.Event
		if err := json.Unmarshal(sc.Bytes(), &e); err != nil {
			t.Fatal(err)
		}
		if e.Kind != events.KindNetworkRequest {
			t.Errorf("unexpected kind %s", e.Kind)
		}
		count++
	}
	if count != 3 {
		t.Errorf("expected 3 lines, got %d", count)
	}
}
