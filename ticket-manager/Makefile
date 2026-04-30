SHELL := /bin/bash

BIN          := bin/ticket-manager
DESKTOP_BIN  := bin/ticket-manager-desktop
ADDR         ?= :8080
DB_DRIVER    ?= duckdb
DB           ?= ticket-manager.duckdb
FRONTEND     := frontend
SERVER       := server
VERSION      ?= 0.0.1

.PHONY: run build frontend backend desktop build-desktop dev clean help

help:
	@echo "Targets:"
	@echo "  make run            - frontend をビルドし、Web サーバとして起動 (1コマンド)"
	@echo "  make build          - frontend + Web バイナリをビルドして $(BIN) を生成"
	@echo "  make desktop        - frontend をビルドし、Wails デスクトップアプリを開発実行"
	@echo "  make build-desktop  - 本番用 Wails バイナリ ($(DESKTOP_BIN)) を生成"
	@echo "  make dev            - Web サーバ (:8080) と Vite dev (:5173) を並走"
	@echo "  make clean          - ビルド成果物を削除"

# 1コマンドで全部: フロント build → embed → Go ビルド → 起動
run: build
	./$(BIN) -addr $(ADDR) -db-driver $(DB_DRIVER) -db $(DB)

build: frontend backend

frontend:
	cd $(FRONTEND) && \
	  if [ ! -d node_modules ]; then npm install; fi && \
	  npm run build
	@touch $(SERVER)/internal/webui/static/.gitkeep

backend:
	mkdir -p bin
	cd $(SERVER) && go build -o ../$(BIN) ./cmd/server

# Wails デスクトップ: 開発実行 (フロントを embed → Wails ウィンドウ起動)
# DB はユーザーコンフィグディレクトリの DuckDB がデフォルト。
# 一時 DB を使いたい場合は: `DB_DSN=/tmp/foo.duckdb make desktop`
desktop: frontend
	cd $(SERVER) && CGO_ENABLED=1 go run -tags dev ./cmd/desktop

# Wails デスクトップ: 本番バイナリ ($(DESKTOP_BIN))
build-desktop: frontend
	mkdir -p bin
	cd $(SERVER) && CGO_ENABLED=1 go build -tags production \
		-ldflags "-s -w -X main.version=$(VERSION)" \
		-o ../$(DESKTOP_BIN) ./cmd/desktop

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
	  ( cd $(SERVER) && go run ./cmd/server -addr $(ADDR) -db-driver $(DB_DRIVER) -db $(DB) ) & \
	  ( cd $(FRONTEND) && \
	    if [ ! -d node_modules ]; then npm install; fi && \
	    npm run dev ) & \
	  wait

clean:
	rm -rf bin build/bin
	rm -rf $(FRONTEND)/dist
	find $(SERVER)/internal/webui/static -mindepth 1 ! -name .gitkeep -delete 2>/dev/null || true
