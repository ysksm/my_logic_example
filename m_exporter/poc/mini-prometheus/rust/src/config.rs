use std::path::Path;
use std::time::Duration;

use anyhow::Context;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub server: ServerConfig,
    #[serde(default)]
    pub storage: StorageConfig,
    #[serde(default, rename = "scrape_configs")]
    pub scrape_configs: Vec<ScrapeConfig>,
}

#[derive(Debug, Deserialize)]
pub struct ServerConfig {
    #[serde(default = "default_listen_addr")]
    pub listen_addr: String,
}
impl Default for ServerConfig {
    fn default() -> Self {
        Self { listen_addr: default_listen_addr() }
    }
}
fn default_listen_addr() -> String { "0.0.0.0:9093".into() }

#[derive(Debug, Deserialize)]
pub struct StorageConfig {
    #[serde(default = "default_retention")]
    pub retention_samples: usize,
}
impl Default for StorageConfig {
    fn default() -> Self {
        Self { retention_samples: default_retention() }
    }
}
fn default_retention() -> usize { 720 }

#[derive(Debug, Deserialize, Clone)]
pub struct ScrapeConfig {
    pub job_name: String,
    #[serde(with = "humantime_serde", default = "default_interval")]
    pub scrape_interval: Duration,
    #[serde(with = "humantime_serde", default = "default_timeout")]
    pub scrape_timeout: Duration,
    #[serde(default = "default_metrics_path")]
    pub metrics_path: String,
    #[serde(default = "default_scheme")]
    pub scheme: String,
    pub targets: Vec<String>,
}
fn default_interval() -> Duration { Duration::from_secs(15) }
fn default_timeout() -> Duration { Duration::from_secs(10) }
fn default_metrics_path() -> String { "/metrics".into() }
fn default_scheme() -> String { "http".into() }

pub fn load(path: &Path) -> anyhow::Result<Config> {
    if !path.exists() {
        return Ok(Config {
            server: ServerConfig::default(),
            storage: StorageConfig::default(),
            scrape_configs: vec![],
        });
    }
    let body = std::fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
    let cfg: Config = toml::from_str(&body).with_context(|| format!("parse {}", path.display()))?;
    Ok(cfg)
}
