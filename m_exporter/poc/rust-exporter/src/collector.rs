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

#[derive(Clone, Hash, PartialEq, Eq, Debug, EncodeLabelSet)]
pub struct CpuLabels {
    pub cpu: String,
}

#[derive(Default, Clone)]
pub struct Metrics {
    pub cpu_usage_ratio: Family<CpuLabels, Gauge<f64, AtomicU64>>,
    pub mem_total_bytes: Gauge<f64, AtomicU64>,
    pub mem_used_bytes: Gauge<f64, AtomicU64>,
    pub mem_available_bytes: Gauge<f64, AtomicU64>,
    pub mem_used_ratio: Gauge<f64, AtomicU64>,
    pub swap_total_bytes: Gauge<f64, AtomicU64>,
    pub swap_used_bytes: Gauge<f64, AtomicU64>,
    pub swap_used_ratio: Gauge<f64, AtomicU64>,
    pub last_success: Gauge<f64, AtomicU64>,
}

pub fn build_metrics() -> (Registry, Arc<Metrics>) {
    let m = Arc::new(Metrics::default());
    let mut r = Registry::default();

    r.register(
        "m_exporter_cpu_usage_ratio",
        "CPU usage ratio (0-1) per logical core, plus cpu=\"total\"",
        m.cpu_usage_ratio.clone(),
    );
    r.register(
        "m_exporter_memory_total_bytes",
        "Total physical memory in bytes",
        m.mem_total_bytes.clone(),
    );
    r.register(
        "m_exporter_memory_used_bytes",
        "Used physical memory in bytes",
        m.mem_used_bytes.clone(),
    );
    r.register(
        "m_exporter_memory_available_bytes",
        "Memory available for new allocations, in bytes",
        m.mem_available_bytes.clone(),
    );
    r.register(
        "m_exporter_memory_used_ratio",
        "Used memory ratio (0-1)",
        m.mem_used_ratio.clone(),
    );
    r.register(
        "m_exporter_swap_total_bytes",
        "Total swap in bytes",
        m.swap_total_bytes.clone(),
    );
    r.register(
        "m_exporter_swap_used_bytes",
        "Used swap in bytes",
        m.swap_used_bytes.clone(),
    );
    r.register(
        "m_exporter_swap_used_ratio",
        "Used swap ratio (0-1)",
        m.swap_used_ratio.clone(),
    );
    r.register(
        "m_exporter_collector_last_success_timestamp_seconds",
        "Unix timestamp of the last successful background collection",
        m.last_success.clone(),
    );

    (r, m)
}

pub async fn run_collector(metrics: Arc<Metrics>, sample_interval: Duration) {
    let mut sys = System::new_with_specifics(
        RefreshKind::new()
            .with_cpu(CpuRefreshKind::everything())
            .with_memory(MemoryRefreshKind::everything()),
    );

    sys.refresh_cpu_all();
    tokio::time::sleep(MINIMUM_CPU_UPDATE_INTERVAL).await;
    collect_once(&mut sys, &metrics);

    let mut ticker = tokio::time::interval(sample_interval);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    ticker.tick().await;

    loop {
        ticker.tick().await;
        collect_once(&mut sys, &metrics);
    }
}

fn collect_once(sys: &mut System, m: &Metrics) {
    sys.refresh_cpu_all();
    let cpus = sys.cpus();
    let mut sum = 0.0_f64;
    for (i, cpu) in cpus.iter().enumerate() {
        let v = cpu.cpu_usage() as f64 / 100.0;
        m.cpu_usage_ratio
            .get_or_create(&CpuLabels { cpu: i.to_string() })
            .set(v);
        sum += v;
    }
    if !cpus.is_empty() {
        m.cpu_usage_ratio
            .get_or_create(&CpuLabels {
                cpu: "total".to_string(),
            })
            .set(sum / cpus.len() as f64);
    }

    sys.refresh_memory();
    let total = sys.total_memory() as f64;
    let used = sys.used_memory() as f64;
    m.mem_total_bytes.set(total);
    m.mem_used_bytes.set(used);
    m.mem_available_bytes.set(sys.available_memory() as f64);
    m.mem_used_ratio
        .set(if total > 0.0 { used / total } else { 0.0 });

    let stotal = sys.total_swap() as f64;
    let sused = sys.used_swap() as f64;
    m.swap_total_bytes.set(stotal);
    m.swap_used_bytes.set(sused);
    m.swap_used_ratio
        .set(if stotal > 0.0 { sused / stotal } else { 0.0 });

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0);
    m.last_success.set(now);
}
