# perf-investigator build helpers.
.PHONY: all cli server web wails clean test

BIN_DIR ?= bin

all: cli server web

cli:
	go build -o $(BIN_DIR)/pi-cli ./cmd/cli

server:
	go build -o $(BIN_DIR)/pi-server ./cmd/server

web:
	cd web && npm install && npm run build

wails:
	@echo "Run 'cd cmd/wails && wails build' (requires the wails CLI)"

test:
	go test ./...

clean:
	rm -rf $(BIN_DIR) web/dist cmd/wails/frontend/dist
