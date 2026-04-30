use axum::{extract::State, response::Html};

use crate::api::AppState;

const GRAPH_HTML: &str = include_str!("../graph.html");

pub async fn index(State(state): State<AppState>) -> Html<String> {
    let mut s = String::new();
    s.push_str("<!doctype html><html><head><title>mini-prometheus (rust)</title>");
    s.push_str("<style>body{font-family:sans-serif;margin:2rem}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:.4rem .8rem}th{background:#eee}.up{color:green}.down{color:red}</style>");
    s.push_str("</head><body><h1>mini-prometheus (rust)</h1>");
    s.push_str(r#"<p>PoC time-series DB. <a href="/graph">Graph (PromQL)</a> &middot; "#);
    s.push_str(r#"<a href="/api/v1/targets">/api/v1/targets</a> &middot; "#);
    s.push_str(r#"<a href="/api/v1/labels">/api/v1/labels</a></p>"#);
    s.push_str("<h2>Targets</h2><table><tr><th>Job</th><th>URL</th><th>Health</th><th>Last Error</th></tr>");
    for t in state.scrape.snapshot() {
        let cls = if t.health == "up" { "up" } else { "down" };
        s.push_str(&format!(
            r#"<tr><td>{}</td><td><a href="{}">{}</a></td><td class="{}">{}</td><td>{}</td></tr>"#,
            html_escape(&t.job_name),
            html_escape(&t.url),
            html_escape(&t.url),
            cls,
            html_escape(&t.health),
            html_escape(&t.last_error),
        ));
    }
    s.push_str("</table></body></html>");
    Html(s)
}

pub async fn graph() -> Html<&'static str> {
    Html(GRAPH_HTML)
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
