use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use chrono::{TimeZone, Utc};
use serde::Deserialize;
use serde_json::{json, Value as JV};

use crate::promql::{parse, Engine, Node, Value};
use crate::scrape::ScrapeManager;
use crate::storage::Storage;

#[derive(Clone)]
pub struct AppState {
    pub storage: Arc<Storage>,
    pub scrape: Arc<ScrapeManager>,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/v1/query", get(handle_query))
        .route("/api/v1/query_range", get(handle_query_range))
        .route("/api/v1/labels", get(handle_labels))
        .route("/api/v1/label/:name/values", get(handle_label_values))
        .route("/api/v1/series", get(handle_series))
        .route("/api/v1/targets", get(handle_targets))
        .route("/api/v1/status/buildinfo", get(handle_buildinfo))
        .route("/api/v1/metadata", get(handle_metadata))
        .route("/-/healthy", get(ok))
        .route("/-/ready", get(ok))
        .route("/", get(crate::web::index))
        .with_state(state)
}

async fn ok() -> &'static str { "ok\n" }

fn err(error_type: &str, msg: impl Into<String>) -> Json<JV> {
    Json(json!({"status":"error","errorType":error_type,"error":msg.into()}))
}
fn ok_data(data: JV) -> Json<JV> {
    Json(json!({"status":"success","data":data}))
}

fn parse_time(s: &str, default: i64) -> Result<i64, String> {
    if s.is_empty() {
        return Ok(default);
    }
    if let Ok(v) = s.parse::<f64>() {
        return Ok((v * 1000.0) as i64);
    }
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|d| d.timestamp_millis())
        .map_err(|e| e.to_string())
}

fn parse_duration_param(s: &str) -> Result<std::time::Duration, String> {
    if let Ok(v) = s.parse::<f64>() {
        return Ok(std::time::Duration::from_secs_f64(v));
    }
    crate::promql::parse::parse_dur(s).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
struct InstantQ {
    query: String,
    #[serde(default)]
    time: String,
}

async fn handle_query(State(s): State<AppState>, Query(q): Query<InstantQ>) -> Json<JV> {
    let now = Utc::now().timestamp_millis();
    let ts = match parse_time(&q.time, now) {
        Ok(t) => t,
        Err(e) => return err("bad_data", format!("bad time: {e}")),
    };
    let expr = match parse(&q.query) {
        Ok(e) => e,
        Err(e) => return err("bad_data", e.to_string()),
    };
    match Engine::new(&s.storage).instant(&expr, ts) {
        Ok(v) => ok_data(value_to_json_instant(v)),
        Err(e) => err("execution", e.to_string()),
    }
}

fn value_to_json_instant(v: Value) -> JV {
    match v {
        Value::Scalar { t, v } => json!({
            "resultType": "scalar",
            "result": [t as f64 / 1000.0, format_val(v)],
        }),
        Value::Vector(vec) => {
            let arr: Vec<JV> = vec
                .into_iter()
                .map(|s| json!({
                    "metric": s.labels.to_map(),
                    "value": [s.t as f64 / 1000.0, format_val(s.v)],
                }))
                .collect();
            json!({"resultType":"vector","result":arr})
        }
        Value::Matrix(_) => json!({"resultType":"vector","result":[]}),
    }
}

fn format_val(v: f64) -> String {
    if v.fract() == 0.0 && v.is_finite() && v.abs() < 1e15 {
        format!("{}", v as i64)
    } else {
        format!("{v}")
    }
}

#[derive(Deserialize)]
struct RangeQ {
    query: String,
    start: String,
    end: String,
    step: String,
}

async fn handle_query_range(State(s): State<AppState>, Query(q): Query<RangeQ>) -> Json<JV> {
    let start = match parse_time(&q.start, 0) {
        Ok(v) => v,
        Err(e) => return err("bad_data", format!("bad start: {e}")),
    };
    let end = match parse_time(&q.end, 0) {
        Ok(v) => v,
        Err(e) => return err("bad_data", format!("bad end: {e}")),
    };
    let step = match parse_duration_param(&q.step) {
        Ok(v) => v,
        Err(e) => return err("bad_data", format!("bad step: {e}")),
    };
    let expr = match parse(&q.query) {
        Ok(e) => e,
        Err(e) => return err("bad_data", e.to_string()),
    };
    match Engine::new(&s.storage).range(&expr, start, end, step) {
        Ok(mat) => {
            let arr: Vec<JV> = mat
                .into_iter()
                .map(|m| {
                    let values: Vec<JV> = m.samples
                        .iter()
                        .map(|s| json!([s.t as f64 / 1000.0, format_val(s.v)]))
                        .collect();
                    json!({"metric": m.labels.to_map(), "values": values})
                })
                .collect();
            ok_data(json!({"resultType":"matrix","result":arr}))
        }
        Err(e) => err("execution", e.to_string()),
    }
}

async fn handle_labels(State(s): State<AppState>) -> Json<JV> {
    ok_data(json!(s.storage.label_names()))
}

async fn handle_label_values(State(s): State<AppState>, Path(name): Path<String>) -> Json<JV> {
    ok_data(json!(s.storage.label_values(&name)))
}

#[derive(Deserialize)]
struct SeriesQ {
    #[serde(rename = "match[]", default)]
    matches: Vec<String>,
}

async fn handle_series(State(s): State<AppState>, Query(q): Query<SeriesQ>) -> Json<JV> {
    if q.matches.is_empty() {
        return err("bad_data", "missing match[]");
    }
    let mut out: Vec<JV> = Vec::new();
    for m in q.matches {
        let expr = match parse(&m) {
            Ok(e) => e,
            Err(e) => return err("bad_data", e.to_string()),
        };
        let vs = match expr {
            Node::VectorSel(v) => v,
            _ => return err("bad_data", "match[] must be a selector"),
        };
        for series in s.storage.select(&vs.matchers) {
            let g = series.read().unwrap();
            out.push(json!(g.labels.to_map()));
        }
    }
    ok_data(JV::Array(out))
}

async fn handle_targets(State(s): State<AppState>) -> Json<JV> {
    let mut active: Vec<JV> = Vec::new();
    for t in s.scrape.snapshot() {
        let last_scrape = t
            .last_scrape
            .map(|d| d.to_rfc3339())
            .unwrap_or_else(|| Utc.timestamp_opt(0, 0).unwrap().to_rfc3339());
        active.push(json!({
            "discoveredLabels": {
                "__address__": t.instance,
                "__metrics_path__": "/metrics",
                "__scheme__": "http",
                "job": t.job_name,
            },
            "labels": {"instance": t.instance, "job": t.job_name},
            "scrapePool": t.job_name,
            "scrapeUrl": t.url,
            "globalUrl": t.url,
            "lastError": t.last_error,
            "lastScrape": last_scrape,
            "lastScrapeDuration": t.last_dur_ms / 1000.0,
            "health": t.health,
        }));
    }
    ok_data(json!({"activeTargets": active, "droppedTargets": []}))
}

async fn handle_buildinfo() -> Json<JV> {
    ok_data(json!({
        "version": "0.1.0",
        "revision": "mini-prometheus-rust",
        "branch": "poc",
        "buildUser": "claude",
    }))
}

async fn handle_metadata() -> Json<JV> {
    ok_data(json!({}))
}

