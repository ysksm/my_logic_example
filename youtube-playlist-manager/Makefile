# youtube-playlist-manager build entrypoints.
#
# Pure Go (no cgo) so every target cross-compiles from any host.

GO      ?= go
BIN     ?= bin/youtube-playlist-manager
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)

.PHONY: all build run dev test fmt vet dist clean

all: build

build:
	$(GO) build -trimpath -ldflags "$(LDFLAGS)" -o $(BIN) .

run: build
	./$(BIN)

dev:
	$(GO) run . -open=false

test:
	$(GO) test ./...

fmt:
	$(GO) fmt ./...

vet:
	$(GO) vet ./...

# Cross-compiled binaries for macOS / Windows / Linux into dist/.
dist:
	GOOS=darwin  GOARCH=arm64 $(GO) build -trimpath -ldflags "$(LDFLAGS)" -o dist/youtube-playlist-manager-darwin-arm64 .
	GOOS=darwin  GOARCH=amd64 $(GO) build -trimpath -ldflags "$(LDFLAGS)" -o dist/youtube-playlist-manager-darwin-amd64 .
	GOOS=windows GOARCH=amd64 $(GO) build -trimpath -ldflags "$(LDFLAGS)" -o dist/youtube-playlist-manager-windows-amd64.exe .
	GOOS=linux   GOARCH=amd64 $(GO) build -trimpath -ldflags "$(LDFLAGS)" -o dist/youtube-playlist-manager-linux-amd64 .

clean:
	rm -rf bin dist
