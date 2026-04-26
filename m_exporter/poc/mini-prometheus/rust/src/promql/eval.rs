use std::collections::BTreeMap;
use std::time::Duration;

use anyhow::{anyhow, Result};

use super::parse::{Group, MatrixSelector, Node, VectorSelector};
use crate::storage::{Labels, Sample, Storage};

#[derive(Debug, Clone)]
pub enum Value {
    Scalar { t: i64, v: f64 },
    Vector(Vec<VectorSample>),
    Matrix(Vec<MatrixEntry>),
}

#[derive(Debug, Clone)]
pub struct VectorSample {
    pub labels: Labels,
    pub t: i64,
    pub v: f64,
}

#[derive(Debug, Clone)]
pub struct MatrixEntry {
    pub labels: Labels,
    pub samples: Vec<Sample>,
}

const STALE_MS: i64 = 5 * 60 * 1000;

pub struct Engine<'a> {
    storage: &'a Storage,
}

impl<'a> Engine<'a> {
    pub fn new(storage: &'a Storage) -> Self {
        Self { storage }
    }

    pub fn instant(&self, expr: &Node, ts: i64) -> Result<Value> {
        self.eval(expr, ts)
    }

    pub fn range(&self, expr: &Node, start: i64, end: i64, step: Duration) -> Result<Vec<MatrixEntry>> {
        let step_ms = step.as_millis() as i64;
        if step_ms <= 0 {
            return Err(anyhow!("step must be positive"));
        }
        let mut bucket: BTreeMap<String, MatrixEntry> = BTreeMap::new();
        let mut t = start;
        while t <= end {
            let v = self.eval(expr, t)?;
            match v {
                Value::Scalar { v, .. } => {
                    let entry = bucket.entry(String::new()).or_insert_with(|| MatrixEntry {
                        labels: Labels::default(),
                        samples: vec![],
                    });
                    entry.samples.push(Sample { t, v });
                }
                Value::Vector(vs) => {
                    for s in vs {
                        let key = s.labels.key();
                        let entry = bucket.entry(key).or_insert_with(|| MatrixEntry {
                            labels: s.labels.clone(),
                            samples: vec![],
                        });
                        entry.samples.push(Sample { t, v: s.v });
                    }
                }
                Value::Matrix(_) => return Err(anyhow!("range eval produced unsupported type")),
            }
            t += step_ms;
        }
        Ok(bucket.into_values().collect())
    }

    fn eval(&self, n: &Node, ts: i64) -> Result<Value> {
        Ok(match n {
            Node::Number(x) => Value::Scalar { t: ts, v: *x },
            Node::StringLit(_) => Value::Scalar { t: ts, v: 0.0 },
            Node::VectorSel(vs) => Value::Vector(self.eval_vs(vs, ts)),
            Node::MatrixSel(_) => return Err(anyhow!("range vectors only allowed inside functions")),
            Node::Unary { op, expr } => {
                let v = self.eval(expr, ts)?;
                if op == "+" { v } else { negate(v) }
            }
            Node::Binary { op, lhs, rhs, bool_modifier } => {
                let l = self.eval(lhs, ts)?;
                let r = self.eval(rhs, ts)?;
                eval_binary(op, *bool_modifier, l, r, ts)?
            }
            Node::Aggregate { op, expr, group } => {
                let v = self.eval(expr, ts)?;
                let vec = match v {
                    Value::Vector(v) => v,
                    _ => return Err(anyhow!("aggregation expects an instant vector")),
                };
                Value::Vector(eval_aggregate(op, group, &vec, ts))
            }
            Node::Call { name, args } => self.eval_call(name, args, ts)?,
        })
    }

    fn eval_vs(&self, vs: &VectorSelector, ts: i64) -> Vec<VectorSample> {
        let at = ts - vs.offset.as_millis() as i64;
        let series = self.storage.select(&vs.matchers);
        let mut out = Vec::with_capacity(series.len());
        for s in &series {
            let g = s.read().unwrap();
            if let Some(samp) = g.latest_before(at) {
                if at - samp.t <= STALE_MS {
                    out.push(VectorSample {
                        labels: g.labels.without_name(),
                        t: ts,
                        v: samp.v,
                    });
                }
            }
        }
        out
    }

    fn eval_matrix(&self, ms: &MatrixSelector, ts: i64) -> Vec<MatrixEntry> {
        let at = ts - ms.vs.offset.as_millis() as i64;
        let start = at - ms.range.as_millis() as i64;
        let series = self.storage.select(&ms.vs.matchers);
        let mut out = Vec::with_capacity(series.len());
        for s in series {
            let g = s.read().unwrap();
            let samples = g.range_samples(start, at);
            if !samples.is_empty() {
                out.push(MatrixEntry {
                    labels: g.labels.without_name(),
                    samples,
                });
            }
        }
        out
    }

