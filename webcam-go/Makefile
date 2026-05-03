# webcam-go build entrypoints.
#
# Default target builds with the in-memory synthetic camera (no ffmpeg
# required). Pass TAGS=ffmpeg to enable real capture via the system ffmpeg
# binary (AVFoundation on macOS, v4l2 on Linux).

GO   ?= go
TAGS ?=
BIN  ?= bin/webcam-go

.PHONY: all build build-ffmpeg run run-ffmpeg dev test fmt vet clean

all: build

# Default build: synthetic camera. Works anywhere.
build:
	$(GO) build -o $(BIN) .

# Real-camera build for macOS/Linux. Requires the `ffmpeg` binary in PATH at
# runtime; the build itself has no extra dependencies.
build-ffmpeg:
	$(GO) build -tags ffmpeg -o $(BIN) .

run: build
	./$(BIN) serve --addr :8080

run-ffmpeg: build-ffmpeg
	./$(BIN) serve --addr :8080

dev:
	$(GO) run . serve --addr :8080

test:
	$(GO) test ./...

fmt:
	$(GO) fmt ./...

vet:
	$(GO) vet ./...

clean:
	rm -rf bin
