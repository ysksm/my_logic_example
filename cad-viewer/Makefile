VERSION ?= dev
BINARY  := cad-viewer

# Frontend vendor library versions (pinned).
OCCT_IMPORT_JS_VERSION := 0.0.22

.PHONY: all build dev test desktop build-desktop vendor-js clean

all: build

# Re-download pinned frontend WASM/JS dependencies into web/static/vendor/.
# These are committed for offline-friendly demos; run this only when bumping
# versions.
vendor-js:
	mkdir -p web/static/vendor/occt
	curl -sL -o web/static/vendor/occt/occt-import-js.js \
		https://unpkg.com/occt-import-js@$(OCCT_IMPORT_JS_VERSION)/dist/occt-import-js.js
	curl -sL -o web/static/vendor/occt/occt-import-js.wasm \
		https://unpkg.com/occt-import-js@$(OCCT_IMPORT_JS_VERSION)/dist/occt-import-js.wasm

# Web-only build. No cgo, no Wails dependency surface.
build:
	CGO_ENABLED=0 go build -ldflags "-s -w -X main.version=$(VERSION)" -o $(BINARY) .

# Run the web server in dev mode.
dev:
	go run . serve --addr :8080 --open

# Run unit tests.
test:
	go test ./...

# Run the Wails desktop app in dev mode.
desktop:
	CGO_ENABLED=1 go run -tags dev . desktop

# Build the Wails desktop binary.
build-desktop:
	CGO_ENABLED=1 go build -tags production -ldflags "-s -w -X main.version=$(VERSION)" -o $(BINARY)-desktop .

clean:
	rm -f $(BINARY) $(BINARY)-desktop
