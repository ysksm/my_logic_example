use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use sysinfo::{CpuRefreshKind, RefreshKind, System, MINIMUM_CPU_UPDATE_INTERVAL};

const SAMPLE_INTERVAL: Duration = Duration::from_secs(1);

fn main() {
    let running = Arc::new(AtomicBool::new(true));
    {
        let r = running.clone();
        ctrlc::set_handler(move || r.store(false, Ordering::SeqCst))
            .expect("install ctrl-c handler");
    }

    let mut sys = System::new_with_specifics(
        RefreshKind::new().with_cpu(CpuRefreshKind::everything()),
    );

    sys.refresh_cpu_all();
    thread::sleep(MINIMUM_CPU_UPDATE_INTERVAL);

    println!("CPU cores (logical): {}", sys.cpus().len());
    println!("Sampling every {:?}. Press Ctrl-C to stop.", SAMPLE_INTERVAL);

    while running.load(Ordering::SeqCst) {
        sys.refresh_cpu_all();

        let now = chrono::Local::now();
        let total = sys.global_cpu_usage();
        print!("[{}] total={:5.1}%", now.format("%H:%M:%S"), total);
        for (i, cpu) in sys.cpus().iter().enumerate() {
            print!("  cpu{}={:5.1}%", i, cpu.cpu_usage());
        }
        println!();

        thread::sleep(SAMPLE_INTERVAL);
    }
    println!("\nstopped.");
}
