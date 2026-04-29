# pcap-go

A packet capture toolkit for macOS (also works on Linux). Ships as a single Go
binary that exposes both a CLI and an embedded Web UI.

## Features

- List capturable network interfaces.
- Live capture with BPF filters, snaplen, and promiscuous mode.
- CLI (`list`, `capture`, `serve`) and embedded React SPA.
- WebSocket live stream of decoded packets.
- IDL-first contract: `idl/pcap.proto` is the single source of truth between
  backend and frontend.
- Per-layer decoded detail (Ethernet, IPv4/IPv6, TCP, UDP, ICMP, DNS, HTTP,
  TLS) with a Wireshark-style detail pane.
- MAC → vendor lookup using an embedded OUI table (Apple, Intel, Cisco,
  Samsung, Espressif, Raspberry Pi, …).
- Peer list (IP + MAC peers with vendor, packets / bytes / sent / received,
  first/last seen).
- Visualization: transport / application protocol distribution, top peers,
  60-second packet-rate sparkline.
- Filter bar: free-text (host, vendor, SNI, summary), address, port,
  protocol toggle (TCP/UDP/ICMPv4/DNS/TLS/HTTP).

## Repository layout

```
pcap-go/
├── idl/              # .proto IDL — contract for REST + WebSocket
├── core/             # domain logic, capture engine, session manager
├── cli/              # cobra-based CLI (list / capture / serve)
├── web/              # net/http REST + WebSocket server, embeds SPA via go:embed
├── frontend/         # React + Vite SPA (TypeScript, layered)
│   └── src/
│       ├── domain/         # IDL types + domain rules
│       ├── application/    # use cases (ports + services)
│       ├── infrastructure/ # REST/WebSocket adapters (port implementations)
│       └── presentation/   # React components, pages, hooks
├── main.go           # binary entrypoint
├── go.mod
└── Makefile
```

The frontend layered architecture follows clean-architecture conventions:
inner layers (domain, application) know nothing about React or fetch; outer
layers (infrastructure, presentation) implement the ports declared by the
application layer.

## Build

### Default (simulator)

The default build uses an in-memory packet simulator and requires no system
libraries. Useful for development on machines without libpcap.

```sh
make all              # builds frontend + Go binary
./bin/pcap-go serve   # http://localhost:8080
```

### Real capture (macOS / Linux)

Real capture is gated behind the `pcap` build tag and requires libpcap
headers. macOS ships libpcap with the system SDK, so no extra install is
typically needed.

```sh
make frontend
make build-pcap
sudo ./bin/pcap-go list
sudo ./bin/pcap-go capture -i en0 -f "tcp port 443" -c 10
sudo ./bin/pcap-go serve --addr :8080
```

`sudo` (or BPF device permissions) is required to open the BPF devices on
macOS.

## Development

Run the Go API and Vite dev server side by side:

```sh
# terminal 1 — Go API on :8080
go run . serve --addr :8080

# terminal 2 — Vite dev server on :5173 (proxies /api → :8080)
cd frontend && npm run dev
```

Open <http://localhost:5173>.

## REST endpoints

See `idl/README.md` for the full contract. Quick reference:

| Method | Path                                  |
|--------|---------------------------------------|
| GET    | `/api/v1/interfaces`                  |
| GET    | `/api/v1/sessions`                    |
| POST   | `/api/v1/sessions`                    |
| DELETE | `/api/v1/sessions/{id}`               |
| GET    | `/api/v1/sessions/{id}/packets`       |
| GET    | `/api/v1/sessions/{id}/peers`         |
| GET    | `/api/v1/sessions/{id}/stats`         |
| GET    | `/api/v1/sessions/{id}/stream` (WS)   |
| GET    | `/api/v1/oui/{mac}`                   |

## IDL

`idl/pcap.proto` is the contract. JSON-on-the-wire field names use snake_case
(matching protojson defaults). The Go and TypeScript type definitions are
hand-maintained mirrors:

- Go: `core/models.go`
- TypeScript: `frontend/src/domain/idl.ts`

When you change the proto, update both mirrors in lockstep.
