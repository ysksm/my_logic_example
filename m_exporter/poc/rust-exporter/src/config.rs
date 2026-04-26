use std::path::Path;
use std::time::Duration;

use anyhow::{Context, Result};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub server: ServerConfig,
    #[serde(default)]
    pub collector: CollectorConfig,
}

#[derive(Debug, Deserialize)]
pub struct ServerConfig {
    #[serde(default = "default_listen_addr")]
    pub listen_addr: String,
    #[serde(default = "default_metrics_path")]
    pub metrics_path: String,
}

#[derive(Debug, Deserialize)]
pub struct CollectorConfig {
    #[serde(with = "humantime_serde", default = "default_interval")]
    pub interval: Duration,
    #[serde(default = "default_unit")]
    pub unit: String,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            listen_addr: default_listen_addr(),
            metrics_path: default_metrics_path(),
        }
    }
}

impl Default for CollectorConfig {
    fn default() -> Self {
        Self {
            interval: default_interval(),
            unit: default_unit(),
        }
    }
}

fn default_listen_addr() -> String {
    "0.0.0.0:9101".into()
}
fn default_metrics_path() -> String {
    "/metrics".into()
}
fn default_interval() -> Duration {
    Duration::from_secs(5)
}
fn default_unit() -> String {
    "ratio".into()
}

pub fn load(path: &Path) -> Result<Config> {
    if !path.exists() {
        return Ok(Config {
            server: ServerConfig::default(),
            collector: CollectorConfig::default(),
        });
    }
    let body = std::fs::read_to_string(path)
        .with_context(|| format!("read config file {}", path.display()))?;
    let cfg: Config = toml::from_str(&body)
        .with_context(|| format!("parse config file {}", path.display()))?;
    Ok(cfg)
}
