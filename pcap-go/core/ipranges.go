// IP range → owner lookup. Curated, locally stored, user-overridable.
//
// Lookup table:
//   - Embedded defaults (ipranges_data.go): a small curated list per provider.
//   - User-overridable file at ipRangesUserPath() (default: ~/.pcap-go/ipranges.json).
//     If the file exists, its entries are merged on top of the embedded ones.
//
// Update flow (UpdateIPRanges):
//   - Fetch official feeds for AWS, GCP, Azure (Service Tags), Cloudflare,
//     GitHub, Fastly when reachable.
//   - Merge with the embedded curated entries (so providers without a feed,
//     such as Apple/Google/Akamai, remain present).
//   - Persist to ipRangesUserPath() and reload into the in-memory table.

package core

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// IPRangeEntry is one CIDR row in the local table.
type IPRangeEntry struct {
	CIDR     string `json:"cidr"`
	Owner    string `json:"owner"`            // free-form, e.g. "AWS:EC2", "GCP", "Cloudflare"
	Provider string `json:"provider"`         // top-level grouping, e.g. "AWS"
	Region   string `json:"region,omitempty"` // optional
}

type ipRangeMatcher struct {
	mu      sync.RWMutex
	entries []IPRangeEntry
	// parallel parsed prefixes for fast Contains checks; same indexing as entries.
	prefixes []*net.IPNet
	// providers source breakdown for status reporting.
	bySource map[string]map[string]int // source -> provider -> count
	loaded   time.Time                 // when the table was loaded into memory
	// userFilePresent + userFileUpdated capture user file metadata for status.
	userFilePresent bool
	userFileUpdated time.Time
}

var ipranges = func() *ipRangeMatcher {
	m := &ipRangeMatcher{}
	m.reload()
	return m
}()

// LookupIPOwner returns the matched owner string for an IP, or "".
// Private/loopback/link-local addresses are skipped (returns "").
func LookupIPOwner(addr string) string {
	if addr == "" {
		return ""
	}
	ip := net.ParseIP(addr)
	if ip == nil {
		return ""
	}
	if !isPublicIP(ip) {
		return ""
	}
	ipranges.mu.RLock()
	defer ipranges.mu.RUnlock()
	// Linear scan is fine for a few thousand entries; longest-prefix is not
	// required here because curated lists do not overlap meaningfully.
	for i, p := range ipranges.prefixes {
		if p == nil {
			continue
		}
		if p.Contains(ip) {
			return ipranges.entries[i].Owner
		}
	}
	return ""
}

// IPRangesStatusSnapshot returns a status snapshot of the active table.
func IPRangesStatusSnapshot() IPRangesStatus {
	ipranges.mu.RLock()
	defer ipranges.mu.RUnlock()
	st := IPRangesStatus{
		TotalEntries:    uint32(len(ipranges.entries)),
		UserFilePath:    ipRangesUserPath(),
		UserFilePresent: ipranges.userFilePresent,
	}
	if !ipranges.userFileUpdated.IsZero() {
		st.UserFileUpdated = ipranges.userFileUpdated.UTC().Format(time.RFC3339)
	}
	// Aggregate (provider, source) counts.
	type key struct{ source, provider string }
	totals := map[key]int{}
	for src, providers := range ipranges.bySource {
		for prov, n := range providers {
			totals[key{src, prov}] = n
		}
	}
	out := make([]IPRangesProvider, 0, len(totals))
	for k, n := range totals {
		out = append(out, IPRangesProvider{
			Name:    k.provider,
			Entries: uint32(n),
			Source:  k.source,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Name != out[j].Name {
			return out[i].Name < out[j].Name
		}
		return out[i].Source < out[j].Source
	})
	st.Providers = out
	return st
}

// UpdateIPRanges fetches official feeds, merges with embedded curated data,
// writes the merged set to the user-overridable file, then reloads. Per-provider
// errors are reported but do not abort the whole update.
func UpdateIPRanges() (IPRangesUpdateResponse, error) {
	// Start from a copy of the embedded curated entries (for providers without
	// a fetchable feed: Apple/Google/Akamai etc.).
	merged := append([]IPRangeEntry{}, embeddedIPRanges...)
	var errs []string

	fetchers := []struct {
		name string
		fn   func() ([]IPRangeEntry, error)
	}{
		{"AWS", fetchAWSRanges},
		{"GCP", fetchGCPRanges},
		{"Cloudflare", fetchCloudflareRanges},
		{"GitHub", fetchGitHubRanges},
		{"Fastly", fetchFastlyRanges},
		{"Azure", fetchAzureRanges},
	}
	for _, f := range fetchers {
		es, err := f.fn()
		if err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", f.name, err))
			continue
		}
		merged = mergeReplaceProvider(merged, f.name, es)
	}

	if err := writeIPRangesFile(merged); err != nil {
		return IPRangesUpdateResponse{}, fmt.Errorf("write user file: %w", err)
	}
	ipranges.reload()

	return IPRangesUpdateResponse{
		Status:       IPRangesStatusSnapshot(),
		Errors:       errs,
		FetchedTotal: uint32(len(merged)),
	}, nil
}

