# IDL

`webcam.proto` is the **single source of truth** for backend ⇄ frontend
communication. It is **not** processed by `protoc` — instead, hand-maintained
mirrors live in:

- Go:         `core/models.go`
- TypeScript: (none yet — the embedded SPA is vanilla JS)

When you change `webcam.proto`, update every mirror in the same commit.

## Wire formats

- **REST**: JSON, snake_case (matches protojson defaults).
- **MJPEG**: `multipart/x-mixed-replace; boundary=frame` over HTTP.
- **WebSocket**:
  - Binary frames carry raw JPEG bytes (no envelope, no base64).
  - Text frames carry JSON-encoded `StreamEnvelope` for session / error events.
