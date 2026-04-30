package main

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// AST node interface.
type Node interface {
	nodeMarker()
}

type NumberLit struct{ Val float64 }

type StringLit struct{ Val string }

type VectorSelector struct {
	Name     string
	Matchers []*Matcher
	Offset   time.Duration
}

type MatrixSelector struct {
	VS    *VectorSelector
	Range time.Duration
}

type UnaryExpr struct {
	Op   string // "+" or "-"
	Expr Node
}

type BinaryExpr struct {
	Op       string
	LHS, RHS Node
	Bool     bool // for comparison ops
}

type AggregateExpr struct {
	Op     string // sum, avg, min, max, count
	Expr   Node
	Group  string // "" / "by" / "without"
	Labels []string
}

type Call struct {
	Name string
	Args []Node
}

func (NumberLit) nodeMarker()      {}
func (StringLit) nodeMarker()      {}
func (*VectorSelector) nodeMarker(){}
func (*MatrixSelector) nodeMarker(){}
func (*UnaryExpr) nodeMarker()     {}
func (*BinaryExpr) nodeMarker()    {}
func (*AggregateExpr) nodeMarker() {}
func (*Call) nodeMarker()          {}

// ParsePromQL produces an AST.
func ParsePromQL(src string) (Node, error) {
	toks, err := lex(src)
	if err != nil {
		return nil, err
	}
	p := &parser{toks: toks}
	n, err := p.parseExpr(0)
	if err != nil {
		return nil, err
	}
	if p.peek().kind != tkEOF {
		return nil, fmt.Errorf("unexpected token %q at %d", p.peek().val, p.peek().pos)
	}
	return n, nil
}

type parser struct {
	toks []token
	i    int
}

func (p *parser) peek() token { return p.toks[p.i] }
func (p *parser) next() token {
	t := p.toks[p.i]
	p.i++
	return t
}

// Pratt-style operator precedence.
// 1: == != < > <= >= (with bool)
// 2: + -
// 3: * / %
// 4: unary +/-
func precedence(t token) int {
	switch t.kind {
	case tkEqEq, tkNeq, tkLt, tkGt, tkLe, tkGe:
		return 1
	case tkPlus, tkMinus:
		return 2
	case tkStar, tkSlash, tkPercent:
		return 3
	}
	return 0
}

func opName(t token) string {
	return t.val
}

func (p *parser) parseExpr(minPrec int) (Node, error) {
	lhs, err := p.parseUnary()
	if err != nil {
		return nil, err
	}
	for {
		t := p.peek()
		prec := precedence(t)
		if prec == 0 || prec < minPrec {
			break
		}
		p.next()
		// optional `bool` modifier for comparison ops
		isBool := false
		if (t.kind >= tkLt && t.kind <= tkEqEq) || t.kind == tkNeq || t.kind == tkLe || t.kind == tkGe {
			if p.peek().kind == tkIdent && strings.ToLower(p.peek().val) == "bool" {
				isBool = true
				p.next()
			}
		}
		rhs, err := p.parseExpr(prec + 1)
		if err != nil {
			return nil, err
		}
		lhs = &BinaryExpr{Op: opName(t), LHS: lhs, RHS: rhs, Bool: isBool}
	}
	return lhs, nil
}

func (p *parser) parseUnary() (Node, error) {
	t := p.peek()
	if t.kind == tkPlus || t.kind == tkMinus {
		p.next()
		e, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		return &UnaryExpr{Op: t.val, Expr: e}, nil
	}
	return p.parsePrimary()
}

func (p *parser) parsePrimary() (Node, error) {
	t := p.peek()
	switch t.kind {
	case tkNumber:
		p.next()
		v, err := strconv.ParseFloat(t.val, 64)
		if err != nil {
			return nil, fmt.Errorf("bad number %q", t.val)
		}
		return NumberLit{Val: v}, nil
	case tkString:
		p.next()
		return StringLit{Val: t.val}, nil
	case tkLParen:
		p.next()
		e, err := p.parseExpr(0)
		if err != nil {
			return nil, err
		}
		if p.peek().kind != tkRParen {
			return nil, fmt.Errorf("expected ) at %d", p.peek().pos)
		}
		p.next()
		return p.parsePostfix(e)
	case tkLBrace:
		// label-only selector: {__name__="foo"}
		vs, err := p.parseSelectorBody("")
		if err != nil {
			return nil, err
		}
		return p.parsePostfix(vs)
	case tkIdent:
		name := t.val
		p.next()
		// aggregation operator?
		if isAggOp(name) {
			return p.parseAggregation(name)
		}
		// function call?
		if p.peek().kind == tkLParen {
			return p.parseCall(name)
		}
		// vector selector
		vs, err := p.parseSelectorBody(name)
		if err != nil {
			return nil, err
		}
		return p.parsePostfix(vs)
	}
	return nil, fmt.Errorf("unexpected token %q at %d", t.val, t.pos)
}

