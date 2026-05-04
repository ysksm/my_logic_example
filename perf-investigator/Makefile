# perf-investigator build helpers.
.PHONY: all all-bin cli server web wails clean test

BIN_DIR ?= bin

all: all-bin

# Single-binary build: web → embed under cmd/all/dist → go build.
all-bin: web
	rm -rf cmd/all/dist
	cp -r web/dist cmd/all/dist
	go build -o $(BIN_DIR)/pi-all ./cmd/all

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
	rm -rf $(BIN_DIR) web/dist cmd/wails/frontend/dist cmd/all/dist
