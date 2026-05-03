# コード生成と起動

ddd-ui-designer の最大の特徴は、`AppSpec` (IR2) から **動作可能な
React + Vite プロジェクト**を生成し、サーバ側で `npm install` & `vite dev`
まで自動実行できる点です。

## 全体フロー

```
DomainModel (IR1)
   │
   │  rules.Derive
   ▼
AppSpec (IR2)
   │
   │  generate.React        ← in-memory
   ▼
files: map[path][]byte
   │
   ├─ generate.TarGz ──────▶ tar.gz (📦 ボタンでダウンロード)
   │
   └─ runner.Manager.Launch
        ├─ writeFiles  → <runs-dir>/<id>-app/
        ├─ npm install (キャッシュ付き)
        ├─ vite dev (空きポート)
        └─ ポート LISTEN 検知 → ready
                                   ↓
                        🚀 RunPanel に URL 表示
```

## 生成されるプロジェクト構成

```
<id>-app/
├── package.json          (生成: 名前は <id>-app)
├── vite.config.ts        (静的)
├── tsconfig.json         (静的)
├── index.html            (生成: <title> に DomainName)
├── README.md             (生成: 起動手順 + 採用パターンの表)
├── .gitignore
└── src/
    ├── main.tsx          (静的)
    ├── styles.css        (静的)
    ├── runtime.tsx       (静的: Component → JSX 汎用レンダラー)
    ├── db.ts             (静的: localStorage CRUD)
    ├── App.tsx           (生成: transitions + ナビ + 初期 currentId)
    └── screens/
        ├── index.ts      (生成: 画面レジストリ)
        └── scr_<aggregate>_<kind>.tsx  (生成: 1 画面 1 ファイル)
```

各画面ファイルは IR2 の `Screen` 構造体をそのまま埋め込み:

```tsx
// scr_Order_master.tsx
import { ScreenView, type Screen } from "../runtime";

const screen: Screen = {
  "id": "scr_Order_master",
  "kind": "master",
  "title": "Order",
  "components": [...]
};

export default function ScrOrderMaster(props: any) {
  return <ScreenView screen={screen} {...props} />;
}
```

これにより、生成後にエディタで開けば **「どの画面に何があるか」がそのまま
コードとして読める**。再生成すれば上書きされる前提なので、カスタム拡張は
別ディレクトリ (例: `src/custom/`) に置くこと。

## 静的ファイルの中身

### `runtime.tsx`

`Component` (IR2) → JSX に変換する汎用レンダラー。

```tsx
function Comp({ c, form, setField, rows, onEvent }) {
  switch (c.type) {
    case "TextInput":
      return field(c, <input value={form[bindForm(c.bind)] ?? ""}
                              onChange={...} />);
    case "Select":
    case "RadioGroup":
      return field(c, <select>{opts.map(o => <option>{o}</option>)}</select>);
    case "RefPicker":
      // db.list(refTo) で他 Aggregate のレコードを引いてオプション化
      return ...;
    case "Section":
    case "Tab":
      return <fieldset>{c.children.map(cc => <Comp c={cc} />)}</fieldset>;
    case "Table":
    case "EditableTable":
      // rows を db から取得してテーブル描画。クリックで selectedId を
      // navigate 経由で次画面へ渡す
      return ...;
    case "Button":
      return <button onClick={() => onEvent(c.props.event)}>{c.label}</button>;
    ...
  }
}
```

**フォーム値**: `form` という `Record<string, any>` を Screen 単位で持ち、
`bind="form.title"` のフィールドが書込むキーを指定。VO のサブフィールドは
flatten して `form.budget_amount` のような命名で保持。

**save イベント**: `db.save(aggregate, { id, values: form })` で localStorage
に保存。新規時は `crypto.randomUUID()` でID生成。

### `db.ts`

Aggregate 単位で localStorage を名前空間分離した CRUD:

```ts
const NS = "ddd-ui-designer-app:";
export const db = {
  list(aggregate),
  get(aggregate, id),
  save(aggregate, row),
  remove(aggregate, id),
  reset(aggregate),
};
```

DB やバックエンド不要、スタンドアローンで動く。`db.list("Customer")` を
`RefPicker` から呼べば、Customer 集約のレコードがそのままドロップダウン
化されるので、参照関係も実体験できる。

### `App.tsx` (生成)

ナビゲーション state-machine を実装。`transitions[]` を JS リテラルとして
埋め込み、ボタンクリック時に該当 transition を検索して画面切替。

```tsx
const transitions = [
  { from: "scr_Order_master", to: "scr_Order_master", event: "save" },
  ...
];

export default function App() {
  const [currentId, setCurrent] = useState("scr_Order_master");
  const [ctx, setCtx] = useState({});

  const navigate = (event, extra) => {
    const t = transitions.find(t => t.from === currentId && t.event === event);
    if (t) { setCtx({ ...ctx, ...extra }); setCurrent(t.to); }
  };

  const Screen = screens[currentId];
  return (
    <div className="app">
      <nav>{Aggregate ごとのナビボタン}</nav>
      <Screen ctx={ctx} navigate={navigate} />
    </div>
  );
}
```

## tar.gz エクスポート (`POST /api/generate`)

```bash
curl -X POST http://localhost:8095/api/generate \
  -H "Content-Type: application/json" \
  -d '{"domainId":"shop","format":"react"}' \
  -o shop-app.tar.gz
```

レスポンスヘッダ:
- `Content-Type: application/gzip`
- `Content-Disposition: attachment; filename="shop-app.tar.gz"`
- `X-App-Root: shop-app` (展開後のルートディレクトリ名)

