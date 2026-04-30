use std::sync::{Arc, RwLock};
use std::time::Instant;

use chrono::{DateTime, Utc};
use tokio::time;

use crate::config::ScrapeConfig;
use crate::parser::parse_text;
use crate::storage::Storage;

#[derive(Clone)]
pub struct TargetStatus {
    pub job_name: String,
    pub url: String,
    pub instance: String,
    pub health: String,
    pub last_scrape: Option<DateTime<Utc>>,
    pub last_error: String,
    pub last_dur_ms: f64,
}

pub struct ScrapeManager {
    pub storage: Arc<Storage>,
    pub statuses: Arc<RwLock<Vec<Arc<RwLock<TargetStatus>>>>>,
    cfg: Vec<ScrapeConfig>,
}

impl ScrapeManager {
    pub fn new(cfg: Vec<ScrapeConfig>, storage: Arc<Storage>) -> Self {
        let mut statuses = Vec::new();
        for sc in &cfg {
            for t in &sc.targets {
                let url = format!("{}://{}{}", sc.scheme, t, sc.metrics_path);
                statuses.push(Arc::new(RwLock::new(TargetStatus {
                    job_name: sc.job_name.clone(),
                    url,
                    instance: t.clone(),
                    health: "unknown".into(),
                    last_scrape: None,
                    last_error: String::new(),
                    last_dur_ms: 0.0,
                })));
            }
        }
        Self {
            storage,
            statuses: Arc::new(RwLock::new(statuses)),
            cfg,
        }
    }

    pub fn spawn_all(&self) {
        for sc in &self.cfg {
            for t in &sc.targets {
                let cfg = sc.clone();
                let target = t.clone();
                let storage = self.storage.clone();
                let statuses = self.statuses.clone();
                tokio::spawn(async move {
                    run_one(cfg, target, storage, statuses).await;
                });
            }
        }
    }

    pub fn snapshot(&self) -> Vec<TargetStatus> {
        self.statuses
            .read()
            .unwrap()
            .iter()
            .map(|s| s.read().unwrap().clone())
            .collect()
    }
}

async fn run_one(
    cfg: ScrapeConfig,
    target: String,
    storage: Arc<Storage>,
    statuses: Arc<RwLock<Vec<Arc<RwLock<TargetStatus>>>>>,
) {
    let url = format!("{}://{}{}", cfg.scheme, target, cfg.metrics_path);
    let client = reqwest::Client::builder()
        .timeout(cfg.scrape_timeout)
        .build()
        .expect("reqwest client");
    let mut interval = time::interval(cfg.scrape_interval);
    interval.set_missed_tick_behavior(time::MissedTickBehavior::Skip);
    loop {
        interval.tick().await;
        let status = {
            let g = statuses.read().unwrap();
            g.iter()
                .find(|s| {
                    let r = s.read().unwrap();
                    r.job_name == cfg.job_name && r.url == url
                })
                .cloned()
        };
        let Some(status) = status else { continue };
        scrape_once(&client, &cfg.job_name, &target, &url, &storage, &status).await;
    }
}

async fn scrape_once(
    client: &reqwest::Client,
    job: &str,
    target: &str,
    url: &str,
    storage: &Storage,
    status: &Arc<RwLock<TargetStatus>>,
) {
    let start_inst = Instant::now();
    let start_dt = Utc::now();
    let result: anyhow::Result<String> = async {
        let resp = client
            .get(url)
            .header(
                "Accept",
                "text/plain;version=0.0.4;q=0.9,application/openmetrics-text;q=0.7,*/*;q=0.5",
            )
            .send()
            .await?
            .error_for_status()?;
        Ok(resp.text().await?)
    }
    .await;
    let elapsed = start_inst.elapsed();
    let elapsed_ms = elapsed.as_secs_f64() * 1000.0;

    match result {
        Ok(body) => {
            let parsed = parse_text(&body);
            let ingest_ts = start_dt.timestamp_millis();
            for s in &parsed {
                let mut extra = s.labels.clone();
                extra.push(("job".to_string(), job.to_string()));
                extra.push(("instance".to_string(), target.to_string()));
                let t = if s.ts == 0 { ingest_ts } else { s.ts };
                storage.append(&s.metric, &extra, t, s.value);
            }
            // Synthetic metrics, mirroring Prometheus.
            let extra = vec![
                ("job".to_string(), job.to_string()),
                ("instance".to_string(), target.to_string()),
            ];
            storage.append("up", &extra, ingest_ts, 1.0);
            storage.append("scrape_duration_seconds", &extra, ingest_ts, elapsed.as_secs_f64());
            storage.append("scrape_samples_scraped", &extra, ingest_ts, parsed.len() as f64);

            let mut s = status.write().unwrap();
            s.health = "up".into();
            s.last_error.clear();
            s.last_scrape = Some(start_dt);
            s.last_dur_ms = elapsed_ms;
        }
        Err(e) => {
            let extra = vec![
                ("job".to_string(), job.to_string()),
                ("instance".to_string(), target.to_string()),
            ];
            storage.append("up", &extra, start_dt.timestamp_millis(), 0.0);

            let mut s = status.write().unwrap();
            s.health = "down".into();
            s.last_error = e.to_string();
            s.last_scrape = Some(start_dt);
            s.last_dur_ms = elapsed_ms;
            tracing::warn!(target = %url, "scrape failed: {e:#}");
        }
    }
}

