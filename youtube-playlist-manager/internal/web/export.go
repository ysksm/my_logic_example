package web

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/ysksm/my_logic_example/youtube-playlist-manager/internal/store"
)

// exportVideo is a video plus, optionally, its transcript text.
type exportVideo struct {
	store.Video
	URL        string `json:"url"`
	Transcript string `json:"transcript,omitempty"`
}

// export downloads the (filtered) video list as CSV or JSON.
//
//	GET /api/export?format=csv|json&channelId=...&playlistId=...&transcripts=1
func (h *handlers) export(w http.ResponseWriter, r *http.Request) {
	withTranscripts := r.URL.Query().Get("transcripts") == "1"
	var videos []exportVideo
	for _, v := range h.st.Videos(filterFrom(r)) {
		ev := exportVideo{Video: v, URL: "https://www.youtube.com/watch?v=" + v.ID}
		if withTranscripts && v.TranscriptStatus == store.TranscriptOK {
			if t, err := h.st.Transcript(v.ID); err == nil {
				ev.Transcript = t.Text
			}
		}
		videos = append(videos, ev)
	}
	if videos == nil {
		videos = []exportVideo{}
	}
	stamp := time.Now().Format("20060102-150405")

	switch r.URL.Query().Get("format") {
	case "json":
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="videos-%s.json"`, stamp))
		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		_ = enc.Encode(videos)
	default:
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="videos-%s.csv"`, stamp))
		// UTF-8 BOM so Excel opens Japanese text correctly.
		_, _ = w.Write([]byte{0xEF, 0xBB, 0xBF})
		cw := csv.NewWriter(w)
		header := []string{"video_id", "url", "channel", "title", "published_at", "duration",
			"view_count", "like_count", "comment_count", "description"}
		if withTranscripts {
			header = append(header, "transcript_language", "transcript")
		}
		_ = cw.Write(header)
		for _, v := range videos {
			row := []string{
				v.ID, v.URL, v.ChannelTitle, v.Title,
				v.PublishedAt.Format(time.RFC3339), v.Duration,
				strconv.FormatInt(v.ViewCount, 10), strconv.FormatInt(v.LikeCount, 10),
				strconv.FormatInt(v.CommentCount, 10), v.Description,
			}
			if withTranscripts {
				row = append(row, v.TranscriptLanguage, v.Transcript)
			}
			_ = cw.Write(row)
		}
		cw.Flush()
	}
}
