// Package generate emits a runnable React+Vite project from an AppSpec.
package generate

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"html"
	"sort"
	"strings"

	"github.com/ysksm/my_logic_example/ddd-ui-designer/server/internal/ui"
)

// React generates the file tree (path → contents) of a runnable React app.
func React(spec ui.AppSpec) (map[string][]byte, error) {
	files := map[string][]byte{}

	files["package.json"] = []byte(packageJSON(spec))
	files["vite.config.ts"] = []byte(viteConfig)
	files["tsconfig.json"] = []byte(tsconfig)
	files["index.html"] = []byte(indexHTML(spec))
	files["README.md"] = []byte(readme(spec))
	files[".gitignore"] = []byte("node_modules/\ndist/\n*.log\n")
	files["src/main.tsx"] = []byte(mainTSX)
	files["src/styles.css"] = []byte(stylesCSS)
	files["src/runtime.tsx"] = []byte(runtimeTSX)
	files["src/db.ts"] = []byte(dbTS)

	app, err := appTSX(spec)
	if err != nil {
		return nil, err
	}
	files["src/App.tsx"] = app

	for _, s := range spec.Screens {
		body, err := screenTSX(s)
		if err != nil {
			return nil, err
		}
		files[fmt.Sprintf("src/screens/%s.tsx", s.ID)] = body
	}
	files["src/screens/index.ts"] = []byte(screensIndexTS(spec))

	return files, nil
}

// TarGz packages a generated file tree into a gzipped tar archive whose
// top-level directory is `<rootDir>/`.
func TarGz(files map[string][]byte, rootDir string) ([]byte, error) {
	if rootDir == "" {
		rootDir = "app"
	}
	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gw)

	// Sort for stable output.
	keys := make([]string, 0, len(files))
	for k := range files {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	for _, name := range keys {
		content := files[name]
		if err := tw.WriteHeader(&tar.Header{
			Name: rootDir + "/" + name,
			Mode: 0o644,
			Size: int64(len(content)),
		}); err != nil {
			return nil, err
		}
		if _, err := tw.Write(content); err != nil {
			return nil, err
		}
	}
	if err := tw.Close(); err != nil {
		return nil, err
	}
	if err := gw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// ---- generators ----------------------------------------------------------

func packageJSON(spec ui.AppSpec) string {
	name := slug(spec.DomainID)
	if name == "" {
		name = "ddd"
	}
	return fmt.Sprintf(`{
  "name": "%s-app",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.4.5",
    "vite": "^5.3.1"
  }
}
`, name)
}

func indexHTML(spec ui.AppSpec) string {
	title := spec.DomainName
	if title == "" {
		title = "Generated App"
	}
	return fmt.Sprintf(`<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>%s</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`, html.EscapeString(title))
}

func readme(spec ui.AppSpec) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# %s\n\n", spec.DomainName)
	fmt.Fprintln(&b, "ddd-ui-designer から生成された React + Vite アプリです。")
	fmt.Fprintln(&b)
	fmt.Fprintln(&b, "## 起動")
	fmt.Fprintln(&b)
	fmt.Fprintln(&b, "```sh")
	fmt.Fprintln(&b, "npm install")
	fmt.Fprintln(&b, "npm run dev")
	fmt.Fprintln(&b, "```")
	fmt.Fprintln(&b)
	fmt.Fprintln(&b, "ブラウザで <http://localhost:5173> を開きます。データはブラウザの `localStorage` に保存されます。")
	fmt.Fprintln(&b)
	fmt.Fprintln(&b, "## ビルド")
	fmt.Fprintln(&b)
	fmt.Fprintln(&b, "```sh")
	fmt.Fprintln(&b, "npm run build && npm run preview")
	fmt.Fprintln(&b, "```")
	fmt.Fprintln(&b)
	fmt.Fprintln(&b, "## Aggregate")
	fmt.Fprintln(&b)
	fmt.Fprintln(&b, "| 名称 | パターン | 採用理由 |")
	fmt.Fprintln(&b, "|------|----------|----------|")
	for _, p := range spec.Plans {
		fmt.Fprintf(&b, "| %s | %s | %s |\n", p.AggregateRef, p.Pattern, p.Reason)
	}
	fmt.Fprintln(&b)
	fmt.Fprintln(&b, "## 構成")
	fmt.Fprintln(&b)
	fmt.Fprintln(&b, "- `src/App.tsx` — ナビゲーション state-machine と画面遷移定義")
	fmt.Fprintln(&b, "- `src/runtime.tsx` — Component → JSX の汎用レンダラー")
	fmt.Fprintln(&b, "- `src/db.ts` — Aggregate 単位の localStorage CRUD")
	fmt.Fprintln(&b, "- `src/screens/<screenId>.tsx` — 各画面 (1ファイル = 1Screen)")
	fmt.Fprintln(&b)
	fmt.Fprintln(&b, "再生成すれば全ファイルが上書きされます。手書きの拡張は別ファイルに置いてください。")
	return b.String()
}