func isAggOp(s string) bool {
	switch s {
	case "sum", "avg", "max", "min", "count":
		return true
	case "topk", "bottomk", "quantile", "stddev", "stdvar":
		return true // recognised so parseAggregation can return a clear "not implemented" error
	}
	return false
}

func (p *parser) parseAggregation(name string) (Node, error) {
	// optional `by/without (labels)` BEFORE the parenthesized expr
	group := ""
	var labels []string
	if p.peek().kind == tkIdent {
		k := strings.ToLower(p.peek().val)
		if k == "by" || k == "without" {
			group = k
			p.next()
			lbls, err := p.parseLabelList()
			if err != nil {
				return nil, err
			}
			labels = lbls
		}
	}
	if p.peek().kind != tkLParen {
		return nil, fmt.Errorf("expected ( after aggregation %s", name)
	}
	p.next()
	expr, err := p.parseExpr(0)
	if err != nil {
		return nil, err
	}
	if p.peek().kind != tkRParen {
		return nil, fmt.Errorf("expected ) after aggregation arg")
	}
	p.next()
	// optional `by/without (labels)` AFTER the parenthesized expr
	if group == "" && p.peek().kind == tkIdent {
		k := strings.ToLower(p.peek().val)
		if k == "by" || k == "without" {
			group = k
			p.next()
			lbls, err := p.parseLabelList()
			if err != nil {
				return nil, err
			}
			labels = lbls
		}
	}
	switch name {
	case "sum", "avg", "max", "min", "count":
		// supported
	default:
		return nil, fmt.Errorf("aggregation %q not implemented in mini-prometheus", name)
	}
	return &AggregateExpr{Op: name, Expr: expr, Group: group, Labels: labels}, nil
}

func (p *parser) parseLabelList() ([]string, error) {
	if p.peek().kind != tkLParen {
		return nil, fmt.Errorf("expected ( for label list")
	}
	p.next()
	out := []string{}
	for p.peek().kind != tkRParen {
		if p.peek().kind != tkIdent {
			return nil, fmt.Errorf("expected label name, got %q", p.peek().val)
		}
		out = append(out, p.next().val)
		if p.peek().kind == tkComma {
			p.next()
		}
	}
	p.next() // )
	return out, nil
}

func (p *parser) parseCall(name string) (Node, error) {
	p.next() // (
	args := []Node{}
	for p.peek().kind != tkRParen {
		a, err := p.parseExpr(0)
		if err != nil {
			return nil, err
		}
		args = append(args, a)
		if p.peek().kind == tkComma {
			p.next()
		}
	}
	p.next() // )
	if !isKnownFunc(name) {
		return nil, fmt.Errorf("function %q not implemented in mini-prometheus", name)
	}
	return p.parsePostfix(&Call{Name: name, Args: args})
}

func isKnownFunc(s string) bool {
	switch s {
	case "rate", "irate", "increase", "delta",
		"avg_over_time", "sum_over_time", "max_over_time", "min_over_time", "count_over_time",
		"time", "vector", "scalar", "abs", "clamp_min", "clamp_max":
		return true
	}
	return false
}