    fn eval_call(&self, name: &str, args: &[Node], ts: i64) -> Result<Value> {
        match name {
            "time" => return Ok(Value::Scalar { t: ts, v: ts as f64 / 1000.0 }),
            "vector" => {
                if args.len() != 1 {
                    return Err(anyhow!("vector() expects 1 arg"));
                }
                let v = self.eval(&args[0], ts)?;
                let s = match v {
                    Value::Scalar { v, .. } => v,
                    _ => return Err(anyhow!("vector() expects a scalar")),
                };
                return Ok(Value::Vector(vec![VectorSample {
                    labels: Labels::default(),
                    t: ts,
                    v: s,
                }]));
            }
            "scalar" => {
                if args.len() != 1 {
                    return Err(anyhow!("scalar() expects 1 arg"));
                }
                let v = self.eval(&args[0], ts)?;
                let vec = match v {
                    Value::Vector(v) => v,
                    _ => return Err(anyhow!("scalar() expects an instant vector")),
                };
                if vec.len() != 1 {
                    return Ok(Value::Scalar { t: ts, v: f64::NAN });
                }
                return Ok(Value::Scalar { t: ts, v: vec[0].v });
            }
            "abs" => {
                let v = self.eval_to_vector(&args[0], ts)?;
                let mut out = Vec::with_capacity(v.len());
                for mut s in v {
                    s.v = s.v.abs();
                    out.push(s);
                }
                return Ok(Value::Vector(out));
            }
            "clamp_min" | "clamp_max" => {
                if args.len() != 2 {
                    return Err(anyhow!("{name} expects 2 args"));
                }
                let v = self.eval_to_vector(&args[0], ts)?;
                let s = self.eval(&args[1], ts)?;
                let limit = match s {
                    Value::Scalar { v, .. } => v,
                    _ => return Err(anyhow!("{name} 2nd arg must be scalar")),
                };
                let mut out = Vec::with_capacity(v.len());
                for mut x in v {
                    if name == "clamp_min" && x.v < limit {
                        x.v = limit;
                    }
                    if name == "clamp_max" && x.v > limit {
                        x.v = limit;
                    }
                    out.push(x);
                }
                return Ok(Value::Vector(out));
            }
            _ => {}
        }
        if args.len() != 1 {
            return Err(anyhow!("{name} expects 1 arg"));
        }
        let ms = match &args[0] {
            Node::MatrixSel(ms) => ms,
            _ => return Err(anyhow!("{name} expects a range vector")),
        };
        let mat = self.eval_matrix(ms, ts);
        let mut out = Vec::with_capacity(mat.len());
        for m in mat {
            if let Some(v) = apply_range_func(name, &m.samples, ms.range) {
                out.push(VectorSample {
                    labels: m.labels,
                    t: ts,
                    v,
                });
            }
        }
        Ok(Value::Vector(out))
    }

    fn eval_to_vector(&self, n: &Node, ts: i64) -> Result<Vec<VectorSample>> {
        match self.eval(n, ts)? {
            Value::Vector(v) => Ok(v),
            Value::Scalar { v, .. } => Ok(vec![VectorSample {
                labels: Labels::default(),
                t: ts,
                v,
            }]),
            _ => Err(anyhow!("expected vector")),
        }
    }
}

fn negate(v: Value) -> Value {
    match v {
        Value::Scalar { t, v } => Value::Scalar { t, v: -v },
        Value::Vector(mut x) => {
            for s in &mut x {
                s.v = -s.v;
            }
            Value::Vector(x)
        }
        Value::Matrix(_) => v,
    }
}

fn eval_binary(op: &str, is_bool: bool, lhs: Value, rhs: Value, ts: i64) -> Result<Value> {
    match (lhs, rhs) {
        (Value::Scalar { v: l, .. }, Value::Scalar { v: r, .. }) => {
            if let Some(v) = apply_op(op, l, r, is_bool) {
                Ok(Value::Scalar { t: ts, v })
            } else {
                Ok(Value::Vector(vec![]))
            }
        }
        (Value::Scalar { v: l, .. }, Value::Vector(rv)) => {
            Ok(Value::Vector(scalar_vector(op, l, rv, is_bool, false)))
        }
        (Value::Vector(lv), Value::Scalar { v: r, .. }) => {
            Ok(Value::Vector(scalar_vector(op, r, lv, is_bool, true)))
        }
        (Value::Vector(lv), Value::Vector(rv)) => Ok(Value::Vector(vector_vector(op, lv, rv, is_bool))),
        _ => Err(anyhow!("unsupported operand types for {op}")),
    }
}

