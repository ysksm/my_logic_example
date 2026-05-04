VERSION ?= dev
BINARY  := cad-viewer

.PHONY: all build dev test desktop build-desktop clean

all: build

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
