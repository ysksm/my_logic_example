package web

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/ysksm/my_logic_example/cad-viewer/core"
)

type errorResponse struct {
	Error string `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		slog.Error("encode response", "error", err)
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, errorResponse{Error: msg})
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// handleUpload accepts a multipart form file under "file" and returns the
// parsed mesh as JSON ready to feed into a Babylon.js VertexData.
func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(s.cfg.MaxUploadBytes); err != nil {
		writeError(w, http.StatusBadRequest, "invalid multipart form: "+err.Error())
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing 'file' field")
		return
	}
	defer file.Close()

	if header.Size > s.cfg.MaxUploadBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "file too large")
		return
	}

	limited := io.LimitReader(file, s.cfg.MaxUploadBytes+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "read upload: "+err.Error())
		return
	}
	if int64(len(data)) > s.cfg.MaxUploadBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "file too large")
		return
	}

	name := strings.TrimSuffix(filepath.Base(header.Filename), filepath.Ext(header.Filename))
	ext := strings.ToLower(filepath.Ext(header.Filename))

	mesh, err := parseByExtension(name, ext, data)
	if err != nil {
		if errors.Is(err, core.ErrInvalidSTL) {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if errors.Is(err, errUnsupportedFormat) {
			writeError(w, http.StatusUnsupportedMediaType, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, mesh)
}

var errUnsupportedFormat = errors.New("unsupported file format")

func parseByExtension(name, ext string, data []byte) (core.Mesh, error) {
	switch ext {
	case ".stl":
		return core.ParseSTL(name, data)
	case "":
		// No extension: try STL by content.
		return core.ParseSTL(name, data)
	default:
		return core.Mesh{}, errUnsupportedFormat
	}
}
