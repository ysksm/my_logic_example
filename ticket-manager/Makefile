SHELL := /bin/bash

BIN      := bin/ticket-manager
ADDR     ?= :8080
DB       ?= ticket-manager.duckdb
FRONTEND := frontend
SERVER   := server

.PHONY: run build frontend backend dev clean help

help:
	@echo "Targets:"
	@echo "  make run     - frontend をビルドし、バイナリをビルドして起動 (1コマンド)"
	@echo "  make build   - frontend + backend をビルドして $(BIN) を生成"
	@echo "  make dev     - サーバ (:8080) と Vite dev (:5173) を並走"
	@echo "  make clean   - ビルド成果物を削除"

# 1コマンドで全部: フロント build → embed → Go ビルド → 起動
run: build
	./$(BIN) -addr $(ADDR) -db $(DB)

build: frontend backend

frontend:
	cd $(FRONTEND) && \
	  if [ ! -d node_modules ]; then npm install; fi && \
	  npm run build
	@touch $(SERVER)/internal/webui/static/.gitkeep

backend:
	mkdir -p bin
	cd $(SERVER) && go build -o ../$(BIN) ./cmd/server

# 開発モード: バックを :8080、Vite dev を :5173 で並走
# Ctrl-C で両方落ちる
dev:
	@echo ""
	@echo "==================================================="
	@echo "  Dev mode (Ctrl-C で両方停止)"
	@echo "  ▶ Open: http://localhost:5173  (Vite dev, HMR)"
	@echo "    API : http://localhost$(ADDR)  (バックエンド)"
	@echo "==================================================="
	@echo ""
	@trap 'kill 0' EXIT INT TERM; \
	  ( cd $(SERVER) && go run ./cmd/server -addr $(ADDR) -db $(DB) ) & \
	  ( cd $(FRONTEND) && \
	    if [ ! -d node_modules ]; then npm install; fi && \
	    npm run dev ) & \
	  wait

clean:
	rm -rf bin
	rm -rf $(FRONTEND)/dist
	find $(SERVER)/internal/webui/static -mindepth 1 ! -name .gitkeep -delete 2>/dev/null || true