func appTSX(spec ui.AppSpec) ([]byte, error) {
	initial := ""
	if len(spec.NavRoots) > 0 {
		initial = spec.NavRoots[0]
	} else if len(spec.Screens) > 0 {
		initial = spec.Screens[0].ID
	}

	var b strings.Builder
	fmt.Fprintln(&b, `import { useState } from "react";`)
	fmt.Fprintln(&b, `import { screens } from "./screens";`)
	fmt.Fprintln(&b)

	fmt.Fprintln(&b, `type Transition = { from: string; to: string; event: string };`)
	fmt.Fprintln(&b)
	fmt.Fprintln(&b, `const transitions: Transition[] = [`)
	for _, t := range spec.Transitions {
		fmt.Fprintf(&b, "  { from: %q, to: %q, event: %q },\n", t.From, t.To, t.Event)
	}
	fmt.Fprintln(&b, `];`)
	fmt.Fprintln(&b)

	fmt.Fprintln(&b, `const nav: { id: string; label: string }[] = [`)
	for _, p := range spec.Plans {
		if len(p.ScreenIDs) > 0 {
			label := p.NavLabel
			if label == "" {
				label = p.AggregateRef
			}
			fmt.Fprintf(&b, "  { id: %q, label: %q },\n", p.ScreenIDs[0], label)
		}
	}
	fmt.Fprintln(&b, `];`)
	fmt.Fprintln(&b)

	fmt.Fprintln(&b, `export default function App() {`)
	fmt.Fprintf(&b, "  const [currentId, setCurrent] = useState<string>(%q);\n", initial)
	fmt.Fprintln(&b, `  const [ctx, setCtx] = useState<Record<string, any>>({});`)
	fmt.Fprintln(&b)
	fmt.Fprintln(&b, `  const navigate = (event: string, extra?: Record<string, any>) => {`)
	fmt.Fprintln(&b, `    const t = transitions.find((x) => x.from === currentId && x.event === event);`)
	fmt.Fprintln(&b, `    if (t) {`)
	fmt.Fprintln(&b, `      setCtx({ ...ctx, ...(extra ?? {}) });`)
	fmt.Fprintln(&b, `      setCurrent(t.to);`)
	fmt.Fprintln(&b, `    } else {`)
	fmt.Fprintln(&b, `      console.warn("no transition", currentId, event);`)
	fmt.Fprintln(&b, `    }`)
	fmt.Fprintln(&b, `  };`)
	fmt.Fprintln(&b)
	fmt.Fprintln(&b, `  const Screen = screens[currentId];`)
	fmt.Fprintln(&b, `  return (`)
	fmt.Fprintln(&b, `    <div className="app">`)
	fmt.Fprintln(&b, `      <nav className="topnav">`)
	fmt.Fprintf(&b, "        <strong>%s</strong>\n", html.EscapeString(spec.DomainName))
	fmt.Fprintln(&b, `        {nav.map((n) => (`)
	fmt.Fprintln(&b, `          <button key={n.id} onClick={() => { setCtx({}); setCurrent(n.id); }}>`)
	fmt.Fprintln(&b, `            {n.label}`)
	fmt.Fprintln(&b, `          </button>`)
	fmt.Fprintln(&b, `        ))}`)
	fmt.Fprintln(&b, `        <span style={{ flex: 1 }} />`)
	fmt.Fprintln(&b, `        <small style={{ opacity: 0.7 }}>screen: <code>{currentId}</code></small>`)
	fmt.Fprintln(&b, `      </nav>`)
	fmt.Fprintln(&b, `      <main>`)
	fmt.Fprintln(&b, `        {Screen ? (`)
	fmt.Fprintln(&b, `          <Screen ctx={ctx} navigate={navigate} />`)
	fmt.Fprintln(&b, `        ) : (`)
	fmt.Fprintln(&b, `          <div>Unknown screen: {currentId}</div>`)
	fmt.Fprintln(&b, `        )}`)
	fmt.Fprintln(&b, `      </main>`)
	fmt.Fprintln(&b, `    </div>`)
	fmt.Fprintln(&b, `  );`)
	fmt.Fprintln(&b, `}`)
	return []byte(b.String()), nil
}

func screenTSX(s ui.Screen) ([]byte, error) {
	body, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return nil, err
	}
	var b strings.Builder
	fmt.Fprintln(&b, `import { ScreenView, type Screen } from "../runtime";`)
	fmt.Fprintln(&b)
	fmt.Fprintf(&b, "const screen: Screen = %s;\n\n", body)
	fmt.Fprintf(&b, "export default function %s(props: any) {\n", pascal(s.ID))
	fmt.Fprintln(&b, `  return <ScreenView screen={screen} {...props} />;`)
	fmt.Fprintln(&b, `}`)
	return []byte(b.String()), nil
}

func screensIndexTS(spec ui.AppSpec) string {
	var b strings.Builder
	for _, s := range spec.Screens {
		fmt.Fprintf(&b, "import %s from \"./%s\";\n", pascal(s.ID), s.ID)
	}
	fmt.Fprintln(&b)
	fmt.Fprintln(&b, `export const screens: Record<string, any> = {`)
	for _, s := range spec.Screens {
		fmt.Fprintf(&b, "  %q: %s,\n", s.ID, pascal(s.ID))
	}
	fmt.Fprintln(&b, `};`)
	return b.String()
}

// ---- helpers ------------------------------------------------------------

func pascal(s string) string {
	if s == "" {
		return ""
	}
	parts := strings.Split(s, "_")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p == "" {
			continue
		}
		out = append(out, strings.ToUpper(p[:1])+p[1:])
	}
	return strings.Join(out, "")
}

// slug normalises a domain id to a safe npm-package-name fragment.
func slug(s string) string {
	s = strings.ToLower(s)
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '-' || r == '_':
			b.WriteRune('-')
		}
	}
	return strings.Trim(b.String(), "-")
}
