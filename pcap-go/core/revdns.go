// Reverse-DNS lookups, on-demand. Cached in-process to avoid hammering the
// resolver when the user clicks the same row twice.

package core

import (
	"context"
	"errors"
	"net"
	"strings"
	"sync"
	"time"
)

type revDNSEntry struct {
	names []string
	err   string
	at    time.Time
}

type revDNSCache struct {
	mu    sync.RWMutex
	store map[string]revDNSEntry
}

const revDNSTTL = 5 * time.Minute

var revDNS = &revDNSCache{store: make(map[string]revDNSEntry)}

// ReverseDNS resolves PTR records for ip with a 3-second timeout. Results are
// cached for revDNSTTL.
func ReverseDNS(ip string) ([]string, error) {
	if net.ParseIP(ip) == nil {
		return nil, errors.New("invalid ip")
	}
	revDNS.mu.RLock()
	if e, ok := revDNS.store[ip]; ok && time.Since(e.at) < revDNSTTL {
		revDNS.mu.RUnlock()
		if e.err != "" {
			return nil, errors.New(e.err)
		}
		return e.names, nil
	}
	revDNS.mu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	resolver := net.DefaultResolver
	names, err := resolver.LookupAddr(ctx, ip)
	// Strip trailing dots that Go usually returns.
	for i, n := range names {
		names[i] = strings.TrimSuffix(n, ".")
	}

	entry := revDNSEntry{names: names, at: time.Now()}
	if err != nil {
		entry.err = err.Error()
	}
	revDNS.mu.Lock()
	revDNS.store[ip] = entry
	revDNS.mu.Unlock()
	return names, err
}
