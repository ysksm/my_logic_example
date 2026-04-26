use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use sysinfo::System;

const SAMPLE_INTERVAL: Duration = Duration::from_secs(2);

fn main() {
    let running = Arc::new(AtomicBool::new(true));
    {
        let r = running.clone();
        ctrlc::set_handler(move || r.store(false, Ordering::SeqCst))
            .expect("install ctrl-c handler");
    }

    let host = System::host_name().unwrap_or_else(|| "<unknown>".to_string());
    let name = System::name().unwrap_or_else(|| "<unknown>".to_string());
    let os_ver = System::os_version().unwrap_or_else(|| "<unknown>".to_string());
    let kernel = System::kernel_version().unwrap_or_else(|| "<unknown>".to_string());
    let uptime_secs = System::uptime();
    let boot = System::boot_time();

    println!("== Host info ==");
    println!(
        "  hostname={}  os={}  os_version={}  kernel={}",
        host, name, os_ver, kernel
    );
    println!(
        "  uptime={}  boot_time={}",
        format_duration(uptime_secs),
        chrono::DateTime::from_timestamp(boot as i64, 0)
            .map(|t| t.with_timezone(&chrono::Local).to_rfc3339())
            .unwrap_or_else(|| "<unknown>".to_string()),
    );

    let mut sys = System::new();
    println!(
        "\n== Load average + process count every {:?}. Press Ctrl-C to stop. ==",
        SAMPLE_INTERVAL
    );

    while running.load(Ordering::SeqCst) {
        let avg = System::load_average();
        sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

        let now = chrono::Local::now();
        println!(
            "[{}] load1={:5.2}  load5={:5.2}  load15={:5.2}  procs_total={}",
            now.format("%H:%M:%S"),
            avg.one,
            avg.five,
            avg.fifteen,
            sys.processes().len(),
        );

        thread::sleep(SAMPLE_INTERVAL);
    }
    println!("\nstopped.");
}

fn format_duration(secs: u64) -> String {
    let d = secs / 86400;
    let h = (secs % 86400) / 3600;
    let m = (secs % 3600) / 60;
    let s = secs % 60;
    if d > 0 {
        format!("{}d{}h{}m{}s", d, h, m, s)
    } else {
        format!("{}h{}m{}s", h, m, s)
    }
}
