package main

import (
	_ "embed"
	"fmt"
	"html"
	"net/http"
	"strings"
)

//go:embed graph.html
var graphHTML []byte

func indexHandler(scrape *ScrapeManager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		var b strings.Builder
		b.WriteString(`<!doctype html><html><head><title>mini-prometheus (go)</title>`)
		b.WriteString(`<style>body{font-family:sans-serif;margin:2rem}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:.4rem .8rem}th{background:#eee}.up{color:green}.down{color:red}</style>`)
		b.WriteString(`</head><body><h1>mini-prometheus (go)</h1>`)
		b.WriteString(`<p>PoC time-series DB. <a href="/graph">Graph (PromQL)</a> &middot; `)
		b.WriteString(`<a href="/api/v1/targets">/api/v1/targets</a> &middot; `)
		b.WriteString(`<a href="/api/v1/labels">/api/v1/labels</a></p>`)
		b.WriteString(`<h2>Targets</h2><table><tr><th>Job</th><th>URL</th><th>Health</th><th>Last Error</th></tr>`)
		for _, t := range scrape.Targets() {
			cls := "down"
			if t.Health == "up" {
				cls = "up"
			}
			b.WriteString(fmt.Sprintf(
				`<tr><td>%s</td><td><a href="%s">%s</a></td><td class="%s">%s</td><td>%s</td></tr>`,
				html.EscapeString(t.JobName),
				html.EscapeString(t.URL),
				html.EscapeString(t.URL),
				cls,
				html.EscapeString(t.Health),
				html.EscapeString(t.LastError),
			))
		}
		b.WriteString(`</table></body></html>`)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(b.String()))
	}
}

func graphHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(graphHTML)
	}
}