// ----- Internals -----

func (m *ipRangeMatcher) reload() {
	all := append([]IPRangeEntry{}, embeddedIPRanges...)
	bySource := map[string]map[string]int{
		"embedded": providerCounts(embeddedIPRanges),
	}

	userPath := ipRangesUserPath()
	var userFilePresent bool
	var userMTime time.Time
	if data, info, err := readIPRangesFile(userPath); err == nil {
		userFilePresent = true
		userMTime = info.ModTime()
		var fromUser []IPRangeEntry
		if err := json.Unmarshal(data, &fromUser); err == nil {
			// User file replaces all providers it mentions.
			seen := map[string]bool{}
			for _, e := range fromUser {
				if e.Provider != "" {
					seen[e.Provider] = true
				}
			}
			// Drop embedded entries for providers present in user file.
			filtered := all[:0]
			for _, e := range all {
				if seen[e.Provider] {
					continue
				}
				filtered = append(filtered, e)
			}
			all = append(filtered, fromUser...)
			bySource["user-file"] = providerCounts(fromUser)
			// Reduce embedded counts for replaced providers.
			for prov := range seen {
				delete(bySource["embedded"], prov)
			}
		}
	}

	prefixes := make([]*net.IPNet, len(all))
	for i, e := range all {
		_, p, err := net.ParseCIDR(e.CIDR)
		if err != nil {
			continue
		}
		prefixes[i] = p
	}

	m.mu.Lock()
	m.entries = all
	m.prefixes = prefixes
	m.bySource = bySource
	m.loaded = time.Now().UTC()
	m.userFilePresent = userFilePresent
	m.userFileUpdated = userMTime
	m.mu.Unlock()
}

func providerCounts(entries []IPRangeEntry) map[string]int {
	out := map[string]int{}
	for _, e := range entries {
		name := e.Provider
		if name == "" {
			name = "unknown"
		}
		out[name]++
	}
	return out
}

func mergeReplaceProvider(base []IPRangeEntry, provider string, fresh []IPRangeEntry) []IPRangeEntry {
	out := base[:0:0]
	for _, e := range base {
		if e.Provider == provider {
			continue
		}
		out = append(out, e)
	}
	return append(out, fresh...)
}

func ipRangesUserPath() string {
	if v := os.Getenv("PCAP_GO_IPRANGES"); v != "" {
		return v
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return filepath.Join(".pcap-go", "ipranges.json")
	}
	return filepath.Join(home, ".pcap-go", "ipranges.json")
}

func readIPRangesFile(path string) ([]byte, os.FileInfo, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, nil, err
	}
	if info.IsDir() {
		return nil, nil, errors.New("ipranges path is a directory")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, err
	}
	return data, info, nil
}

func writeIPRangesFile(entries []IPRangeEntry) error {
	path := ipRangesUserPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func isPublicIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsMulticast() || ip.IsUnspecified() || ip.IsPrivate() {
		return false
	}
	return true
}

// ---- Fetchers ----

var ipRangesFetchClient = &http.Client{Timeout: 15 * time.Second}

func httpGetJSON(url string, into any) error {
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "pcap-go/ipranges-updater")
	res, err := ipRangesFetchClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode/100 != 2 {
		return fmt.Errorf("status %d", res.StatusCode)
	}
	return json.NewDecoder(res.Body).Decode(into)
}

func httpGetBody(url string) ([]byte, error) {
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "pcap-go/ipranges-updater")
	res, err := ipRangesFetchClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode/100 != 2 {
		return nil, fmt.Errorf("status %d", res.StatusCode)
	}
	return io.ReadAll(res.Body)
}

// AWS — https://ip-ranges.amazonaws.com/ip-ranges.json
func fetchAWSRanges() ([]IPRangeEntry, error) {
	type prefix struct {
		IPPrefix   string `json:"ip_prefix"`
		Region     string `json:"region"`
		Service    string `json:"service"`
	}
	type ipv6Prefix struct {
		IPv6Prefix string `json:"ipv6_prefix"`
		Region     string `json:"region"`
		Service    string `json:"service"`
	}
	type doc struct {
		Prefixes     []prefix     `json:"prefixes"`
		IPv6Prefixes []ipv6Prefix `json:"ipv6_prefixes"`
	}
	var d doc
	if err := httpGetJSON("https://ip-ranges.amazonaws.com/ip-ranges.json", &d); err != nil {
		return nil, err
	}
	out := make([]IPRangeEntry, 0, len(d.Prefixes)+len(d.IPv6Prefixes))
	for _, p := range d.Prefixes {
		out = append(out, IPRangeEntry{
			CIDR:     p.IPPrefix,
			Owner:    "AWS:" + p.Service,
			Provider: "AWS",
			Region:   p.Region,
		})
	}
	for _, p := range d.IPv6Prefixes {
		out = append(out, IPRangeEntry{
			CIDR:     p.IPv6Prefix,
			Owner:    "AWS:" + p.Service,
			Provider: "AWS",
			Region:   p.Region,
		})
	}
	return out, nil
}

