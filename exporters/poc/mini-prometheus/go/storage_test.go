package main

import "testing"

func TestRingBufferOverwrite(t *testing.T) {
	st := NewStorage(3)
	for i := int64(1); i <= 5; i++ {
		st.Append("m", nil, i*1000, float64(i))
	}
	series := st.Select([]*Matcher{mustEq("__name__", "m")})
	if len(series) != 1 {
		t.Fatalf("want 1 series, got %d", len(series))
	}
	s := series[0]
	rng := s.rangeSamples(0, 10000)
	if len(rng) != 3 {
		t.Fatalf("ring buffer should keep 3, got %d", len(rng))
	}
	if rng[0].V != 3 || rng[2].V != 5 {
		t.Errorf("ring buffer order wrong: %+v", rng)
	}
}

func TestRegexpMatcher(t *testing.T) {
	st := NewStorage(4)
	st.Append("cpu", Labels{{Name: "cpu", Value: "0"}}, 1, 1)
	st.Append("cpu", Labels{{Name: "cpu", Value: "1"}}, 1, 2)
	st.Append("cpu", Labels{{Name: "cpu", Value: "total"}}, 1, 3)
	m, err := NewMatcher(MatchRegexp, "cpu", "[0-9]+")
	if err != nil {
		t.Fatal(err)
	}
	got := st.Select([]*Matcher{mustEq("__name__", "cpu"), m})
	if len(got) != 2 {
		t.Fatalf("want 2 numeric cpus, got %d", len(got))
	}
}

func mustEq(name, val string) *Matcher {
	m, _ := NewMatcher(MatchEqual, name, val)
	return m
}
