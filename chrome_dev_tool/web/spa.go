package web

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed all:frontend/dist
var distFS embed.FS

// frontendFS returns the dist directory as an fs.FS rooted at "frontend/dist".
// If the build hasn't run yet, the FS is essentially empty and we fall through
// to a plain placeholder so the server still starts.
func frontendFS() fs.FS {
	sub, err := fs.Sub(distFS, "frontend/dist")
	if err != nil {
		return distFS
	}
	return sub
}

// spaHandler serves the embedded SPA, falling back to index.html for client-
// side routes. If the bundle is missing it serves a small placeholder so the
// server still responds during development.
func spaHandler() http.Handler {
	root := frontendFS()
	if _, err := fs.Stat(root, "index.html"); err != nil {
		return http.HandlerFunc(placeholderHandler)
	}
	fileServer := http.FileServer(http.FS(root))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			fileServer.ServeHTTP(w, r)
			return
		}
		if _, err := fs.Stat(root, path); err == nil {
			fileServer.ServeHTTP(w, r)
			return
		}
		// SPA fallback: rewrite to root so React Router (or whatever) handles it.
		r2 := *r
		r2.URL.Path = "/"
		fileServer.ServeHTTP(w, &r2)
	})
}

func placeholderHandler(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(`<!doctype html>
<html><body style="font-family:ui-monospace,monospace">
<h2>chrome_dev_tool</h2>
<p>Frontend bundle not built. Run <code>make web</code> (or <code>npm run dev</code> from <code>web/frontend</code>).</p>
<p>API endpoints: <code>/api/launch /api/shutdown /api/start /api/stop /api/snapshot /api/list /api/state</code> · WebSocket <code>/ws</code></p>
</body></html>`))
}
