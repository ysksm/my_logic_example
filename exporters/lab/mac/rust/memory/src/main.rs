use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use sysinfo::{MemoryRefreshKind, RefreshKind, System};

const SAMPLE_INTERVAL: Duration = Duration::from_secs(1);

fn main() {
    let running = Arc::new(AtomicBool::new(true));
    {
        let r = running.clone();
        ctrlc::set_handler(move || r.store(false, Ordering::SeqCst))
            .expect("install ctrl-c handler");
    }

    let mut sys = System::new_with_specifics(
        RefreshKind::new().with_memory(MemoryRefreshKind::everything()),
    );
    sys.refresh_memory();

    println!("Total memory: {}", human_bytes(sys.total_memory()));
    println!("Sampling every {:?}. Press Ctrl-C to stop.", SAMPLE_INTERVAL);

    while running.load(Ordering::SeqCst) {
        sys.refresh_memory();

        let total = sys.total_memory();
        let used = sys.used_memory();
        let avail = sys.available_memory();
        let free = sys.free_memory();
        let used_pct = if total > 0 {
            used as f64 / total as f64 * 100.0
        } else {
            0.0
        };

        let stotal = sys.total_swap();
        let sused = sys.used_swap();
        let sfree = sys.free_swap();
        let sused_pct = if stotal > 0 {
            sused as f64 / stotal as f64 * 100.0
        } else {
            0.0
        };

        let now = chrono::Local::now();
        println!(
            "[{}] used={}/{} ({:5.1}%)  available={}  free={}  swap={}/{} ({:5.1}%)  swap_free={}",
            now.format("%H:%M:%S"),
            human_bytes(used),
            human_bytes(total),
            used_pct,
            human_bytes(avail),
            human_bytes(free),
            human_bytes(sused),
            human_bytes(stotal),
            sused_pct,
            human_bytes(sfree),
        );

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
