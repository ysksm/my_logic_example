use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use sysinfo::Disks;

const SAMPLE_INTERVAL: Duration = Duration::from_secs(2);

fn main() {
    let running = Arc::new(AtomicBool::new(true));
    {
        let r = running.clone();
        ctrlc::set_handler(move || r.store(false, Ordering::SeqCst))
            .expect("install ctrl-c handler");
    }

    let mut disks = Disks::new_with_refreshed_list();

    println!("== Mounted disks ==");
    for d in &disks {
        let total = d.total_space();
        let avail = d.available_space();
        let used = total.saturating_sub(avail);
        let pct = if total > 0 {
            used as f64 / total as f64 * 100.0
        } else {
            0.0
        };
        println!(
            "  {:<22}  fs={:<8}  used={}/{} ({:5.1}%)  kind={:?}",
            d.mount_point().display(),
            d.file_system().to_string_lossy(),
            human_bytes(used),
            human_bytes(total),
            pct,
            d.kind(),
        );
    }

    println!(
        "\n== Refreshing disk usage every {:?}. Press Ctrl-C to stop. ==",
        SAMPLE_INTERVAL
    );
    println!("(Note: sysinfo does not expose per-disk read/write IO counters; usage only.)");

    while running.load(Ordering::SeqCst) {
        disks.refresh();

        let now = chrono::Local::now();
        println!("[{}]", now.format("%H:%M:%S"));
        for d in &disks {
            let total = d.total_space();
            let avail = d.available_space();
            let used = total.saturating_sub(avail);
            let pct = if total > 0 {
                used as f64 / total as f64 * 100.0
            } else {
                0.0
            };
            println!(
                "  {:<22}  used={}/{} ({:5.1}%)  free={}",
                d.mount_point().display(),
                human_bytes(used),
                human_bytes(total),
                pct,
                human_bytes(avail),
            );
        }

        thread::sleep(SAMPLE_INTERVAL);
    }
    println!("\nstopped.");
}

fn human_bytes(b: u64) -> String {
    const UNIT: u64 = 1024;
    if b < UNIT {
        return format!("{}B", b);
    }
    let units = ['K', 'M', 'G', 'T', 'P', 'E'];
    let mut div = UNIT;
    let mut exp = 0usize;
    let mut n = b / UNIT;
    while n >= UNIT {
        div *= UNIT;
        n /= UNIT;
        exp += 1;
    }
    format!("{:.1}{}iB", b as f64 / div as f64, units[exp])
}
