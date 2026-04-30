use anyhow::{anyhow, Result};

#[derive(Debug, Clone, PartialEq)]
pub enum TokKind {
    Eof,
    Ident,
    Number,
    Str,
    LParen,
    RParen,
    LBrace,
    RBrace,
    LBracket,
    RBracket,
    Comma,
    Colon,
    Plus,
    Minus,
    Star,
    Slash,
    Percent,
    Eq,
    Neq,
    EqEq,
    Lt,
    Gt,
    Le,
    Ge,
    RegMatch,
    RegNoMatch,
}

#[derive(Debug, Clone)]
pub struct Token {
    pub kind: TokKind,
    pub val: String,
    pub pos: usize,
}

pub fn lex(src: &str) -> Result<Vec<Token>> {
    let bytes = src.as_bytes();
    let mut i = 0;
    let mut out = Vec::new();
    while i < bytes.len() {
        let c = bytes[i];
        if c == b' ' || c == b'\t' || c == b'\n' || c == b'\r' {
            i += 1;
            continue;
        }
        match c {
            b'(' => { out.push(t(TokKind::LParen, "(", i)); i += 1; }
            b')' => { out.push(t(TokKind::RParen, ")", i)); i += 1; }
            b'{' => { out.push(t(TokKind::LBrace, "{", i)); i += 1; }
            b'}' => { out.push(t(TokKind::RBrace, "}", i)); i += 1; }
            b'[' => { out.push(t(TokKind::LBracket, "[", i)); i += 1; }
            b']' => { out.push(t(TokKind::RBracket, "]", i)); i += 1; }
            b',' => { out.push(t(TokKind::Comma, ",", i)); i += 1; }
            b':' => { out.push(t(TokKind::Colon, ":", i)); i += 1; }
            b'+' => { out.push(t(TokKind::Plus, "+", i)); i += 1; }
            b'-' => { out.push(t(TokKind::Minus, "-", i)); i += 1; }
            b'*' => { out.push(t(TokKind::Star, "*", i)); i += 1; }
            b'/' => { out.push(t(TokKind::Slash, "/", i)); i += 1; }
            b'%' => { out.push(t(TokKind::Percent, "%", i)); i += 1; }
            b'=' => {
                if bytes.get(i + 1) == Some(&b'=') {
                    out.push(t(TokKind::EqEq, "==", i));
                    i += 2;
                } else if bytes.get(i + 1) == Some(&b'~') {
                    out.push(t(TokKind::RegMatch, "=~", i));
                    i += 2;
                } else {
                    out.push(t(TokKind::Eq, "=", i));
                    i += 1;
                }
            }
            b'!' => {
                if bytes.get(i + 1) == Some(&b'=') {
                    out.push(t(TokKind::Neq, "!=", i));
                    i += 2;
                } else if bytes.get(i + 1) == Some(&b'~') {
                    out.push(t(TokKind::RegNoMatch, "!~", i));
                    i += 2;
                } else {
                    return Err(anyhow!("unexpected ! at {i}"));
                }
            }
            b'<' => {
                if bytes.get(i + 1) == Some(&b'=') {
                    out.push(t(TokKind::Le, "<=", i));
                    i += 2;
                } else {
                    out.push(t(TokKind::Lt, "<", i));
                    i += 1;
                }
            }
            b'>' => {
                if bytes.get(i + 1) == Some(&b'=') {
                    out.push(t(TokKind::Ge, ">=", i));
                    i += 2;
                } else {
                    out.push(t(TokKind::Gt, ">", i));
                    i += 1;
                }
            }
            b'"' | b'\'' => {
                let (s, n) = read_string(&src[i..])?;
                out.push(Token { kind: TokKind::Str, val: s, pos: i });
                i += n;
            }
            _ => {
                if c.is_ascii_digit()
                    || (c == b'.' && bytes.get(i + 1).map_or(false, |x| x.is_ascii_digit()))
                {
                    let n = read_number(&src[i..]);
                    out.push(Token {
                        kind: TokKind::Number,
                        val: src[i..i + n].to_string(),
                        pos: i,
                    });
                    i += n;
                } else if is_ident_start(c) {
                    let n = read_ident(&src[i..]);
                    out.push(Token {
                        kind: TokKind::Ident,
                        val: src[i..i + n].to_string(),
                        pos: i,
                    });
                    i += n;
                } else {
                    return Err(anyhow!("unexpected '{}' at {i}", c as char));
                }
            }
        }
    }
    out.push(Token { kind: TokKind::Eof, val: String::new(), pos: i });
    Ok(out)
}

fn t(kind: TokKind, val: &str, pos: usize) -> Token {
    Token { kind, val: val.to_string(), pos }
}

fn is_ident_start(c: u8) -> bool {
    c == b'_' || c.is_ascii_alphabetic()
}

fn is_ident(c: u8) -> bool {
    is_ident_start(c) || c.is_ascii_digit() || c == b':'
}

fn read_ident(s: &str) -> usize {
    s.bytes().take_while(|c| is_ident(*c)).count()
}

fn read_number(s: &str) -> usize {
    let bytes = s.as_bytes();
    let mut i = 0;
    if bytes[0] == b'+' || bytes[0] == b'-' {
        i += 1;
    }
    while i < bytes.len() {
        let c = bytes[i];
        if c.is_ascii_digit() || c == b'.' {
            i += 1;
        } else if (c == b'e' || c == b'E') && i + 1 < bytes.len() {
            i += 1;
            if bytes[i] == b'+' || bytes[i] == b'-' {
                i += 1;
            }
        } else {
            break;
        }
    }
    i
}

fn read_string(s: &str) -> Result<(String, usize)> {
    let bytes = s.as_bytes();
    let q = bytes[0];
    let mut buf = String::new();
    let mut i = 1;
    while i < bytes.len() && bytes[i] != q {
        if bytes[i] == b'\\' && i + 1 < bytes.len() {
            match bytes[i + 1] {
                b'n' => buf.push('\n'),
                b't' => buf.push('\t'),
                b'\\' => buf.push('\\'),
                b'"' => buf.push('"'),
                b'\'' => buf.push('\''),
                other => buf.push(other as char),
            }
            i += 2;
            continue;
        }
        buf.push(bytes[i] as char);
        i += 1;
    }
    if i >= bytes.len() {
        return Err(anyhow!("unterminated string"));
    }
    Ok((buf, i + 1))
}
