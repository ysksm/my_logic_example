use std::time::Duration;

use anyhow::{anyhow, Result};

use super::lex::{lex, TokKind, Token};
use crate::storage::{MatchType, Matcher};

#[derive(Debug, Clone)]
pub enum Node {
    Number(f64),
    StringLit(String),
    VectorSel(VectorSelector),
    MatrixSel(MatrixSelector),
    Unary { op: String, expr: Box<Node> },
    Binary { op: String, lhs: Box<Node>, rhs: Box<Node>, bool_modifier: bool },
    Aggregate { op: String, expr: Box<Node>, group: Group },
    Call { name: String, args: Vec<Node> },
}

#[derive(Debug, Clone)]
pub struct VectorSelector {
    pub name: String,
    pub matchers: Vec<Matcher>,
    pub offset: Duration,
}

#[derive(Debug, Clone)]
pub struct MatrixSelector {
    pub vs: VectorSelector,
    pub range: Duration,
}

#[derive(Debug, Clone)]
pub enum Group {
    None,
    By(Vec<String>),
    Without(Vec<String>),
}

pub fn parse(src: &str) -> Result<Node> {
    let toks = lex(src)?;
    let mut p = Parser { toks, i: 0 };
    let n = p.parse_expr(0)?;
    if p.peek().kind != TokKind::Eof {
        return Err(anyhow!("unexpected token {:?} at {}", p.peek().val, p.peek().pos));
    }
    Ok(n)
}

struct Parser {
    toks: Vec<Token>,
    i: usize,
}

impl Parser {
    fn peek(&self) -> &Token { &self.toks[self.i] }
    fn next(&mut self) -> Token {
        let t = self.toks[self.i].clone();
        self.i += 1;
        t
    }
    fn precedence(&self, t: &Token) -> i32 {
        match t.kind {
            TokKind::EqEq | TokKind::Neq | TokKind::Lt | TokKind::Gt | TokKind::Le | TokKind::Ge => 1,
            TokKind::Plus | TokKind::Minus => 2,
            TokKind::Star | TokKind::Slash | TokKind::Percent => 3,
            _ => 0,
        }
    }

    fn parse_expr(&mut self, min_prec: i32) -> Result<Node> {
        let mut lhs = self.parse_unary()?;
        loop {
            let t = self.peek().clone();
            let prec = self.precedence(&t);
            if prec == 0 || prec < min_prec {
                break;
            }
            self.next();
            let mut bool_modifier = false;
            if matches!(t.kind, TokKind::EqEq | TokKind::Neq | TokKind::Lt | TokKind::Gt | TokKind::Le | TokKind::Ge) {
                if self.peek().kind == TokKind::Ident && self.peek().val.eq_ignore_ascii_case("bool") {
                    bool_modifier = true;
                    self.next();
                }
            }
            let rhs = self.parse_expr(prec + 1)?;
            lhs = Node::Binary {
                op: t.val.clone(),
                lhs: Box::new(lhs),
                rhs: Box::new(rhs),
                bool_modifier,
            };
        }
        Ok(lhs)
    }

    fn parse_unary(&mut self) -> Result<Node> {
        let t = self.peek().clone();
        if matches!(t.kind, TokKind::Plus | TokKind::Minus) {
            self.next();
            let e = self.parse_unary()?;
            return Ok(Node::Unary { op: t.val, expr: Box::new(e) });
        }
        self.parse_primary()
    }

    fn parse_primary(&mut self) -> Result<Node> {
        let t = self.peek().clone();
        match t.kind {
            TokKind::Number => {
                self.next();
                let v: f64 = t.val.parse().map_err(|_| anyhow!("bad number {:?}", t.val))?;
                Ok(Node::Number(v))
            }
            TokKind::Str => {
                self.next();
                Ok(Node::StringLit(t.val))
            }
            TokKind::LParen => {
                self.next();
                let e = self.parse_expr(0)?;
                if self.peek().kind != TokKind::RParen {
                    return Err(anyhow!("expected ) at {}", self.peek().pos));
                }
                self.next();
                self.parse_postfix(e)
            }
            TokKind::LBrace => {
                let vs = self.parse_selector_body("")?;
                self.parse_postfix(Node::VectorSel(vs))
            }
            TokKind::Ident => {
                let name = t.val.clone();
                self.next();
                if is_agg_op(&name) {
                    return self.parse_aggregation(&name);
                }
                if self.peek().kind == TokKind::LParen {
                    return self.parse_call(&name);
                }
                let vs = self.parse_selector_body(&name)?;
                self.parse_postfix(Node::VectorSel(vs))
            }
            _ => Err(anyhow!("unexpected token {:?} at {}", t.val, t.pos)),
        }
    }

