package main

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
)

// Result of evaluating an expression at a single timestamp.
type Value interface{ valueMarker() }

type Scalar struct {
	T int64 // ms
	V float64
}

type VectorSample struct {
	Labels Labels
	T      int64
	V      float64
}

type Vector []VectorSample

type MatrixEntry struct {
	Labels  Labels
	Samples []Sample
}

type Matrix []MatrixEntry

func (Scalar) valueMarker() {}
func (Vector) valueMarker() {}
func (Matrix) valueMarker() {}

type Engine struct{ st *Storage }

func NewEngine(st *Storage) *Engine { return &Engine{st: st} }

// Instant evaluates `expr` at time `ts` (ms).
func (e *Engine) Instant(expr Node, ts int64) (Value, error) {
	return e.eval(expr, ts)
}

// Range evaluates `expr` at each step from `start` to `end` (ms) inclusive.
func (e *Engine) Range(expr Node, start, end int64, step time.Duration) (Matrix, error) {
	stepMs := step.Milliseconds()
	if stepMs <= 0 {
		return nil, fmt.Errorf("step must be positive")
	}
	bucket := map[string]*MatrixEntry{}
	for t := start; t <= end; t += stepMs {
		v, err := e.eval(expr, t)
		if err != nil {
			return nil, err
		}
		switch r := v.(type) {
		case Scalar:
			key := ""
			b, ok := bucket[key]
			if !ok {
				b = &MatrixEntry{}
				bucket[key] = b
			}
			b.Samples = append(b.Samples, Sample{T: t, V: r.V})
		case Vector:
			for _, s := range r {
				key := s.Labels.hashKey()
				b, ok := bucket[key]
				if !ok {
					b = &MatrixEntry{Labels: s.Labels}
					bucket[key] = b
				}
				b.Samples = append(b.Samples, Sample{T: t, V: s.V})
			}
		default:
			return nil, fmt.Errorf("range eval produced unsupported type")
		}
	}
	keys := make([]string, 0, len(bucket))
	for k := range bucket {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make(Matrix, 0, len(keys))
	for _, k := range keys {
		out = append(out, *bucket[k])
	}
	return out, nil
}

func (e *Engine) eval(n Node, ts int64) (Value, error) {
	switch x := n.(type) {
	case NumberLit:
		return Scalar{T: ts, V: x.Val}, nil
	case StringLit:
		return Scalar{T: ts, V: 0}, nil
	case *VectorSelector:
		return e.evalVS(x, ts), nil
	case *MatrixSelector:
		return nil, fmt.Errorf("range vectors only allowed inside functions")
	case *UnaryExpr:
		v, err := e.eval(x.Expr, ts)
		if err != nil {
			return nil, err
		}
		if x.Op == "+" {
			return v, nil
		}
		return negate(v), nil
	case *BinaryExpr:
		return e.evalBinary(x, ts)
	case *AggregateExpr:
		return e.evalAggregate(x, ts)
	case *Call:
		return e.evalCall(x, ts)
	}
	return nil, fmt.Errorf("unsupported AST node %T", n)
}

func (e *Engine) evalVS(vs *VectorSelector, ts int64) Vector {
	at := ts - vs.Offset.Milliseconds()
	series := e.st.Select(vs.Matchers)
	// staleness threshold (5 min, like Prometheus default).
	const stale = 5 * 60 * 1000
	out := make(Vector, 0, len(series))
	for _, s := range series {
		samp, ok := s.latestBefore(at)
		if !ok {
			continue
		}
		if at-samp.T > stale {
			continue
		}
		out = append(out, VectorSample{Labels: s.Labels.WithoutName(), T: ts, V: samp.V})
	}
	return out
}

func (e *Engine) evalMatrix(ms *MatrixSelector, ts int64) Matrix {
	at := ts - ms.VS.Offset.Milliseconds()
	start := at - ms.Range.Milliseconds()
	series := e.st.Select(ms.VS.Matchers)
	out := make(Matrix, 0, len(series))
	for _, s := range series {
		samples := s.rangeSamples(start, at)
		if len(samples) == 0 {
			continue
		}
		out = append(out, MatrixEntry{Labels: s.Labels.WithoutName(), Samples: samples})
	}
	return out
}

func negate(v Value) Value {
	switch x := v.(type) {
	case Scalar:
		return Scalar{T: x.T, V: -x.V}
	case Vector:
		out := make(Vector, len(x))
		for i, s := range x {
			s.V = -s.V
			out[i] = s
		}
		return out
	}
	return v
}

// ---- binary ----

func (e *Engine) evalBinary(b *BinaryExpr, ts int64) (Value, error) {
	lhs, err := e.eval(b.LHS, ts)
	if err != nil {
		return nil, err
	}
	rhs, err := e.eval(b.RHS, ts)
	if err != nil {
		return nil, err
	}
	op := b.Op
	switch l := lhs.(type) {
	case Scalar:
		switch r := rhs.(type) {
		case Scalar:
			v, ok := applyOp(op, l.V, r.V, b.Bool)
			if !ok {
				return Vector{}, nil
			}
			return Scalar{T: ts, V: v}, nil
		case Vector:
			return scalarVector(op, l.V, r, b.Bool, false), nil
		}
	case Vector:
		switch r := rhs.(type) {
		case Scalar:
			return scalarVector(op, r.V, l, b.Bool, true), nil
		case Vector:
			return vectorVector(op, l, r, b.Bool), nil
		}
	}
	return nil, fmt.Errorf("unsupported operand types for %s", op)
}

func applyOp(op string, l, r float64, isBool bool) (float64, bool) {
	switch op {
	case "+":
		return l + r, true
	case "-":
		return l - r, true
	case "*":
		return l * r, true
	case "/":
		if r == 0 {
			return math.Inf(1), true
		}
		return l / r, true
	case "%":
		if r == 0 {
			return math.NaN(), true
		}
		return math.Mod(l, r), true
	case "==", "!=", "<", ">", "<=", ">=":
		c := false
		switch op {
		case "==":
			c = l == r
		case "!=":
			c = l != r
		case "<":
			c = l < r
		case ">":
			c = l > r
		case "<=":
			c = l <= r
		case ">=":
			c = l >= r
		}
		if isBool {
			if c {
				return 1, true
			}
			return 0, true
		}
		if c {
			return l, true
		}
		return 0, false // false → drop sample
	}
	return 0, false
}

func scalarVector(op string, scalar float64, v Vector, isBool, scalarOnRight bool) Vector {
	out := make(Vector, 0, len(v))
	for _, s := range v {
		var l, r float64
		if scalarOnRight {
			l, r = s.V, scalar
		} else {
			l, r = scalar, s.V
		}
		val, ok := applyOp(op, l, r, isBool)
		if !ok {
			continue
		}
		out = append(out, VectorSample{Labels: s.Labels, T: s.T, V: val})
	}
	return out
}

func vectorVector(op string, lhs, rhs Vector, isBool bool) Vector {
	idx := map[string]VectorSample{}
	for _, s := range rhs {
		idx[s.Labels.hashKey()] = s
	}
	out := make(Vector, 0, len(lhs))
	for _, l := range lhs {
		key := l.Labels.hashKey()
		r, ok := idx[key]
		if !ok {
			continue
		}
		val, keep := applyOp(op, l.V, r.V, isBool)
		if !keep {
			continue
		}
		out = append(out, VectorSample{Labels: l.Labels, T: l.T, V: val})
	}
	return out
}

// ---- aggregation ----

func (e *Engine) evalAggregate(a *AggregateExpr, ts int64) (Value, error) {
	v, err := e.eval(a.Expr, ts)
	if err != nil {
		return nil, err
	}
	vec, ok := v.(Vector)
	if !ok {
		return nil, fmt.Errorf("aggregation expects an instant vector")
	}
	groups := map[string]*aggGroup{}
	keep := func(lbls Labels) Labels {
		if a.Group == "by" {
			out := Labels{}
			for _, want := range a.Labels {
				if lv := lbls.Get(want); lv != "" || lbls.Has(want) {
					out = append(out, Label{Name: want, Value: lv})
				}
			}
			sort.Sort(out)
			return out
		}
		if a.Group == "without" {
			drop := map[string]bool{"__name__": true}
			for _, w := range a.Labels {
				drop[w] = true
			}
			out := Labels{}
			for _, kv := range lbls {
				if drop[kv.Name] {
					continue
				}
				out = append(out, kv)
			}
			sort.Sort(out)
			return out
		}
		return Labels{}
	}
	for _, s := range vec {
		gkey := keep(s.Labels)
		k := gkey.hashKey()
		g, ok := groups[k]
		if !ok {
			g = &aggGroup{Labels: gkey, Min: math.Inf(1), Max: math.Inf(-1)}
			groups[k] = g
		}
		g.add(s.V)
	}
	out := make(Vector, 0, len(groups))
	keys := make([]string, 0, len(groups))
	for k := range groups {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		g := groups[k]
		out = append(out, VectorSample{Labels: g.Labels, T: ts, V: g.value(a.Op)})
	}
	return out, nil
}

type aggGroup struct {
	Labels   Labels
	Sum      float64
	Count    float64
	Min, Max float64
}

func (g *aggGroup) add(v float64) {
	g.Sum += v
	g.Count++
	if v < g.Min {
		g.Min = v
	}
	if v > g.Max {
		g.Max = v
	}
}

func (g *aggGroup) value(op string) float64 {
	switch op {
	case "sum":
		return g.Sum
	case "count":
		return g.Count
	case "avg":
		if g.Count == 0 {
			return math.NaN()
		}
		return g.Sum / g.Count
	case "min":
		return g.Min
	case "max":
		return g.Max
	}
	return math.NaN()
}

// ---- function calls ----

func (e *Engine) evalCall(c *Call, ts int64) (Value, error) {
	switch c.Name {
	case "time":
		return Scalar{T: ts, V: float64(ts) / 1000.0}, nil
	case "vector":
		if len(c.Args) != 1 {
			return nil, fmt.Errorf("vector() expects 1 arg")
		}
		v, err := e.eval(c.Args[0], ts)
		if err != nil {
			return nil, err
		}
		s, ok := v.(Scalar)
		if !ok {
			return nil, fmt.Errorf("vector() expects a scalar")
		}
		return Vector{{Labels: Labels{}, T: ts, V: s.V}}, nil
	case "scalar":
		if len(c.Args) != 1 {
			return nil, fmt.Errorf("scalar() expects 1 arg")
		}
		v, err := e.eval(c.Args[0], ts)
		if err != nil {
			return nil, err
		}
		vec, ok := v.(Vector)
		if !ok {
			return nil, fmt.Errorf("scalar() expects an instant vector")
		}
		if len(vec) != 1 {
			return Scalar{T: ts, V: math.NaN()}, nil
		}
		return Scalar{T: ts, V: vec[0].V}, nil
	case "abs":
		v, err := e.evalToVector(c.Args[0], ts)
		if err != nil {
			return nil, err
		}
		out := make(Vector, len(v))
		for i, s := range v {
			s.V = math.Abs(s.V)
			out[i] = s
		}
		return out, nil
	case "clamp_min", "clamp_max":
		if len(c.Args) != 2 {
			return nil, fmt.Errorf("%s expects 2 args", c.Name)
		}
		v, err := e.evalToVector(c.Args[0], ts)
		if err != nil {
			return nil, err
		}
		s, err := e.eval(c.Args[1], ts)
		if err != nil {
			return nil, err
		}
		sc, ok := s.(Scalar)
		if !ok {
			return nil, fmt.Errorf("%s 2nd arg must be scalar", c.Name)
		}
		out := make(Vector, len(v))
		for i, e := range v {
			if c.Name == "clamp_min" && e.V < sc.V {
				e.V = sc.V
			}
			if c.Name == "clamp_max" && e.V > sc.V {
				e.V = sc.V
			}
			out[i] = e
		}
		return out, nil
	}
	// All remaining calls take a range vector.
	if len(c.Args) != 1 {
		return nil, fmt.Errorf("%s expects 1 arg", c.Name)
	}
	ms, ok := c.Args[0].(*MatrixSelector)
	if !ok {
		return nil, fmt.Errorf("%s expects a range vector", c.Name)
	}
	mat := e.evalMatrix(ms, ts)
	out := make(Vector, 0, len(mat))
	for _, m := range mat {
		v, ok := applyRangeFunc(c.Name, m.Samples, ms.Range)
		if !ok {
			continue
		}
		out = append(out, VectorSample{Labels: m.Labels, T: ts, V: v})
	}
	return out, nil
}

func (e *Engine) evalToVector(n Node, ts int64) (Vector, error) {
	v, err := e.eval(n, ts)
	if err != nil {
		return nil, err
	}
	switch x := v.(type) {
	case Vector:
		return x, nil
	case Scalar:
		return Vector{{Labels: Labels{}, T: ts, V: x.V}}, nil
	}
	return nil, fmt.Errorf("expected vector")
}

func applyRangeFunc(name string, samples []Sample, rng time.Duration) (float64, bool) {
	switch name {
	case "rate", "irate", "increase", "delta":
		if len(samples) < 2 {
			return 0, false
		}
		first, last := samples[0], samples[len(samples)-1]
		var delta float64
		switch name {
		case "rate", "increase":
			delta = last.V - first.V
			// reset detection (counter went down)
			for i := 1; i < len(samples); i++ {
				if samples[i].V < samples[i-1].V {
					delta += samples[i-1].V
				}
			}
			if name == "rate" {
				return delta / float64(rng.Seconds()), true
			}
			return delta, true
		case "irate":
			a := samples[len(samples)-2]
			b := samples[len(samples)-1]
			dv := b.V - a.V
			if dv < 0 {
				dv = b.V
			}
			dt := float64(b.T-a.T) / 1000.0
			if dt == 0 {
				return 0, false
			}
			return dv / dt, true
		case "delta":
			return last.V - first.V, true
		}
	case "avg_over_time":
		var s float64
		for _, x := range samples {
			s += x.V
		}
		return s / float64(len(samples)), true
	case "sum_over_time":
		var s float64
		for _, x := range samples {
			s += x.V
		}
		return s, true
	case "max_over_time":
		m := math.Inf(-1)
		for _, x := range samples {
			if x.V > m {
				m = x.V
			}
		}
		return m, true
	case "min_over_time":
		m := math.Inf(1)
		for _, x := range samples {
			if x.V < m {
				m = x.V
			}
		}
		return m, true
	case "count_over_time":
		return float64(len(samples)), true
	}
	return 0, false
}

// ---- pretty printers ----

func (s Scalar) String() string { return fmt.Sprintf("%g @%d", s.V, s.T) }
func (v Vector) String() string {
	parts := make([]string, len(v))
	for i, x := range v {
		parts[i] = fmt.Sprintf("%v=%g", x.Labels.Map(), x.V)
	}
	return "{" + strings.Join(parts, ", ") + "}"
}
