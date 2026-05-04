# desktop/

Wails v2 ラッパを置くための枠。今は空。

統合する場合は:

1. `go get github.com/wailsapp/wails/v2`
2. `desktop/app.go` に `wails.Run(...)` を実装し、`assetserver.Options{Handler: web.NewServer().Handler()}` を渡す
3. `cli/desktop.go` (`//go:build wails`) の `runWailsApp()` から呼び出す
4. `wails build -tags wails` または `go build -tags wails` でビルド

`web.NewServer().Handler()` は `http.Handler` をそのまま返すので、ブラウザ・サーバ版とまったく同じ UI/API を Wails 内で提供できる。
