package main

import (
	"math"
	"testing"
	"time"
)

func mkStorage(t *testing.T) *Storage {
	t.Helper()
	st := NewStorage(64)
	// Two series of "cpu" at cpu=0 and cpu=1.
	for i, ts := range []int64{1000, 2000, 3000, 4000} {
		st.Append("cpu", Labels{{Name: "cpu", Value: "0"}}, ts, float64(10+i))
		st.Append("cpu", Labels{{Name: "cpu", Value: "1"}}, ts, float64(20+i*2))
	}
	// Counter that resets.
	st.Append("c", nil, 1000, 0)
	st.Append("c", nil, 2000, 5)
	st.Append("c", nil, 3000, 1) // reset
	st.Append("c", nil, 4000, 3)
	return st
}

func evalAt(t *testing.T, st *Storage, src string, ts int64) Value {
	t.Helper()
	expr, err := ParsePromQL(src)
	if err != nil {
		t.Fatalf("parse %q: %v", src, err)
	}
	v, err := NewEngine(st).Instant(expr, ts)
	if err != nil {
		t.Fatalf("eval %q: %v", src, err)
	}
	return v
}

func TestVectorSelector(t *testing.T) {
	st := mkStorage(t)
	v := evalAt(t, st, `cpu`, 4000).(Vector)
	if len(v) != 2 {
		t.Fatalf("want 2 samples, got %d", len(v))
	}
}

func TestAggregateSum(t *testing.T) {
	st := mkStorage(t)
	v := evalAt(t, st, `sum(cpu)`, 4000).(Vector)
	if len(v) != 1 || v[0].V != 13+26 {
		t.Fatalf("sum wrong: %+v", v)
	}
}

func TestAggregateBy(t *testing.T) {
	st := mkStorage(t)
	v := evalAt(t, st, `sum by(cpu)(cpu)`, 4000).(Vector)
	if len(v) != 2 {
		t.Fatalf("want 2 groups, got %d", len(v))
	}
}

func TestArithmetic(t *testing.T) {
	st := mkStorage(t)
	v := evalAt(t, st, `cpu * 2`, 4000).(Vector)
	if v[0].V != 26 && v[0].V != 52 {
		t.Fatalf("multiplication wrong: %+v", v)
	}
}

func TestRate(t *testing.T) {
	st := mkStorage(t)
	v := evalAt(t, st, `rate(c[5s])`, 4000).(Vector)
	// counter went 0,5,1,3 — reset adds 5; total delta = 5 + (3-1) = 7 over (5s) → 7/5
	if len(v) != 1 {
		t.Fatalf("want 1 series, got %v", v)
	}
	// counter 0,5,1,3 → reset between idx1 and idx2 adds 5 → delta=8 over 5s
	want := 8.0 / 5.0
	if math.Abs(v[0].V-want) > 1e-9 {
		t.Fatalf("rate wrong: got %g want %g", v[0].V, want)
	}
}

func TestComparisonFiltering(t *testing.T) {
	st := mkStorage(t)
	v := evalAt(t, st, `cpu > 20`, 4000).(Vector)
	// cpu=0 last value=13, cpu=1 last value=26 → only cpu=1 passes
	if len(v) != 1 || v[0].Labels.Get("cpu") != "1" || v[0].V != 26 {
		t.Fatalf("comparison wrong: %+v", v)
	}
}

func TestComparisonBool(t *testing.T) {
	st := mkStorage(t)
	v := evalAt(t, st, `cpu > bool 20`, 4000).(Vector)
	if len(v) != 2 {
		t.Fatalf("bool comparison should keep both: %+v", v)
	}
}

func TestUnsupportedFunc(t *testing.T) {
	if _, err := ParsePromQL(`topk(3, cpu)`); err == nil {
		t.Fatal("expected error for topk")
	}
	if _, err := ParsePromQL(`cpu and other`); err == nil {
		t.Fatal("expected error for set op")
	}
}

func TestRangeEval(t *testing.T) {
	st := mkStorage(t)
	expr, _ := ParsePromQL(`cpu`)
	mat, err := NewEngine(st).Range(expr, 1000, 4000, time.Second)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(mat) != 2 {
		t.Fatalf("want 2 series, got %d", len(mat))
	}
	for _, m := range mat {
		if len(m.Samples) != 4 {
			t.Errorf("want 4 samples per series, got %d", len(m.Samples))
		}
	}
}
