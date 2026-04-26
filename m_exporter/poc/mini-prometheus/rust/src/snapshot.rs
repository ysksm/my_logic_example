use std::path::Path;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::storage::Storage;

const SNAPSHOT_VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
struct SnapshotFile {
    version: u32,
    saved_at_ms: i64,
    series: Vec<SnapshotSeries>,
}

#[derive(Serialize, Deserialize)]
struct SnapshotSeries {
    labels: Vec<SnapshotLabel>,
    samples: Vec<(i64, f64)>,
}

#[derive(Serialize, Deserialize)]
struct SnapshotLabel {
    name: String,
    value: String,
}

pub fn write(path: &Path, storage: &Storage) -> Result<()> {
    let snap = SnapshotFile {
        version: SNAPSHOT_VERSION,
        saved_at_ms: chrono::Utc::now().timestamp_millis(),
        series: storage.iter_series_for_snapshot(|labels, samples| SnapshotSeries {
            labels: labels
                .0
                .iter()
                .map(|l| SnapshotLabel {
                    name: l.name.clone(),
                    value: l.value.clone(),
                })
                .collect(),
            samples: samples.iter().map(|s| (s.t, s.v)).collect(),
        }),
    };
    let data = serde_json::to_vec(&snap).context("encode snapshot")?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &data).with_context(|| format!("write {}", tmp.display()))?;
    std::fs::rename(&tmp, path)
        .with_context(|| format!("rename {} -> {}", tmp.display(), path.display()))?;
    Ok(())
}

pub fn read(path: &Path, storage: &Storage) -> Result<usize> {
    let data = std::fs::read(path).with_context(|| format!("read {}", path.display()))?;
    let snap: SnapshotFile = serde_json::from_slice(&data).context("decode snapshot")?;
    if snap.version != SNAPSHOT_VERSION {
        anyhow::bail!("unsupported snapshot version: {}", snap.version);
    }
    let n = snap.series.len();
    for ss in snap.series {
        let mut metric = String::new();
        let mut extra: Vec<(String, String)> = Vec::new();
        for l in ss.labels {
            if l.name == "__name__" {
                metric = l.value;
            } else {
                extra.push((l.name, l.value));
            }
        }
        if metric.is_empty() {
            continue;
        }
        for (t, v) in ss.samples {
            storage.append(&metric, &extra, t, v);
        }
    }
    Ok(n)
}