実装: `server/internal/api/api.go` の `generateApp()` → `generate.React()`
→ `generate.TarGz(files, root)`。

## 起動 (`POST /api/launch`)

```bash
curl -X POST http://localhost:8095/api/launch \
  -H "Content-Type: application/json" \
  -d '{"domainId":"shop"}'
```

リクエストオプション:
| フィールド | 型 | 既定 | 説明 |
|------|-----|------|------|
| `domainId` | string | — | 既存ドメインを指定 (or `domain` で直接渡す) |
| `domain` | DomainModel | — | インラインで渡す |
| `config` | RulesConfig | デフォルト | 導出時の閾値 |
| `install` | bool | true | `npm install` を実行するか |
| `start` | bool | true | `vite dev` を起動するか |

レスポンス例 (即時返却、status は initial = `"generating"`):
```json
{
  "domainId": "shop",
  "path": "/abs/path/to/runs/shop-app",
  "port": 0,                      // 起動前
  "url": "",
  "status": "generating",
  "startedAt": "2026-05-02T...",
  "logPath": ".../runs/shop-app/.dev.log"
}
```

クライアント (UI / curl) は `GET /api/runs/{id}` を 1 秒間隔で polling し、
`status: "ready"` を待つ。

### Run の状態遷移

```
generating ──▶ installing ──▶ starting ──▶ ready
                  │              │            │
                  ▼              ▼            ▼
                error          error      stopped (手動)
                  │              │
                  ▼              ▼
                error           error
```

| status | 意味 | UI 表示 |
|--------|------|--------|
| `generating` | ファイル書出し中 | "ファイル生成中…" |
| `installing` | `npm install` 実行中 (初回のみ) | "npm install 実行中…" |
| `starting` | `vite dev` 起動中 (ポート LISTEN 待ち) | "Vite dev server 起動中…" |
| `ready` | URL でアクセス可能 | "起動完了 ✅" + URL リンク |
| `stopped` | プロセス終了 (停止ボタンか dev server 自身の終了) | "停止しました" |
| `error` | 起動失敗 | エラー詳細 + ログパス |

## runner.Manager の細部

`server/internal/runner/runner.go`

### writeFiles

ファイル書出し時、**`node_modules` と `package-lock.json` は保持**する。
これにより同じドメインを再生成しても `npm install` は走らず、再起動が
2〜3 秒に短縮される。

### npm install のキャッシュ

```go
nodeModules := filepath.Join(path, "node_modules")
if _, err := os.Stat(nodeModules); err != nil {
    // missing → 実行
    cmd := exec.Command("npm", "install", "--no-audit", "--no-fund", "--silent")
    ...
} else {
    // skip
}
```

### 空きポート割当

```go
func freePort() (int, error) {
    l, err := net.Listen("tcp", "127.0.0.1:0")
    defer l.Close()
    return l.Addr().(*net.TCPAddr).Port, nil
}
```

OS にカーネル側で割り振らせて即 close。短時間レースの可能性はあるが
`vite --strictPort` がポート不可なら即エラーで分かるので実用上問題なし。

### ポート起動待ち

```go
func waitForPort(port int, timeout 30s) bool {
    for time.Now().Before(deadline) {
        conn, err := net.DialTimeout("tcp", ...)
        if err == nil { conn.Close(); return true }
        time.Sleep(200ms)
    }
    return false
}
```

### 子プロセス管理

- **Linux**: `syscall.SysProcAttr{Pdeathsig: syscall.SIGTERM, Setpgid: true}`
  でカーネルが親死亡時に SIGTERM を子に送る → 孤児なし
- **macOS / Windows**: `setSysProcAttr` は no-op、`Manager.StopAll()` での
  明示的な停止だけが頼り
- main の signal handler で `SIGINT/SIGTERM` を受けたら必ず `StopAll()`

### ログ

| ファイル | 内容 |
|---------|------|
| `<runs-dir>/<id>-app/.install.log` | `npm install` の stdout/stderr |
| `<runs-dir>/<id>-app/.dev.log`     | `npm run dev` の stdout/stderr |

エラー時は `Run.Error` にメッセージ、詳細はこのログを見るよう案内。

## サーバ起動オプション

```bash
go run . -addr :8095 -data ./data -runs ./runs
```

| フラグ | 既定 | 役割 |
|-------|------|------|
| `-addr` | `:8095` | 待ち受けアドレス |
| `-data` | `./data` | DomainModel の JSON 永続化 (`storage`) |
| `-runs` | `./runs` | 生成アプリの展開・実行先 (`runner`) |

## CI 連携

GitHub Actions で生成物の妥当性を検証する例:

```yaml
- name: Generate sample app
  run: |
    curl -X POST http://localhost:8095/api/generate \
      -d '{"domainId":"shop"}' -o shop-app.tar.gz
    tar xzf shop-app.tar.gz
    cd shop-app
    npm ci
    npm run build       # tsc + vite build が通ることを検証
```

## 制限・注意点

- 生成された UI は **最小機能のプロトタイプ**。プロダクションには認証・
  バックエンド・i18n などの追加が必要。
- localStorage は同一オリジンで共有されるため、同じブラウザで複数の
  生成アプリを使うと `db` のキー衝突に注意。`db.ts` の `NS` プレフィックス
  を per-app で変えると解決。
- `runner` は `npm` を PATH から呼ぶので、Node.js が入っていない環境では
  動作しない。
