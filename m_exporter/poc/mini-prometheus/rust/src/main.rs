mod api;
mod config;
mod parser;
mod promql;
mod scrape;
mod snapshot;
mod storage;
mod web;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

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
        "loaded config: addr={} retention={} jobs={} data_dir={:?} snapshot_interval={:?}",
        cfg.server.listen_addr,
        cfg.storage.retention_samples,
        cfg.scrape_configs.len(),
        cfg.storage.data_dir,
        cfg.storage.snapshot_interval,
    );

    let storage = Arc::new(Storage::new(cfg.storage.retention_samples));

    let snapshot_path: Option<PathBuf> = if cfg.storage.data_dir.is_empty() {
        None
    } else {
        let dir = PathBuf::from(&cfg.storage.data_dir);
        std::fs::create_dir_all(&dir)
            .with_context(|| format!("create data_dir {}", dir.display()))?;
        Some(dir.join("snapshot.json"))
    };

    if let Some(p) = &snapshot_path {
        if p.exists() {
            match snapshot::read(p, &storage) {
                Ok(n) => tracing::info!("restored {} series from {}", n, p.display()),
                Err(e) => tracing::warn!("restore snapshot {} failed: {:#}", p.display(), e),
            }
        }
    }

    let scrape = Arc::new(ScrapeManager::new(cfg.scrape_configs.clone(), storage.clone()));
    scrape.spawn_all();

    if let (Some(p), true) = (
        snapshot_path.clone(),
        cfg.storage.snapshot_interval > Duration::ZERO,
    ) {
        let st = storage.clone();
        let interval = cfg.storage.snapshot_interval;
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(interval);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            ticker.tick().await;
            loop {
                ticker.tick().await;
                if let Err(e) = snapshot::write(&p, &st) {
                    tracing::warn!("snapshot write failed: {:#}", e);
                }
            }
        });
    }

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

    if let Some(p) = &snapshot_path {
        match snapshot::write(p, &storage) {
            Ok(_) => tracing::info!("final snapshot written to {}", p.display()),
            Err(e) => tracing::warn!("final snapshot failed: {:#}", e),
        }
    }
    Ok(())
}

async fn shutdown_signal() {
    let _ = signal::ctrl_c().await;
}
