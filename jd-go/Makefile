VERSION ?= dev
BINARY  := jd-go

# Vendor library versions
HTMX_VERSION     := 2.0.4
HTMX_SSE_VERSION := 2.2.2
ALPINE_VERSION   := 3.14.8
ECHARTS_VERSION  := 5.6.0

.PHONY: all build vendor-js css dev clean test

all: build

# Download frontend vendor libraries (pinned versions)
vendor-js:
	mkdir -p web/static/vendor
	curl -sL -o web/static/vendor/htmx.min.js "https://unpkg.com/htmx.org@$(HTMX_VERSION)/dist/htmx.min.js"
	curl -sL -o web/static/vendor/htmx-sse.js "https://unpkg.com/htmx-ext-sse@$(HTMX_SSE_VERSION)/sse.js"
	curl -sL -o web/static/vendor/alpine.min.js "https://unpkg.com/alpinejs@$(ALPINE_VERSION)/dist/cdn.min.js"
	curl -sL -o web/static/vendor/echarts.min.js "https://unpkg.com/echarts@$(ECHARTS_VERSION)/dist/echarts.min.js"

# Build Tailwind CSS (optional - fallback CSS is included)
css:
	npx @tailwindcss/cli -i web/static/input.css -o web/static/style.css --minify

# Single binary build
build: vendor-js
	CGO_ENABLED=1 go build -ldflags "-s -w -X main.version=$(VERSION)" -o $(BINARY) .

# Development mode
dev:
	CGO_ENABLED=1 go run . serve --port 8080 --open

# Run tests
test:
	CGO_ENABLED=1 go test ./...

# Clean build artifacts
clean:
	rm -f $(BINARY)
	rm -rf web/static/vendor/
