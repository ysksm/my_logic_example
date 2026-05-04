//go:build !wails
// +build !wails

// This stub keeps the package buildable with plain `go build ./...`.
// To produce the real desktop binary use the wails CLI:
//
//	go install github.com/wailsapp/wails/v2/cmd/wails@latest
//	cd cmd/wails && wails build
package main

import "fmt"

func main() {
	fmt.Println("perf-investigator-wails: build with `wails build` (see cmd/wails/main.go)")
}