fn apply_op(op: &str, l: f64, r: f64, is_bool: bool) -> Option<f64> {
    match op {
        "+" => Some(l + r),
        "-" => Some(l - r),
        "*" => Some(l * r),
        "/" => Some(if r == 0.0 { f64::INFINITY } else { l / r }),
        "%" => Some(if r == 0.0 { f64::NAN } else { l % r }),
        "==" | "!=" | "<" | ">" | "<=" | ">=" => {
            let c = match op {
                "==" => l == r,
                "!=" => l != r,
                "<" => l < r,
                ">" => l > r,
                "<=" => l <= r,
                ">=" => l >= r,
                _ => false,
            };
            if is_bool {
                Some(if c { 1.0 } else { 0.0 })
            } else if c {
                Some(l)
            } else {
                None
            }
        }
        _ => None,
    }
}

fn scalar_vector(op: &str, scalar: f64, v: Vec<VectorSample>, is_bool: bool, scalar_on_right: bool) -> Vec<VectorSample> {
    let mut out = Vec::with_capacity(v.len());
    for s in v {
        let (l, r) = if scalar_on_right { (s.v, scalar) } else { (scalar, s.v) };
        if let Some(val) = apply_op(op, l, r, is_bool) {
            out.push(VectorSample { labels: s.labels, t: s.t, v: val });
        }
    }
    out
}

fn vector_vector(op: &str, lhs: Vec<VectorSample>, rhs: Vec<VectorSample>, is_bool: bool) -> Vec<VectorSample> {
    let mut idx = std::collections::HashMap::new();
    for s in rhs {
        idx.insert(s.labels.key(), s);
    }
    let mut out = Vec::with_capacity(lhs.len());
    for l in lhs {
        let key = l.labels.key();
        if let Some(r) = idx.get(&key) {
            if let Some(val) = apply_op(op, l.v, r.v, is_bool) {
                out.push(VectorSample { labels: l.labels, t: l.t, v: val });
            }
        }
    }
    out
}

