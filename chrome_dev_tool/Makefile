.PHONY: all build web go-bin dev clean tidy verify

BIN := bin/cdt

all: build

build: web go-bin

web:
	cd web/frontend && npm install && npm run build
	# vite's emptyOutDir wipes dist/.keep — restore it so go:embed still finds
	# at least one file when go build runs against an unbuilt checkout.
	touch web/frontend/dist/.keep

go-bin:
	mkdir -p bin
	go build -o $(BIN) .

# Run the Go server and Vite dev server side-by-side.
# Use two terminals or a tool like `make -j2 dev` if your shell tolerates it.
dev:
	@echo "  terminal 1:  cd web/frontend && npm install && npm run dev"
	@echo "  terminal 2:  go run . serve --no-open"

clean:
	rm -rf bin web/frontend/dist/* web/frontend/node_modules

tidy:
	go mod tidy

verify:
	go build ./...
	go build -tags wails ./...
	@echo "checking that no chrome devtools wrappers leaked into the dependency graph..."
	@! go list -m all | grep -E '(go-rod/rod|chromedp/chromedp|chromedp/cdproto)' || (echo "FAIL: forbidden dependency"; exit 1)
	@echo "ok"
