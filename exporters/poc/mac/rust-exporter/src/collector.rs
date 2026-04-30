use std::sync::Arc;
use std::sync::atomic::AtomicU64;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use prometheus_client::encoding::EncodeLabelSet;
use prometheus_client::metrics::family::Family;
use prometheus_client::metrics::gauge::Gauge;
use prometheus_client::registry::Registry;
use sysinfo::{
    CpuRefreshKind, MemoryRefreshKind, RefreshKind, System, MINIMUM_CPU_UPDATE_INTERVAL,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Unit {
    Ratio,
    Percent,
}

impl Unit {
    pub fn from_str(s: &str) -> anyhow::Result<Self> {
        match s {
            "ratio" => Ok(Unit::Ratio),
            "percent" => Ok(Unit::Percent),
            other => anyhow::bail!("invalid unit {:?}: must be \"ratio\" or \"percent\"", other),
        }
    }
    fn suffix(self) -> &'static str {
        match self {
            Unit::Ratio => "ratio",
            Unit::Percent => "percent",
        }
    }
    fn range_text(self) -> &'static str {
        match self {
            Unit::Ratio => "(0-1)",
            Unit::Percent => "(0-100)",
        }
    }
    /// Multiplier applied to a 0-100 percent input to land in the configured unit.
    fn from_percent_factor(self) -> f64 {
        match self {
            Unit::Ratio => 0.01,
            Unit::Percent => 1.0,
        }
    }
}

#[derive(Clone, Hash, PartialEq, Eq, Debug, EncodeLabelSet)]
pub struct CpuLabels {
    pub cpu: String,
}

#[derive(Default, Clone)]
pub struct Metrics {
    pub cpu_usage: Family<CpuLabels, Gauge<f64, AtomicU64>>,
    pub mem_total_bytes: Gauge<f64, AtomicU64>,
    pub mem_used_bytes: Gauge<f64, AtomicU64>,
    pub mem_available_bytes: Gauge<f64, AtomicU64>,
    pub mem_used: Gauge<f64, AtomicU64>,
    pub swap_total_bytes: Gauge<f64, AtomicU64>,
    pub swap_used_bytes: Gauge<f64, AtomicU64>,
    pub swap_used: Gauge<f64, AtomicU64>,
    pub last_success: Gauge<f64, AtomicU64>,
}

pub fn build_metrics(unit: Unit) -> (Registry, Arc<Metrics>) {
    let m = Arc::new(Metrics::default());
    let mut r = Registry::default();
    let s = unit.suffix();
    let rng = unit.range_text();

    r.register(
        format!("mac_exporter_cpu_usage_{s}"),
        format!("CPU usage {s} {rng} per logical core, plus cpu=\"total\""),
        m.cpu_usage.clone(),
    );
    r.register(
        "mac_exporter_memory_total_bytes",
        "Total physical memory in bytes",
        m.mem_total_bytes.clone(),
    );
    r.register(
        "mac_exporter_memory_used_bytes",
        "Used physical memory in bytes",
        m.mem_used_bytes.clone(),
    );
    r.register(
        "mac_exporter_memory_available_bytes",
        "Memory available for new allocations, in bytes",
        m.mem_available_bytes.clone(),
    );
    r.register(
        format!("mac_exporter_memory_used_{s}"),
        format!("Used memory {s} {rng}"),
        m.mem_used.clone(),
    );
    r.register(
        "mac_exporter_swap_total_bytes",
        "Total swap in bytes",
        m.swap_total_bytes.clone(),
    );
    r.register(
        "mac_exporter_swap_used_bytes",
        "Used swap in bytes",
        m.swap_used_bytes.clone(),
    );
    r.register(
        format!("mac_exporter_swap_used_{s}"),
        format!("Used swap {s} {rng}"),
        m.swap_used.clone(),
    );
    r.register(
        "mac_exporter_collector_last_success_timestamp_seconds",
        "Unix timestamp of the last successful background collection",
        m.last_success.clone(),
    );

    (r, m)
}

pub async fn run_collector(metrics: Arc<Metrics>, unit: Unit, sample_interval: Duration) {
    let mut sys = System::new_with_specifics(
        RefreshKind::new()
            .with_cpu(CpuRefreshKind::everything())
            .with_memory(MemoryRefreshKind::everything()),
    );

    sys.refresh_cpu_all();
    tokio::time::sleep(MINIMUM_CPU_UPDATE_INTERVAL).await;
    collect_once(&mut sys, &metrics, unit);

    let mut ticker = tokio::time::interval(sample_interval);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    ticker.tick().await;

    loop {
        ticker.tick().await;
        collect_once(&mut sys, &metrics, unit);
    }
}

fn collect_once(sys: &mut System, m: &Metrics, unit: Unit) {
    let factor = unit.from_percent_factor();

    sys.refresh_cpu_all();
    let cpus = sys.cpus();
    let mut sum_pct = 0.0_f64;
    for (i, cpu) in cpus.iter().enumerate() {
        let pct = cpu.cpu_usage() as f64;
        m.cpu_usage
            .get_or_create(&CpuLabels { cpu: i.to_string() })
            .set(pct * factor);
        sum_pct += pct;
    }
    if !cpus.is_empty() {
        m.cpu_usage
            .get_or_create(&CpuLabels { cpu: "total".to_string() })
            .set(sum_pct / cpus.len() as f64 * factor);
    }

    sys.refresh_memory();
    let total = sys.total_memory() as f64;
    let used = sys.used_memory() as f64;
    m.mem_total_bytes.set(total);
    m.mem_used_bytes.set(used);
    m.mem_available_bytes.set(sys.available_memory() as f64);
    let mem_pct = if total > 0.0 { used / total * 100.0 } else { 0.0 };
    m.mem_used.set(mem_pct * factor);

    let stotal = sys.total_swap() as f64;
    let sused = sys.used_swap() as f64;
    m.swap_total_bytes.set(stotal);
    m.swap_used_bytes.set(sused);
    let swap_pct = if stotal > 0.0 { sused / stotal * 100.0 } else { 0.0 };
    m.swap_used.set(swap_pct * factor);

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0);
    m.last_success.set(now);
}
