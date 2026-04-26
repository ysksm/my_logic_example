mod collector;
mod config;

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Context, Result};
use axum::{
    extract::State,
    http::{header, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::get,
    Router,
};
use clap::Parser;
use prometheus_client::registry::Registry;
use tokio::net::TcpListener;
use tokio::signal;

use crate::collector::{build_metrics, run_collector};

#[derive(Parser, Debug)]
struct Args {
    #[arg(long, default_value = "config.toml")]
    config: PathBuf,
}

struct AppState {
    registry: Registry,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let args = Args::parse();
    let cfg = config::load(&args.config)
        .with_context(|| format!("load config {}", args.config.display()))?;
    tracing::info!(
        "loaded config from {}: addr={} path={} interval={:?}",
        args.config.display(),
        cfg.server.listen_addr,
        cfg.server.metrics_path,
        cfg.collector.interval
    );

    let (registry, metrics) = build_metrics();
    let state = Arc::new(AppState { registry });

    let collector_metrics = metrics.clone();
    let interval = cfg.collector.interval;
    let collector_handle = tokio::spawn(async move {
        run_collector(collector_metrics, interval).await;
    });

    let app = Router::new()
        .route(&cfg.server.metrics_path, get(metrics_handler))
        .route("/", get(index_handler))
        .with_state(state);

    let listener = TcpListener::bind(&cfg.server.listen_addr)
        .await
        .with_context(|| format!("bind {}", cfg.server.listen_addr))?;
    tracing::info!(
        "listening on {}{}",
        cfg.server.listen_addr,
        cfg.server.metrics_path
    );

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    collector_handle.abort();
    Ok(())
}

async fn metrics_handler(State(state): State<Arc<AppState>>) -> Response {
    let mut buf = String::new();
    if let Err(e) = prometheus_client::encoding::text::encode(&mut buf, &state.registry) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("encode error: {}", e),
        )
            .into_response();
    }
    (
        StatusCode::OK,
        [(
            header::CONTENT_TYPE,
            "application/openmetrics-text; version=1.0.0; charset=utf-8",
        )],
        buf,
    )
        .into_response()
}

async fn index_handler() -> Html<&'static str> {
    Html(
        "<!doctype html><title>m_exporter (rust)</title>\
         <h1>m_exporter (rust)</h1>\
         <p><a href=\"/metrics\">metrics</a></p>",
    )
}

async fn shutdown_signal() {
    let _ = signal::ctrl_c().await;
}
