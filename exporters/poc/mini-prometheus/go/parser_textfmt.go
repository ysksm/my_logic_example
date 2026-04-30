package main

import (
	"bufio"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
)

// ParsedSample is one parsed line from the Prometheus text format.
type ParsedSample struct {
	Metric string
	Labels Labels
	Value  float64
	TS     int64 // 0 means "use scrape timestamp"
}

// ParseTextFormat parses Prometheus text exposition / OpenMetrics text format.
// It is intentionally permissive: HELP / TYPE / EOF lines are skipped and
// histogram/summary aggregate lines are returned as-is (we treat them as plain numbers).
func ParseTextFormat(r io.Reader) ([]ParsedSample, error) {
	out := make([]ParsedSample, 0, 256)
	br := bufio.NewReader(r)
	lineNo := 0
	for {
		line, err := br.ReadString('\n')
		if line == "" && err == io.EOF {
			break
		}
		lineNo++
		line = strings.TrimRight(line, "\r\n")
		if err != nil && err != io.EOF {
			return nil, err
		}
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "#") {
			if err == io.EOF {
				break
			}
			continue
		}
		s, perr := parseLine(line)
		if perr != nil {
			// Skip malformed lines but keep going; a single bad line shouldn't
			// drop the whole scrape.
			if err == io.EOF {
				break
			}
			continue
		}
		out = append(out, s)
		if err == io.EOF {
			break
		}
	}
	return out, nil
}

func parseLine(line string) (ParsedSample, error) {
	var s ParsedSample
	// metric name = [a-zA-Z_:][a-zA-Z0-9_:]*
	i := 0
	for i < len(line) && isNameChar(line[i], i == 0) {
		i++
	}
	if i == 0 {
		return s, fmt.Errorf("no metric name")
	}
	s.Metric = line[:i]

	// optional labels {…}
	if i < len(line) && line[i] == '{' {
		end := strings.IndexByte(line[i:], '}')
		if end < 0 {
			return s, fmt.Errorf("unterminated labels")
		}
		lbls, err := parseLabels(line[i+1 : i+end])
		if err != nil {
			return s, err
		}
		s.Labels = lbls
		i += end + 1
	}

	// skip whitespace
	for i < len(line) && (line[i] == ' ' || line[i] == '\t') {
		i++
	}
	if i >= len(line) {
		return s, fmt.Errorf("missing value")
	}

	// value [ timestamp_ms ]
	rest := line[i:]
	parts := strings.Fields(rest)
	if len(parts) == 0 {
		return s, fmt.Errorf("missing value")
	}
	v, err := strconv.ParseFloat(parts[0], 64)
	if err != nil {
		return s, fmt.Errorf("bad value %q: %w", parts[0], err)
	}
	s.Value = v
	if len(parts) >= 2 {
		ts, err := strconv.ParseInt(parts[1], 10, 64)
		if err != nil {
			return s, fmt.Errorf("bad timestamp %q: %w", parts[1], err)
		}
		s.TS = ts
	}
	return s, nil
}

func isNameChar(c byte, first bool) bool {
	if c == '_' || c == ':' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') {
		return true
	}
	if !first && c >= '0' && c <= '9' {
		return true
	}
	return false
}

// parseLabels parses a comma-separated list of name="value" pairs (already without {}).
func parseLabels(s string) (Labels, error) {
	out := make(Labels, 0, 4)
	i := 0
	for i < len(s) {
		// skip whitespace
		for i < len(s) && (s[i] == ' ' || s[i] == '\t' || s[i] == ',') {
			i++
		}
		if i >= len(s) {
			break
		}
		// name
		ns := i
		for i < len(s) && (s[i] == '_' || (s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z') || (i > ns && s[i] >= '0' && s[i] <= '9')) {
			i++
		}
		if ns == i {
			return nil, fmt.Errorf("bad label name at %d", i)
		}
		name := s[ns:i]
		// =
		for i < len(s) && (s[i] == ' ' || s[i] == '\t') {
			i++
		}
		if i >= len(s) || s[i] != '=' {
			return nil, fmt.Errorf("missing = after %s", name)
		}
		i++
		for i < len(s) && (s[i] == ' ' || s[i] == '\t') {
			i++
		}
		if i >= len(s) || s[i] != '"' {
			return nil, fmt.Errorf("missing \" for value of %s", name)
		}
		i++
		// quoted value (handles \\ \" \n)
		var b strings.Builder
		for i < len(s) && s[i] != '"' {
			c := s[i]
			if c == '\\' && i+1 < len(s) {
				switch s[i+1] {
				case 'n':
					b.WriteByte('\n')
				case '\\':
					b.WriteByte('\\')
				case '"':
					b.WriteByte('"')
				default:
					b.WriteByte(s[i+1])
				}
				i += 2
				continue
			}
			b.WriteByte(c)
			i++
		}
		if i >= len(s) {
			return nil, fmt.Errorf("unterminated value for %s", name)
		}
		i++ // closing "
		out = append(out, Label{Name: name, Value: b.String()})
	}
	sort.Sort(out)
	return out, nil
}
