//! Prometheus text exposition format parser.

use anyhow::{anyhow, Result};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic_format() {
        let body = "# HELP cpu_usage cpu\n# TYPE cpu_usage gauge\ncpu_usage{cpu=\"0\"} 0.13\ncpu_usage{cpu=\"1\"} 0.27 1700000000000\nmem_used_bytes 1.234e9\n";
        let got = parse_text(body);
        assert_eq!(got.len(), 3);
        assert_eq!(got[0].metric, "cpu_usage");
        assert_eq!(got[0].labels, vec![("cpu".into(), "0".into())]);
        assert!((got[0].value - 0.13).abs() < 1e-9);
        assert_eq!(got[1].ts, 1700000000000);
        assert_eq!(got[2].metric, "mem_used_bytes");
        assert!((got[2].value - 1.234e9).abs() < 1.0);
    }

    #[test]
    fn parses_label_escapes() {
        let lbls = parse_labels(r#"a="x",b="y\"z",c="w\\v""#).unwrap();
        assert_eq!(lbls[0].1, "x");
        assert_eq!(lbls[1].1, "y\"z");
        assert_eq!(lbls[2].1, "w\\v");
    }
}

#[derive(Debug, Clone)]
pub struct ParsedSample {
    pub metric: String,
    pub labels: Vec<(String, String)>,
    pub value: f64,
    pub ts: i64, // 0 = use scrape time
}

pub fn parse_text(body: &str) -> Vec<ParsedSample> {
    let mut out = Vec::with_capacity(256);
    for raw in body.lines() {
        let trim = raw.trim();
        if trim.is_empty() || trim.starts_with('#') {
            continue;
        }
        if let Ok(s) = parse_line(raw) {
            out.push(s);
        }
    }
    out
}

fn parse_line(line: &str) -> Result<ParsedSample> {
    let bytes = line.as_bytes();
    let mut i = 0;
    while i < bytes.len() && is_name_char(bytes[i], i == 0) {
        i += 1;
    }
    if i == 0 {
        return Err(anyhow!("no metric name"));
    }
    let metric = line[..i].to_string();
    let mut labels = Vec::new();
    if i < bytes.len() && bytes[i] == b'{' {
        let close = line[i..].find('}').ok_or_else(|| anyhow!("unterminated labels"))?;
        labels = parse_labels(&line[i + 1..i + close])?;
        i += close + 1;
    }
    while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b'\t') {
        i += 1;
    }
    if i >= bytes.len() {
        return Err(anyhow!("missing value"));
    }
    let rest = &line[i..];
    let mut parts = rest.split_whitespace();
    let v_str = parts.next().ok_or_else(|| anyhow!("missing value"))?;
    let value: f64 = v_str.parse().map_err(|e| anyhow!("bad value {v_str}: {e}"))?;
    let ts: i64 = parts.next().map(|s| s.parse().unwrap_or(0)).unwrap_or(0);
    Ok(ParsedSample { metric, labels, value, ts })
}

fn is_name_char(c: u8, first: bool) -> bool {
    matches!(c, b'_' | b':' | b'a'..=b'z' | b'A'..=b'Z')
        || (!first && c.is_ascii_digit())
}

fn parse_labels(s: &str) -> Result<Vec<(String, String)>> {
    let bytes = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b'\t' || bytes[i] == b',') {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        let ns = i;
        while i < bytes.len()
            && (bytes[i] == b'_'
                || bytes[i].is_ascii_alphabetic()
                || (i > ns && bytes[i].is_ascii_digit()))
        {
            i += 1;
        }
        if ns == i {
            return Err(anyhow!("bad label name at {i}"));
        }
        let name = std::str::from_utf8(&bytes[ns..i])?.to_string();
        while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b'\t') {
            i += 1;
        }
        if i >= bytes.len() || bytes[i] != b'=' {
            return Err(anyhow!("missing = after {name}"));
        }
        i += 1;
        while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b'\t') {
            i += 1;
        }
        if i >= bytes.len() || bytes[i] != b'"' {
            return Err(anyhow!("missing \" for value of {name}"));
        }
        i += 1;
        let mut buf = String::new();
        while i < bytes.len() && bytes[i] != b'"' {
            if bytes[i] == b'\\' && i + 1 < bytes.len() {
                match bytes[i + 1] {
                    b'n' => buf.push('\n'),
                    b'\\' => buf.push('\\'),
                    b'"' => buf.push('"'),
                    other => buf.push(other as char),
                }
                i += 2;
                continue;
            }
            buf.push(bytes[i] as char);
            i += 1;
        }
        if i >= bytes.len() {
            return Err(anyhow!("unterminated value for {name}"));
        }
        i += 1; // closing "
        out.push((name, buf));
    }
    Ok(out)
}
