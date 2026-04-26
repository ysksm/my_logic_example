package main

import (
	"strings"
	"testing"
)

func TestParseTextFormat(t *testing.T) {
	in := `# HELP cpu_usage CPU usage
# TYPE cpu_usage gauge
cpu_usage{cpu="0"} 0.13
cpu_usage{cpu="1"} 0.27 1700000000000
mem_used_bytes 1.234e9
# EOF
`
	got, err := ParseTextFormat(strings.NewReader(in))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("want 3 samples, got %d", len(got))
	}
	if got[0].Metric != "cpu_usage" || got[0].Labels.Get("cpu") != "0" || got[0].Value != 0.13 {
		t.Errorf("first sample wrong: %+v", got[0])
	}
	if got[1].TS != 1700000000000 {
		t.Errorf("timestamp not parsed: %+v", got[1])
	}
	if got[2].Metric != "mem_used_bytes" || got[2].Value != 1.234e9 {
		t.Errorf("scientific notation not parsed: %+v", got[2])
	}
}

func TestParseLabelsEscape(t *testing.T) {
	lbls, err := parseLabels(`a="x",b="y\"z",c="w\\v"`)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if lbls.Get("a") != "x" || lbls.Get("b") != `y"z` || lbls.Get("c") != `w\v` {
		t.Errorf("escapes wrong: %+v", lbls)
	}
}
