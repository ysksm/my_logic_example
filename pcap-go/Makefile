# pcap-go build entrypoints.
#
# Default target builds with the in-memory simulator (no libpcap required).
# Pass TAGS=pcap to link against libpcap for real capture on macOS/Linux.

GO         ?= go
TAGS       ?=
BIN        ?= bin/pcap-go
NPM        ?= npm
FRONTEND   := frontend

.PHONY: all build build-pcap frontend frontend-deps run dev test clean

all: frontend build

frontend-deps:
	cd $(FRONTEND) && $(NPM) install

frontend:
	cd $(FRONTEND) && $(NPM) run build

# Default build: simulator. Works anywhere.
build:
	$(GO) build -o $(BIN) .

# Real-libpcap build for macOS/Linux. Requires libpcap headers
# (`brew install libpcap` on macOS is usually unnecessary; the SDK ships one).
build-pcap:
	$(GO) build -tags pcap -o $(BIN) .

run: build
	./$(BIN) serve --addr :8080

# Concurrent dev: run Go API on :8080 and Vite dev server on :5173.
# Open http://localhost:5173 in your browser.
dev:
	@echo "Run two terminals:"
	@echo "  1) $(GO) run . serve --addr :8080"
	@echo "  2) cd $(FRONTEND) && $(NPM) run dev"

test:
	$(GO) test ./...

clean:
	rm -rf bin web/static/assets web/static/index.html
	cd $(FRONTEND) && rm -rf dist
