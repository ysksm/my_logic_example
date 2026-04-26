use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, RwLock};

use regex::Regex;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_buffer_overwrites_oldest() {
        let st = Storage::new(3);
        for i in 1..=5i64 {
            st.append("m", &[], i * 1000, i as f64);
        }
        let m = Matcher::new(MatchType::Eq, "__name__".into(), "m".into()).unwrap();
        let series = st.select(&[m]);
        assert_eq!(series.len(), 1);
        let g = series[0].read().unwrap();
        let rng = g.range_samples(0, 10000);
        assert_eq!(rng.len(), 3);
        assert_eq!(rng[0].v, 3.0);
        assert_eq!(rng[2].v, 5.0);
    }

    #[test]
    fn regex_matcher_filters() {
        let st = Storage::new(4);
        st.append("cpu", &[("cpu".into(), "0".into())], 1, 1.0);
        st.append("cpu", &[("cpu".into(), "1".into())], 1, 2.0);
        st.append("cpu", &[("cpu".into(), "total".into())], 1, 3.0);
        let m1 = Matcher::new(MatchType::Eq, "__name__".into(), "cpu".into()).unwrap();
        let m2 = Matcher::new(MatchType::Re, "cpu".into(), "[0-9]+".into()).unwrap();
        let got = st.select(&[m1, m2]);
        assert_eq!(got.len(), 2);
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Sample {
    pub t: i64, // ms
    pub v: f64,
}

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd, Hash)]
pub struct Label {
    pub name: String,
    pub value: String,
}

#[derive(Clone, Debug, Default)]
pub struct Labels(pub Vec<Label>);

impl Labels {
    pub fn from_pairs(mut pairs: Vec<(String, String)>) -> Self {
        pairs.sort_by(|a, b| a.0.cmp(&b.0));
        Self(pairs.into_iter().map(|(name, value)| Label { name, value }).collect())
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.0.iter().find(|l| l.name == name).map(|l| l.value.as_str())
    }

    pub fn key(&self) -> String {
        let mut s = String::new();
        for l in &self.0 {
            s.push_str(&l.name);
            s.push('=');
            s.push_str(&l.value);
            s.push('\0');
        }
        s
    }

    pub fn to_map(&self) -> BTreeMap<String, String> {
        self.0.iter().map(|l| (l.name.clone(), l.value.clone())).collect()
    }

    pub fn without_name(&self) -> Labels {
        Labels(self.0.iter().filter(|l| l.name != "__name__").cloned().collect())
    }
}

pub struct Series {
    pub id: u64,
    pub labels: Labels,
    capacity: usize,
    samples: Vec<Sample>, // ring buffer
    head: usize,
    size: usize,
}

impl Series {
    fn new(id: u64, labels: Labels, capacity: usize) -> Self {
        Self {
            id,
            labels,
            capacity,
            samples: vec![Sample { t: 0, v: 0.0 }; capacity],
            head: 0,
            size: 0,
        }
    }

    pub fn append(&mut self, t: i64, v: f64) {
        if self.size > 0 {
            let last = (self.head + self.capacity - 1) % self.capacity;
            if t <= self.samples[last].t {
                return;
            }
        }
        self.samples[self.head] = Sample { t, v };
        self.head = (self.head + 1) % self.capacity;
        if self.size < self.capacity {
            self.size += 1;
        }
    }

    /// Samples with t in (start, end] (exclusive start, inclusive end).
    pub fn range_samples(&self, start: i64, end: i64) -> Vec<Sample> {
        let mut out = Vec::with_capacity(self.size);
        for i in 0..self.size {
            let idx = (self.head + self.capacity - self.size + i) % self.capacity;
            let s = self.samples[idx];
            if s.t > start && s.t <= end {
                out.push(s);
            }
        }
        out
    }

    /// Most recent sample with t <= ts.
    pub fn latest_before(&self, ts: i64) -> Option<Sample> {
        for i in (0..self.size).rev() {
            let idx = (self.head + self.capacity - self.size + i) % self.capacity;
            if self.samples[idx].t <= ts {
                return Some(self.samples[idx]);
            }
        }
        None
    }
}