    fn parse_aggregation(&mut self, name: &str) -> Result<Node> {
        let mut group = Group::None;
        if self.peek().kind == TokKind::Ident {
            let k = self.peek().val.to_ascii_lowercase();
            if k == "by" || k == "without" {
                self.next();
                let lbls = self.parse_label_list()?;
                group = if k == "by" { Group::By(lbls) } else { Group::Without(lbls) };
            }
        }
        if self.peek().kind != TokKind::LParen {
            return Err(anyhow!("expected ( after aggregation {name}"));
        }
        self.next();
        let expr = self.parse_expr(0)?;
        if self.peek().kind != TokKind::RParen {
            return Err(anyhow!("expected ) after aggregation arg"));
        }
        self.next();
        if matches!(group, Group::None) && self.peek().kind == TokKind::Ident {
            let k = self.peek().val.to_ascii_lowercase();
            if k == "by" || k == "without" {
                self.next();
                let lbls = self.parse_label_list()?;
                group = if k == "by" { Group::By(lbls) } else { Group::Without(lbls) };
            }
        }
        match name {
            "sum" | "avg" | "max" | "min" | "count" => {}
            _ => return Err(anyhow!("aggregation {:?} not implemented in mini-prometheus", name)),
        }
        Ok(Node::Aggregate {
            op: name.to_string(),
            expr: Box::new(expr),
            group,
        })
    }

    fn parse_label_list(&mut self) -> Result<Vec<String>> {
        if self.peek().kind != TokKind::LParen {
            return Err(anyhow!("expected ( for label list"));
        }
        self.next();
        let mut out = Vec::new();
        while self.peek().kind != TokKind::RParen {
            if self.peek().kind != TokKind::Ident {
                return Err(anyhow!("expected label name, got {:?}", self.peek().val));
            }
            out.push(self.next().val);
            if self.peek().kind == TokKind::Comma {
                self.next();
            }
        }
        self.next();
        Ok(out)
    }

    fn parse_call(&mut self, name: &str) -> Result<Node> {
        self.next(); // (
        let mut args = Vec::new();
        while self.peek().kind != TokKind::RParen {
            args.push(self.parse_expr(0)?);
            if self.peek().kind == TokKind::Comma {
                self.next();
            }
        }
        self.next(); // )
        if !is_known_func(name) {
            return Err(anyhow!("function {:?} not implemented in mini-prometheus", name));
        }
        self.parse_postfix(Node::Call {
            name: name.to_string(),
            args,
        })
    }

    fn parse_selector_body(&mut self, name: &str) -> Result<VectorSelector> {
        let mut matchers: Vec<Matcher> = Vec::new();
        if self.peek().kind == TokKind::LBrace {
            self.next();
            while self.peek().kind != TokKind::RBrace {
                if self.peek().kind != TokKind::Ident {
                    return Err(anyhow!(
                        "expected label name in selector, got {:?}",
                        self.peek().val
                    ));
                }
                let lname = self.next().val;
                let op = self.next();
                let mt = match op.kind {
                    TokKind::Eq => MatchType::Eq,
                    TokKind::Neq => MatchType::NotEq,
                    TokKind::RegMatch => MatchType::Re,
                    TokKind::RegNoMatch => MatchType::NotRe,
                    _ => return Err(anyhow!("expected matcher op after label {lname}")),
                };
                if self.peek().kind != TokKind::Str {
                    return Err(anyhow!("expected string after matcher op"));
                }
                let val = self.next().val;
                matchers.push(Matcher::new(mt, lname, val)?);
                if self.peek().kind == TokKind::Comma {
                    self.next();
                }
            }
            self.next();
        }
        if !name.is_empty() {
            let m = Matcher::new(MatchType::Eq, "__name__".to_string(), name.to_string())?;
            matchers.insert(0, m);
        }
        if matchers.is_empty() {
            return Err(anyhow!("vector selector must contain at least one matcher"));
        }
        Ok(VectorSelector {
            name: name.to_string(),
            matchers,
            offset: Duration::ZERO,
        })
    }

