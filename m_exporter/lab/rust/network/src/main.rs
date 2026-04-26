use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use sysinfo::Networks;

const SAMPLE_INTERVAL: Duration = Duration::from_secs(2);

fn main() {
    let running = Arc::new(AtomicBool::new(true));
    {
        let r = running.clone();
        ctrlc::set_handler(move || r.store(false, Ordering::SeqCst))
            .expect("install ctrl-c handler");
    }

    let mut nets = Networks::new_with_refreshed_list();

    println!("== Network interfaces ==");
    let mut names: Vec<&String> = nets.keys().collect();
    names.sort();
    for name in &names {
        let data = &nets[name.as_str()];
        let addrs: Vec<String> = data
            .ip_networks()
            .iter()
            .map(|n| format!("{}/{}", n.addr, n.prefix))
            .collect();
        println!(
            "  {:<10}  mac={}  addrs=[{}]",
            name,
            data.mac_address(),
            addrs.join(", "),
        );
    }

    println!(
        "\n== Per-interface I/O delta every {:?}. Press Ctrl-C to stop. ==",
        SAMPLE_INTERVAL
    );

    let mut last = Instant::now();
    while running.load(Ordering::SeqCst) {
        thread::sleep(SAMPLE_INTERVAL);
        nets.refresh();

        let now = Instant::now();
        let dt = now.duration_since(last).as_secs_f64();
        last = now;

        let ts = chrono::Local::now();
        println!("[{}]", ts.format("%H:%M:%S"));

        let mut names: Vec<&String> = nets.keys().collect();
        names.sort();
        for name in names {
            let data = &nets[name.as_str()];
            let rx = data.received() as f64 / dt;
            let tx = data.transmitted() as f64 / dt;
            if rx == 0.0 && tx == 0.0 {
                continue;
            }
            println!(
                "  {:<10}  rx={}  tx={}  rx_pkts={}  tx_pkts={}  errs(in/out)={}/{}",
                name,
                human_bits(rx),
                human_bits(tx),
                data.packets_received(),
                data.packets_transmitted(),
                data.errors_on_received(),
                data.errors_on_transmitted(),
            );
        }
    }
    println!("\nstopped.");
}

fn human_bits(bytes_per_sec: f64) -> String {
    let bps = bytes_per_sec * 8.0;
    if bps >= 1e9 {
        format!("{:.2} Gbps", bps / 1e9)
    } else if bps >= 1e6 {
        format!("{:.2} Mbps", bps / 1e6)
    } else if bps >= 1e3 {
        format!("{:.2} Kbps", bps / 1e3)
    } else {
        format!("{:.0} bps", bps)
    }
}