#[derive(Clone, Copy, Debug)]
pub enum MatchType {
    Eq,
    NotEq,
    Re,
    NotRe,
}

#[derive(Clone, Debug)]
pub struct Matcher {
    pub name: String,
    pub mt: MatchType,
    pub value: String,
    pub re: Option<Regex>,
}

impl Matcher {
    pub fn new(mt: MatchType, name: String, value: String) -> anyhow::Result<Self> {
        let re = match mt {
            MatchType::Re | MatchType::NotRe => Some(Regex::new(&format!("^(?:{})$", value))?),
            _ => None,
        };
        Ok(Self { name, mt, value, re })
    }
    pub fn matches(&self, v: &str) -> bool {
        match self.mt {
            MatchType::Eq => v == self.value,
            MatchType::NotEq => v != self.value,
            MatchType::Re => self.re.as_ref().map(|r| r.is_match(v)).unwrap_or(false),
            MatchType::NotRe => !self.re.as_ref().map(|r| r.is_match(v)).unwrap_or(false),
        }
    }
}

pub struct Storage {
    capacity: usize,
    inner: RwLock<Inner>,
}

struct Inner {
    series: HashMap<String, Arc<RwLock<Series>>>,
    name_values: HashMap<String, std::collections::BTreeSet<String>>,
    next_id: u64,
}

impl Storage {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            inner: RwLock::new(Inner {
                series: HashMap::new(),
                name_values: HashMap::new(),
                next_id: 0,
            }),
        }
    }

    pub fn append(&self, metric: &str, extra: &[(String, String)], t: i64, v: f64) {
        let mut pairs = Vec::with_capacity(extra.len() + 1);
        pairs.push(("__name__".to_string(), metric.to_string()));
        for (k, val) in extra {
            pairs.push((k.clone(), val.clone()));
        }
        let lbls = Labels::from_pairs(pairs);
        let key = lbls.key();
        let series = {
            let mut g = self.inner.write().unwrap();
            if let Some(s) = g.series.get(&key) {
                s.clone()
            } else {
                g.next_id += 1;
                let id = g.next_id;
                let s = Arc::new(RwLock::new(Series::new(id, lbls.clone(), self.capacity)));
                g.series.insert(key.clone(), s.clone());
                for l in &lbls.0 {
                    g.name_values
                        .entry(l.name.clone())
                        .or_default()
                        .insert(l.value.clone());
                }
                s
            }
        };
        series.write().unwrap().append(t, v);
    }

    pub fn select(&self, matchers: &[Matcher]) -> Vec<Arc<RwLock<Series>>> {
        let g = self.inner.read().unwrap();
        let mut out = Vec::new();
        for s in g.series.values() {
            let series = s.read().unwrap();
            let mut ok = true;
            for m in matchers {
                let v = series.labels.get(&m.name).unwrap_or("");
                if !m.matches(v) {
                    ok = false;
                    break;
                }
            }
            if ok {
                drop(series);
                out.push(s.clone());
            }
        }
        out
    }

    pub fn label_names(&self) -> Vec<String> {
        let g = self.inner.read().unwrap();
        let mut out: Vec<_> = g.name_values.keys().cloned().collect();
        out.sort();
        out
    }

    pub fn label_values(&self, name: &str) -> Vec<String> {
        let g = self.inner.read().unwrap();
        g.name_values
            .get(name)
            .map(|set| set.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Iterate over every series, mapping it to T via the closure.
    /// The closure receives the labels and a flat (oldest-to-newest) sample slice.
    pub fn iter_series_for_snapshot<F, T>(&self, f: F) -> Vec<T>
    where
        F: Fn(&Labels, &[Sample]) -> T,
    {
        let g = self.inner.read().unwrap();
        let mut out = Vec::with_capacity(g.series.len());
        for s in g.series.values() {
            let s = s.read().unwrap();
            let mut samples = Vec::with_capacity(s.size);
            for i in 0..s.size {
                let idx = (s.head + s.capacity - s.size + i) % s.capacity;
                samples.push(s.samples[idx]);
            }
            out.push(f(&s.labels, &samples));
        }
        out
    }
}
