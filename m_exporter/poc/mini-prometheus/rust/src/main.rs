mod api;
mod config;
mod parser;
mod promql;
mod scrape;
mod storage;
mod web;

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Context, Result};
use clap::Parser;
use tokio::net::TcpListener;
use tokio::signal;

use crate::api::AppState;
use crate::scrape::ScrapeManager;
use crate::storage::Storage;

#[derive(Parser, Debug)]
struct Args {
    #[arg(long, default_value = "config.toml")]
    config: PathBuf,
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
        "loaded config: addr={} retention={} jobs={}",
        cfg.server.listen_addr,
        cfg.storage.retention_samples,
        cfg.scrape_configs.len()
    );

    let storage = Arc::new(Storage::new(cfg.storage.retention_samples));
    let scrape = Arc::new(ScrapeManager::new(cfg.scrape_configs.clone(), storage.clone()));
    scrape.spawn_all();

    let state = AppState {
        storage: storage.clone(),
        scrape: scrape.clone(),
    };
    let app = api::router(state);

    let listener = TcpListener::bind(&cfg.server.listen_addr)
        .await
        .with_context(|| format!("bind {}", cfg.server.listen_addr))?;
    tracing::info!("listening on {}", cfg.server.listen_addr);

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    let _ = signal::ctrl_c().await;
}