fn eval_aggregate(op: &str, group: &Group, vec: &[VectorSample], ts: i64) -> Vec<VectorSample> {
    let key_fn = |lbls: &Labels| -> Labels {
        match group {
            Group::By(want) => {
                let pairs: Vec<(String, String)> = lbls
                    .0
                    .iter()
                    .filter(|l| want.iter().any(|w| w == &l.name))
                    .map(|l| (l.name.clone(), l.value.clone()))
                    .collect();
                Labels::from_pairs(pairs)
            }
            Group::Without(drop) => {
                let mut drops: std::collections::HashSet<String> =
                    drop.iter().cloned().collect();
                drops.insert("__name__".into());
                let pairs: Vec<(String, String)> = lbls
                    .0
                    .iter()
                    .filter(|l| !drops.contains(&l.name))
                    .map(|l| (l.name.clone(), l.value.clone()))
                    .collect();
                Labels::from_pairs(pairs)
            }
            Group::None => Labels::default(),
        }
    };
    struct G {
        labels: Labels,
        sum: f64,
        count: f64,
        min: f64,
        max: f64,
    }
    let mut groups: BTreeMap<String, G> = BTreeMap::new();
    for s in vec {
        let labels = key_fn(&s.labels);
        let key = labels.key();
        let g = groups.entry(key).or_insert_with(|| G {
            labels,
            sum: 0.0,
            count: 0.0,
            min: f64::INFINITY,
            max: f64::NEG_INFINITY,
        });
        g.sum += s.v;
        g.count += 1.0;
        if s.v < g.min { g.min = s.v; }
        if s.v > g.max { g.max = s.v; }
    }
    groups
        .into_values()
        .map(|g| {
            let v = match op {
                "sum" => g.sum,
                "count" => g.count,
                "avg" => if g.count == 0.0 { f64::NAN } else { g.sum / g.count },
                "min" => g.min,
                "max" => g.max,
                _ => f64::NAN,
            };
            VectorSample { labels: g.labels, t: ts, v }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::super::parse;
    use super::*;
    use crate::storage::Storage;

    fn mk() -> Storage {
        let st = Storage::new(64);
        for (i, ts) in [1000_i64, 2000, 3000, 4000].iter().enumerate() {
            st.append("cpu", &[("cpu".into(), "0".into())], *ts, (10 + i) as f64);
            st.append("cpu", &[("cpu".into(), "1".into())], *ts, (20 + i * 2) as f64);
        }
        st.append("c", &[], 1000, 0.0);
        st.append("c", &[], 2000, 5.0);
        st.append("c", &[], 3000, 1.0);
        st.append("c", &[], 4000, 3.0);
        st
    }

    fn eval(st: &Storage, src: &str, ts: i64) -> Value {
        let n = parse(src).unwrap();
        Engine::new(st).instant(&n, ts).unwrap()
    }

    #[test]
    fn vector_sel() {
        let st = mk();
        let v = eval(&st, "cpu", 4000);
        match v {
            Value::Vector(vs) => assert_eq!(vs.len(), 2),
            _ => panic!(),
        }
    }

    #[test]
    fn agg_sum() {
        let st = mk();
        let v = eval(&st, "sum(cpu)", 4000);
        match v {
            Value::Vector(vs) => {
                assert_eq!(vs.len(), 1);
                assert!((vs[0].v - (13.0 + 26.0)).abs() < 1e-9);
            }
            _ => panic!(),
        }
    }

    #[test]
    fn agg_by() {
        let st = mk();
        let v = eval(&st, "sum by(cpu)(cpu)", 4000);
        match v {
            Value::Vector(vs) => assert_eq!(vs.len(), 2),
            _ => panic!(),
        }
    }

    #[test]
    fn arithmetic() {
        let st = mk();
        let v = eval(&st, "cpu * 2", 4000);
        match v {
            Value::Vector(vs) => assert_eq!(vs.len(), 2),
            _ => panic!(),
        }
    }

    #[test]
    fn rate_with_reset() {
        let st = mk();
        let v = eval(&st, "rate(c[5s])", 4000);
        match v {
            Value::Vector(vs) => {
                assert_eq!(vs.len(), 1);
                let want = 8.0 / 5.0; // counter 0,5,1,3 with reset
                assert!((vs[0].v - want).abs() < 1e-9, "got {}", vs[0].v);
            }
            _ => panic!(),
        }
    }

    #[test]
    fn comparison_filtering() {
        let st = mk();
        let v = eval(&st, "cpu > 20", 4000);
        match v {
            Value::Vector(vs) => {
                assert_eq!(vs.len(), 1);
                assert_eq!(vs[0].labels.get("cpu"), Some("1"));
            }
            _ => panic!(),
        }
    }

    #[test]
    fn comparison_bool_keeps_all() {
        let st = mk();
        let v = eval(&st, "cpu > bool 20", 4000);
        match v {
            Value::Vector(vs) => assert_eq!(vs.len(), 2),
            _ => panic!(),
        }
    }

    #[test]
    fn unsupported_topk() {
        assert!(parse("topk(3, cpu)").is_err());
    }

    #[test]
    fn unsupported_set_op() {
        assert!(parse("cpu and other").is_err());
    }
}

fn apply_range_func(name: &str, samples: &[Sample], rng: Duration) -> Option<f64> {
    match name {
        "rate" | "irate" | "increase" | "delta" => {
            if samples.len() < 2 {
                return None;
            }
            let first = samples[0];
            let last = *samples.last().unwrap();
            let mut delta = last.v - first.v;
            for w in samples.windows(2) {
                if w[1].v < w[0].v {
                    delta += w[0].v;
                }
            }
            Some(match name {
                "rate" => delta / rng.as_secs_f64(),
                "increase" => delta,
                "delta" => last.v - first.v,
                "irate" => {
                    let a = samples[samples.len() - 2];
                    let b = *samples.last().unwrap();
                    let dv = if b.v < a.v { b.v } else { b.v - a.v };
                    let dt = (b.t - a.t) as f64 / 1000.0;
                    if dt == 0.0 {
                        return None;
                    }
                    dv / dt
                }
                _ => unreachable!(),
            })
        }
        "avg_over_time" => {
            let s: f64 = samples.iter().map(|x| x.v).sum();
            Some(s / samples.len() as f64)
        }
        "sum_over_time" => Some(samples.iter().map(|x| x.v).sum()),
        "max_over_time" => Some(samples.iter().map(|x| x.v).fold(f64::NEG_INFINITY, f64::max)),
        "min_over_time" => Some(samples.iter().map(|x| x.v).fold(f64::INFINITY, f64::min)),
        "count_over_time" => Some(samples.len() as f64),
        _ => None,
    }
}