func (p *parser) parseSelectorBody(name string) (*VectorSelector, error) {
	vs := &VectorSelector{Name: name}
	if p.peek().kind == tkLBrace {
		p.next()
		for p.peek().kind != tkRBrace {
			if p.peek().kind != tkIdent {
				return nil, fmt.Errorf("expected label name in selector, got %q", p.peek().val)
			}
			lname := p.next().val
			t := p.next()
			var mt MatchType
			switch t.kind {
			case tkEq:
				mt = MatchEqual
			case tkNeq:
				mt = MatchNotEqual
			case tkRegMatch:
				mt = MatchRegexp
			case tkRegNoMatch:
				mt = MatchNotRegexp
			default:
				return nil, fmt.Errorf("expected matcher op after label %s", lname)
			}
			if p.peek().kind != tkString {
				return nil, fmt.Errorf("expected string after matcher op")
			}
			val := p.next().val
			m, err := NewMatcher(mt, lname, val)
			if err != nil {
				return nil, err
			}
			vs.Matchers = append(vs.Matchers, m)
			if p.peek().kind == tkComma {
				p.next()
			}
		}
		p.next() // }
	}
	if name != "" {
		m, _ := NewMatcher(MatchEqual, "__name__", name)
		vs.Matchers = append([]*Matcher{m}, vs.Matchers...)
	}
	if len(vs.Matchers) == 0 {
		return nil, fmt.Errorf("vector selector must contain at least one matcher")
	}
	return vs, nil
}

// parsePostfix handles range selectors `[5m]` and `offset 5m`.
func (p *parser) parsePostfix(n Node) (Node, error) {
	// range
	if p.peek().kind == tkLBracket {
		p.next()
		dur, err := p.parseDurationAhead()
		if err != nil {
			return nil, err
		}
		// reject subquery: [5m:1m]
		if p.peek().kind == tkColon {
			return nil, fmt.Errorf("subquery is not implemented in mini-prometheus")
		}
		if p.peek().kind != tkRBracket {
			return nil, fmt.Errorf("expected ] in range selector")
		}
		p.next()
		vs, ok := n.(*VectorSelector)
		if !ok {
			return nil, fmt.Errorf("range selector must follow a vector selector")
		}
		n = &MatrixSelector{VS: vs, Range: dur}
	}
	// offset
	if p.peek().kind == tkIdent && strings.ToLower(p.peek().val) == "offset" {
		p.next()
		dur, err := p.parseDurationAhead()
		if err != nil {
			return nil, err
		}
		switch v := n.(type) {
		case *VectorSelector:
			v.Offset = dur
		case *MatrixSelector:
			v.VS.Offset = dur
		default:
			return nil, fmt.Errorf("offset can only be applied to selectors")
		}
	}
	// reject @ modifier
	if p.peek().kind == tkIdent && p.peek().val == "@" {
		return nil, fmt.Errorf("@ modifier not implemented in mini-prometheus")
	}
	return n, nil
}

// parseDurationAhead consumes a sequence of (number, unit-ident) tokens
// produced by the lexer for inputs like "5m", "1h30m", "500ms".
func (p *parser) parseDurationAhead() (time.Duration, error) {
	var b strings.Builder
	for {
		t := p.peek()
		switch t.kind {
		case tkNumber:
			p.next()
			b.WriteString(t.val)
		case tkIdent:
			// Accept idents made entirely of duration unit chars (s, m, h, d, w, y, ms).
			ok := len(t.val) > 0
			for i := 0; ok && i < len(t.val); i++ {
				c := t.val[i]
				if c != 's' && c != 'm' && c != 'h' && c != 'd' && c != 'w' && c != 'y' {
					ok = false
				}
			}
			if !ok {
				goto done
			}
			p.next()
			b.WriteString(t.val)
		default:
			goto done
		}
	}
done:
	if b.Len() == 0 {
		return 0, fmt.Errorf("expected duration at %d", p.peek().pos)
	}
	return parseDur(b.String())
}

// parseDur accepts strings like "5m", "1h30m", "500ms".
func parseDur(s string) (time.Duration, error) {
	// PromQL allows "1y", "1w", "1d" which Go's time.ParseDuration doesn't.
	// Replace y/w/d with their hour equivalents.
	r := s
	r = strings.ReplaceAll(r, "y", "*8760h")
	r = strings.ReplaceAll(r, "w", "*168h")
	r = strings.ReplaceAll(r, "d", "*24h")
	if strings.Contains(r, "*") {
		// extremely simple eval: only supports single segments like "3*24h"
		parts := strings.SplitN(r, "*", 2)
		mult, err := strconv.Atoi(parts[0])
		if err != nil {
			return 0, fmt.Errorf("bad duration %q", s)
		}
		base, err := time.ParseDuration(parts[1])
		if err != nil {
			return 0, err
		}
		return time.Duration(mult) * base, nil
	}
	return time.ParseDuration(r)
}