    fn parse_postfix(&mut self, mut n: Node) -> Result<Node> {
        if self.peek().kind == TokKind::LBracket {
            self.next();
            let dur = self.parse_duration_ahead()?;
            if self.peek().kind == TokKind::Colon {
                return Err(anyhow!("subquery is not implemented in mini-prometheus"));
            }
            if self.peek().kind != TokKind::RBracket {
                return Err(anyhow!("expected ] in range selector"));
            }
            self.next();
            n = match n {
                Node::VectorSel(vs) => Node::MatrixSel(MatrixSelector { vs, range: dur }),
                _ => return Err(anyhow!("range selector must follow a vector selector")),
            };
        }
        if self.peek().kind == TokKind::Ident && self.peek().val.eq_ignore_ascii_case("offset") {
            self.next();
            let dur = self.parse_duration_ahead()?;
            n = match n {
                Node::VectorSel(mut vs) => {
                    vs.offset = dur;
                    Node::VectorSel(vs)
                }
                Node::MatrixSel(mut ms) => {
                    ms.vs.offset = dur;
                    Node::MatrixSel(ms)
                }
                _ => return Err(anyhow!("offset can only be applied to selectors")),
            };
        }
        if self.peek().kind == TokKind::Ident && self.peek().val == "@" {
            return Err(anyhow!("@ modifier not implemented in mini-prometheus"));
        }
        Ok(n)
    }

    fn parse_duration_ahead(&mut self) -> Result<Duration> {
        let mut buf = String::new();
        loop {
            let t = self.peek().clone();
            match t.kind {
                TokKind::Number => {
                    self.next();
                    buf.push_str(&t.val);
                }
                TokKind::Ident => {
                    let ok = !t.val.is_empty()
                        && t.val.bytes().all(|c| matches!(c, b's' | b'm' | b'h' | b'd' | b'w' | b'y'));
                    if !ok {
                        break;
                    }
                    self.next();
                    buf.push_str(&t.val);
                }
                _ => break,
            }
        }
        if buf.is_empty() {
            return Err(anyhow!("expected duration at {}", self.peek().pos));
        }
        parse_dur(&buf)
    }
}

fn is_agg_op(s: &str) -> bool {
    matches!(s, "sum" | "avg" | "max" | "min" | "count" | "topk" | "bottomk" | "quantile" | "stddev" | "stdvar")
}

fn is_known_func(s: &str) -> bool {
    matches!(
        s,
        "rate" | "irate" | "increase" | "delta"
            | "avg_over_time" | "sum_over_time" | "max_over_time" | "min_over_time" | "count_over_time"
            | "time" | "vector" | "scalar" | "abs" | "clamp_min" | "clamp_max"
    )
}

pub fn parse_dur(s: &str) -> Result<Duration> {
    // Replace y/w/d with their second equivalents, then parse via humantime.
    // Splitting is important because humantime supports "1h30m" but not "1y" / "1w" / "1d".
    let mut total = Duration::ZERO;
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let n_start = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
        if i == n_start {
            return Err(anyhow!("bad duration: {s}"));
        }
        let num: u64 = s[n_start..i].parse().map_err(|_| anyhow!("bad duration: {s}"))?;
        // unit
        let u_start = i;
        while i < bytes.len() && !bytes[i].is_ascii_digit() {
            i += 1;
        }
        let unit = &s[u_start..i];
        let secs = match unit {
            "ms" => return Ok(Duration::from_millis(num)),
            "s" => num,
            "m" => num * 60,
            "h" => num * 3600,
            "d" => num * 86400,
            "w" => num * 604800,
            "y" => num * 31_536_000,
            other => return Err(anyhow!("unknown duration unit {other:?}")),
        };
        total += Duration::from_secs(secs);
    }
    Ok(total)
}
