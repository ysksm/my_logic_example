package main

import (
	"fmt"
	"strings"
	"unicode"
)

type tokKind int

const (
	tkEOF tokKind = iota
	tkIdent
	tkNumber
	tkString
	tkLParen
	tkRParen
	tkLBrace
	tkRBrace
	tkLBracket
	tkRBracket
	tkComma
	tkPlus
	tkMinus
	tkStar
	tkSlash
	tkPercent
	tkEq      // =
	tkNeq     // !=
	tkRegMatch    // =~
	tkRegNoMatch  // !~
	tkLt    // <
	tkGt    // >
	tkLe    // <=
	tkGe    // >=
	tkEqEq  // ==
	tkColon
)

type token struct {
	kind tokKind
	val  string
	pos  int
}

type lexer struct {
	src  string
	pos  int
	toks []token
}

func lex(src string) ([]token, error) {
	l := &lexer{src: src}
	for l.pos < len(l.src) {
		c := l.src[l.pos]
		if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
			l.pos++
			continue
		}
		switch c {
		case '(':
			l.emit(tkLParen, "(", 1)
		case ')':
			l.emit(tkRParen, ")", 1)
		case '{':
			l.emit(tkLBrace, "{", 1)
		case '}':
			l.emit(tkRBrace, "}", 1)
		case '[':
			l.emit(tkLBracket, "[", 1)
		case ']':
			l.emit(tkRBracket, "]", 1)
		case ',':
			l.emit(tkComma, ",", 1)
		case '+':
			l.emit(tkPlus, "+", 1)
		case '-':
			l.emit(tkMinus, "-", 1)
		case '*':
			l.emit(tkStar, "*", 1)
		case '/':
			l.emit(tkSlash, "/", 1)
		case '%':
			l.emit(tkPercent, "%", 1)
		case ':':
			l.emit(tkColon, ":", 1)
		case '=':
			if l.peek(1) == '=' {
				l.emit(tkEqEq, "==", 2)
			} else if l.peek(1) == '~' {
				l.emit(tkRegMatch, "=~", 2)
			} else {
				l.emit(tkEq, "=", 1)
			}
		case '!':
			if l.peek(1) == '=' {
				l.emit(tkNeq, "!=", 2)
			} else if l.peek(1) == '~' {
				l.emit(tkRegNoMatch, "!~", 2)
			} else {
				return nil, fmt.Errorf("unexpected ! at %d", l.pos)
			}
		case '<':
			if l.peek(1) == '=' {
				l.emit(tkLe, "<=", 2)
			} else {
				l.emit(tkLt, "<", 1)
			}
		case '>':
			if l.peek(1) == '=' {
				l.emit(tkGe, ">=", 2)
			} else {
				l.emit(tkGt, ">", 1)
			}
		case '"', '\'':
			s, n, err := readString(l.src[l.pos:])
			if err != nil {
				return nil, fmt.Errorf("at %d: %w", l.pos, err)
			}
			l.toks = append(l.toks, token{kind: tkString, val: s, pos: l.pos})
			l.pos += n
		default:
			if isDigit(c) || (c == '.' && l.pos+1 < len(l.src) && isDigit(l.src[l.pos+1])) {
				n := readNumber(l.src[l.pos:])
				l.toks = append(l.toks, token{kind: tkNumber, val: l.src[l.pos : l.pos+n], pos: l.pos})
				l.pos += n
			} else if isIdentStart(c) {
				n := readIdent(l.src[l.pos:])
				l.toks = append(l.toks, token{kind: tkIdent, val: l.src[l.pos : l.pos+n], pos: l.pos})
				l.pos += n
			} else {
				return nil, fmt.Errorf("unexpected %q at %d", c, l.pos)
			}
		}
	}
	l.toks = append(l.toks, token{kind: tkEOF, pos: l.pos})
	return l.toks, nil
}

func (l *lexer) emit(k tokKind, v string, n int) {
	l.toks = append(l.toks, token{kind: k, val: v, pos: l.pos})
	l.pos += n
}

func (l *lexer) peek(n int) byte {
	if l.pos+n >= len(l.src) {
		return 0
	}
	return l.src[l.pos+n]
}

func isDigit(c byte) bool      { return c >= '0' && c <= '9' }
func isIdentStart(c byte) bool { return c == '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') }
func isIdent(c byte) bool      { return isIdentStart(c) || isDigit(c) || c == ':' }

func readIdent(s string) int {
	i := 0
	for i < len(s) && isIdent(s[i]) {
		i++
	}
	return i
}

func readNumber(s string) int {
	i := 0
	if s[0] == '+' || s[0] == '-' {
		i++
	}
	for i < len(s) {
		c := s[i]
		if isDigit(c) || c == '.' {
			i++
			continue
		}
		if (c == 'e' || c == 'E') && i+1 < len(s) {
			i++
			if s[i] == '+' || s[i] == '-' {
				i++
			}
			continue
		}
		break
	}
	return i
}

func readString(s string) (string, int, error) {
	if len(s) == 0 {
		return "", 0, fmt.Errorf("empty string")
	}
	q := s[0]
	var b strings.Builder
	i := 1
	for i < len(s) && s[i] != q {
		if s[i] == '\\' && i+1 < len(s) {
			switch s[i+1] {
			case 'n':
				b.WriteByte('\n')
			case 't':
				b.WriteByte('\t')
			case '\\':
				b.WriteByte('\\')
			case '"':
				b.WriteByte('"')
			case '\'':
				b.WriteByte('\'')
			default:
				b.WriteByte(s[i+1])
			}
			i += 2
			continue
		}
		b.WriteByte(s[i])
		i++
	}
	if i >= len(s) {
		return "", 0, fmt.Errorf("unterminated string")
	}
	return b.String(), i + 1, nil
}

// keywords (case-insensitive in some places; we keep them as plain idents and
// match against a fixed list at parse time).
var keywords = map[string]struct{}{
	"and": {}, "or": {}, "unless": {},
	"by": {}, "without": {}, "ignoring": {}, "on": {},
	"group_left": {}, "group_right": {}, "offset": {}, "bool": {},
}

func isKeyword(s string) bool {
	_, ok := keywords[strings.ToLower(s)]
	return ok
}

// helper used by parser and lexer
var _ = unicode.IsLetter
