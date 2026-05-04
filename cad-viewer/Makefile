VERSION ?= dev
BINARY  := cad-viewer

# Frontend vendor library versions (pinned).
OCCT_IMPORT_JS_VERSION := 0.0.22
JSZIP_VERSION          := 3.10.1
THREE_VERSION          := 0.170.0

THREE_LOADERS := FBXLoader.js 3MFLoader.js ColladaLoader.js TDSLoader.js \
                 PLYLoader.js TGALoader.js

.PHONY: all build dev test desktop build-desktop vendor-js clean

all: build

# Re-download pinned frontend WASM/JS dependencies into web/static/vendor/.
# These are committed for offline-friendly demos; run this only when bumping
# versions.
vendor-js:
	mkdir -p web/static/vendor/occt web/static/vendor/jszip
	mkdir -p web/static/vendor/three/addons/loaders
	mkdir -p web/static/vendor/three/addons/curves
	mkdir -p web/static/vendor/three/addons/utils
	mkdir -p web/static/vendor/three/addons/libs
	curl -sL -o web/static/vendor/occt/occt-import-js.js \
		https://unpkg.com/occt-import-js@$(OCCT_IMPORT_JS_VERSION)/dist/occt-import-js.js
	curl -sL -o web/static/vendor/occt/occt-import-js.wasm \
		https://unpkg.com/occt-import-js@$(OCCT_IMPORT_JS_VERSION)/dist/occt-import-js.wasm
	curl -sL -o web/static/vendor/jszip/jszip.min.js \
		https://unpkg.com/jszip@$(JSZIP_VERSION)/dist/jszip.min.js
	curl -sL -o web/static/vendor/three/three.module.js \
		https://unpkg.com/three@$(THREE_VERSION)/build/three.module.js
	for f in $(THREE_LOADERS); do \
		curl -sL -o web/static/vendor/three/addons/loaders/$$f \
			https://unpkg.com/three@$(THREE_VERSION)/examples/jsm/loaders/$$f; \
	done
	curl -sL -o web/static/vendor/three/addons/curves/NURBSCurve.js \
		https://unpkg.com/three@$(THREE_VERSION)/examples/jsm/curves/NURBSCurve.js
	curl -sL -o web/static/vendor/three/addons/curves/NURBSUtils.js \
		https://unpkg.com/three@$(THREE_VERSION)/examples/jsm/curves/NURBSUtils.js
	curl -sL -o web/static/vendor/three/addons/utils/BufferGeometryUtils.js \
		https://unpkg.com/three@$(THREE_VERSION)/examples/jsm/utils/BufferGeometryUtils.js
	curl -sL -o web/static/vendor/three/addons/libs/fflate.module.js \
		https://unpkg.com/three@$(THREE_VERSION)/examples/jsm/libs/fflate.module.js

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
