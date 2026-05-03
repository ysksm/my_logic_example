package web

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/ysksm/my_logic_example/webcam-go/core"
)

const mjpegBoundary = "frame"

// handleMJPEG streams JPEG frames as multipart/x-mixed-replace, which any
// browser can render directly via <img src="..."> with no JavaScript.
func (s *Server) handleMJPEG(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, ok := s.mgr.Session(id); !ok {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "multipart/x-mixed-replace; boundary="+mjpegBoundary)
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Connection", "close")

	ch := make(chan core.Frame, 8)
	lid, err := s.mgr.Subscribe(id, ch)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	defer s.mgr.Unsubscribe(id, lid)

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case f, ok := <-ch:
			if !ok {
				return
			}
			if err := writeMJPEGPart(w, f); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func writeMJPEGPart(w http.ResponseWriter, f core.Frame) error {
	header := fmt.Sprintf(
		"\r\n--%s\r\nContent-Type: %s\r\nContent-Length: %s\r\n\r\n",
		mjpegBoundary, f.Mime, strconv.Itoa(len(f.Data)),
	)
	if _, err := w.Write([]byte(header)); err != nil {
		return err
	}
	if _, err := w.Write(f.Data); err != nil {
		return err
	}
	return nil
}
