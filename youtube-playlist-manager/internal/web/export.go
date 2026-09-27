package web

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

// export downloads the (filtered) video list as CSV or JSON.
//
//	GET /api/export?format=csv|json&channelId=...&playlistId=...
func (h *handlers) export(w http.ResponseWriter, r *http.Request) {
	videos := h.st.Videos(filterFrom(r))
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
		_ = cw.Write([]string{"video_id", "url", "channel", "title", "published_at", "duration",
			"view_count", "like_count", "comment_count", "description"})
		for _, v := range videos {
			_ = cw.Write([]string{
				v.ID, "https://www.youtube.com/watch?v=" + v.ID, v.ChannelTitle, v.Title,
				v.PublishedAt.Format(time.RFC3339), v.Duration,
				strconv.FormatInt(v.ViewCount, 10), strconv.FormatInt(v.LikeCount, 10),
				strconv.FormatInt(v.CommentCount, 10), v.Description,
			})
		}
		cw.Flush()
	}
}