// GCP — https://www.gstatic.com/ipranges/cloud.json
func fetchGCPRanges() ([]IPRangeEntry, error) {
	type prefix struct {
		IPv4Prefix string `json:"ipv4Prefix"`
		IPv6Prefix string `json:"ipv6Prefix"`
		Service    string `json:"service"`
		Scope      string `json:"scope"`
	}
	type doc struct {
		Prefixes []prefix `json:"prefixes"`
	}
	var d doc
	if err := httpGetJSON("https://www.gstatic.com/ipranges/cloud.json", &d); err != nil {
		return nil, err
	}
	out := make([]IPRangeEntry, 0, len(d.Prefixes))
	for _, p := range d.Prefixes {
		owner := "GCP"
		if p.Service != "" {
			owner = "GCP:" + p.Service
		}
		cidr := p.IPv4Prefix
		if cidr == "" {
			cidr = p.IPv6Prefix
		}
		if cidr == "" {
			continue
		}
		out = append(out, IPRangeEntry{
			CIDR:     cidr,
			Owner:    owner,
			Provider: "GCP",
			Region:   p.Scope,
		})
	}
	return out, nil
}

// Cloudflare — https://www.cloudflare.com/ips-v4 and ips-v6 (newline-separated)
func fetchCloudflareRanges() ([]IPRangeEntry, error) {
	urls := []string{
		"https://www.cloudflare.com/ips-v4",
		"https://www.cloudflare.com/ips-v6",
	}
	var out []IPRangeEntry
	for _, u := range urls {
		body, err := httpGetBody(u)
		if err != nil {
			return nil, err
		}
		for _, line := range strings.Split(string(body), "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			out = append(out, IPRangeEntry{
				CIDR:     line,
				Owner:    "Cloudflare",
				Provider: "Cloudflare",
			})
		}
	}
	return out, nil
}

// GitHub — https://api.github.com/meta
func fetchGitHubRanges() ([]IPRangeEntry, error) {
	type doc struct {
		Hooks       []string `json:"hooks"`
		Web         []string `json:"web"`
		API         []string `json:"api"`
		Git         []string `json:"git"`
		Pages       []string `json:"pages"`
		Importer    []string `json:"importer"`
		Actions     []string `json:"actions"`
		Dependabot  []string `json:"dependabot"`
	}
	var d doc
	if err := httpGetJSON("https://api.github.com/meta", &d); err != nil {
		return nil, err
	}
	add := func(out []IPRangeEntry, list []string, owner string) []IPRangeEntry {
		for _, c := range list {
			out = append(out, IPRangeEntry{
				CIDR:     c,
				Owner:    owner,
				Provider: "GitHub",
			})
		}
		return out
	}
	var out []IPRangeEntry
	out = add(out, d.Web, "GitHub:web")
	out = add(out, d.API, "GitHub:api")
	out = add(out, d.Git, "GitHub:git")
	out = add(out, d.Pages, "GitHub:pages")
	out = add(out, d.Hooks, "GitHub:hooks")
	out = add(out, d.Importer, "GitHub:importer")
	out = add(out, d.Actions, "GitHub:actions")
	out = add(out, d.Dependabot, "GitHub:dependabot")
	return out, nil
}

// Fastly — https://api.fastly.com/public-ip-list
func fetchFastlyRanges() ([]IPRangeEntry, error) {
	type doc struct {
		Addresses     []string `json:"addresses"`
		IPv6Addresses []string `json:"ipv6_addresses"`
	}
	var d doc
	if err := httpGetJSON("https://api.fastly.com/public-ip-list", &d); err != nil {
		return nil, err
	}
	out := make([]IPRangeEntry, 0, len(d.Addresses)+len(d.IPv6Addresses))
	for _, c := range d.Addresses {
		out = append(out, IPRangeEntry{CIDR: c, Owner: "Fastly", Provider: "Fastly"})
	}
	for _, c := range d.IPv6Addresses {
		out = append(out, IPRangeEntry{CIDR: c, Owner: "Fastly", Provider: "Fastly"})
	}
	return out, nil
}

// Azure — Microsoft does not expose a stable, no-auth direct download for the
// Service Tags JSON. Skip with a soft "no automatic feed" error so the user can
// still drop a curated file at ~/.pcap-go/ipranges.json or rely on the embedded
// entries.
func fetchAzureRanges() ([]IPRangeEntry, error) {
	return nil, errors.New("Azure has no stable no-auth feed; skip (use embedded or user file)")
}
