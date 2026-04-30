# IDL

`pcap.proto` is the contract between backend and frontend.

The wire format is JSON (snake_case keys, matching protojson defaults). We do
not run `protoc` in this project; instead we hand-maintain the matching types
in two places and treat the proto file as the source of truth:

- Go: `core/models.go`
- TypeScript: `frontend/src/domain/idl.ts`

Whenever you change `pcap.proto`, update both files in lockstep.

## REST endpoints

| Method | Path                                  | Request                     | Response                  |
|--------|---------------------------------------|-----------------------------|---------------------------|
| GET    | `/api/v1/interfaces`                  | -                           | `ListInterfacesResponse`  |
| GET    | `/api/v1/sessions`                    | -                           | `ListSessionsResponse`    |
| POST   | `/api/v1/sessions`                    | `StartCaptureRequest`       | `StartCaptureResponse`    |
| DELETE | `/api/v1/sessions/{id}`               | -                           | `StopCaptureResponse`     |
| GET    | `/api/v1/sessions/{id}/packets`       | query: `after_seq`, `limit` | `ListPacketsResponse`     |
| GET    | `/api/v1/sessions/{id}/peers`         | query: `kind`               | `ListPeersResponse`       |
| GET    | `/api/v1/sessions/{id}/stats`         | query: `top`                | `StatsResponse`           |
| GET    | `/api/v1/oui/{mac}`                   | -                           | `OUIResponse`             |
| GET    | `/api/v1/ipranges/status`             | -                           | `IPRangesStatus`          |
| POST   | `/api/v1/ipranges/update`             | -                           | `IPRangesUpdateResponse`  |
| GET    | `/api/v1/dns/reverse/{ip}`            | -                           | `ReverseDNSResponse`      |

## WebSocket

`GET /api/v1/sessions/{id}/stream` — server-pushed `StreamEnvelope` JSON
messages, one per frame.
