package webui

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed all:static
var embeddedFS embed.FS

const notBuiltHTML = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <title>Ticket Manager (frontend not built)</title>
  </head>
  <body>
    <h1>Ticket Manager</h1>
    <p>
      フロントエンドがまだビルドされていません。<code>make run</code> または
      <code>make build</code> を実行してください。
    </p>
  </body>
</html>
`

// Handler returns an http.Handler that serves the embedded frontend build.
//
// Behaviour:
//   - Existing files under static/ are served as static assets.
//   - Any other GET path falls back to static/index.html so client-side
//     routing (react-router) works on full reloads / direct links.
//   - If the frontend has not been built (no index.html in the embedded
//     static/), every request returns a friendly placeholder page.
func Handler() http.Handler {
	sub, err := fs.Sub(embeddedFS, "static")
	if err != nil {
		return notBuiltHandler()
	}
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return notBuiltHandler()
	}
	fileServer := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			fileServer.ServeHTTP(w, r)
			return
		}
		if _, err := fs.Stat(sub, path); err == nil {
			fileServer.ServeHTTP(w, r)
			return
		}
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/"
		fileServer.ServeHTTP(w, r2)
	})
}

func notBuiltHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(notBuiltHTML))
	})
}
