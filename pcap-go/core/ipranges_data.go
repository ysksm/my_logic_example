package core

// embeddedIPRanges is a curated, conservative set of well-known public IP
// ranges. It is shipped with the binary so the feature works without any
// external fetch. It is intentionally small — the live feed (UpdateIPRanges)
// supplies the exhaustive sets for AWS / GCP / Cloudflare / GitHub / Fastly.
//
// Providers without a stable public feed (Apple, Google, Akamai) get curated
// /16-to-/8 hints here. These are coarse and best-effort; the user file is
// authoritative when present.
var embeddedIPRanges = []IPRangeEntry{
	// --- Cloudflare (a few well-known prefixes) ---
	{CIDR: "1.1.1.0/24", Owner: "Cloudflare", Provider: "Cloudflare"},
	{CIDR: "1.0.0.0/24", Owner: "Cloudflare", Provider: "Cloudflare"},
	{CIDR: "104.16.0.0/13", Owner: "Cloudflare", Provider: "Cloudflare"},
	{CIDR: "104.24.0.0/14", Owner: "Cloudflare", Provider: "Cloudflare"},
	{CIDR: "172.64.0.0/13", Owner: "Cloudflare", Provider: "Cloudflare"},
	{CIDR: "162.158.0.0/15", Owner: "Cloudflare", Provider: "Cloudflare"},

	// --- Google (broad allocations; not exhaustive) ---
	{CIDR: "8.8.8.0/24", Owner: "Google:DNS", Provider: "Google"},
	{CIDR: "8.8.4.0/24", Owner: "Google:DNS", Provider: "Google"},
	{CIDR: "142.250.0.0/15", Owner: "Google", Provider: "Google"},
	{CIDR: "142.251.0.0/16", Owner: "Google", Provider: "Google"},
	{CIDR: "172.217.0.0/16", Owner: "Google", Provider: "Google"},
	{CIDR: "216.58.192.0/19", Owner: "Google", Provider: "Google"},
	{CIDR: "74.125.0.0/16", Owner: "Google", Provider: "Google"},

	// --- Apple ---
	{CIDR: "17.0.0.0/8", Owner: "Apple", Provider: "Apple"},

	// --- Akamai (small selection of historic /16 allocations) ---
	{CIDR: "23.32.0.0/11", Owner: "Akamai", Provider: "Akamai"},
	{CIDR: "23.64.0.0/14", Owner: "Akamai", Provider: "Akamai"},
	{CIDR: "23.192.0.0/11", Owner: "Akamai", Provider: "Akamai"},
	{CIDR: "104.64.0.0/10", Owner: "Akamai", Provider: "Akamai"},
	{CIDR: "184.24.0.0/13", Owner: "Akamai", Provider: "Akamai"},

	// --- AWS (very small fallback; live feed supplies the full set) ---
	{CIDR: "52.0.0.0/11", Owner: "AWS", Provider: "AWS"},
	{CIDR: "54.144.0.0/12", Owner: "AWS", Provider: "AWS"},
	{CIDR: "3.0.0.0/9", Owner: "AWS", Provider: "AWS"},
	{CIDR: "13.32.0.0/15", Owner: "AWS:CloudFront", Provider: "AWS"},

	// --- Azure (a few well-known global prefixes; live feed unavailable) ---
	{CIDR: "13.64.0.0/11", Owner: "Azure", Provider: "Azure"},
	{CIDR: "20.0.0.0/8", Owner: "Azure", Provider: "Azure"},
	{CIDR: "40.64.0.0/10", Owner: "Azure", Provider: "Azure"},
	{CIDR: "52.96.0.0/12", Owner: "Azure", Provider: "Azure"},

	// --- GCP (small fallback) ---
	{CIDR: "34.0.0.0/9", Owner: "GCP", Provider: "GCP"},
	{CIDR: "35.184.0.0/13", Owner: "GCP", Provider: "GCP"},
	{CIDR: "35.192.0.0/14", Owner: "GCP", Provider: "GCP"},

	// --- GitHub (live feed supplies authoritative set) ---
	{CIDR: "140.82.112.0/20", Owner: "GitHub", Provider: "GitHub"},
	{CIDR: "143.55.64.0/20", Owner: "GitHub", Provider: "GitHub"},
	{CIDR: "192.30.252.0/22", Owner: "GitHub", Provider: "GitHub"},

	// --- Fastly ---
	{CIDR: "151.101.0.0/16", Owner: "Fastly", Provider: "Fastly"},
	{CIDR: "199.232.0.0/16", Owner: "Fastly", Provider: "Fastly"},
}
