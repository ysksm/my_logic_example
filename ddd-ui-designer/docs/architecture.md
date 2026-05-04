# アーキテクチャ

ddd-ui-designer は **「ドメインを記述すると、画面パターンに沿ったアプリが
出てくる」** というフローを 1 つのパイプラインで提供します。中核は 2 つの
中間表現 (IR) と、その間にあるルールエンジンです。

## 全体パイプライン

```
                           ┌──────────────────────┐
                           │  ルールエンジン       │
                           │  (rules.Derive)       │
                           └──────────┬───────────┘
                                      │
   ┌──────────────────┐         ┌─────▼──────┐         ┌──────────────────┐
   │ IR1              │  入力   │ IR2         │  入力   │ 成果物            │
   │ DomainModel       │────────▶│ AppSpec     │────────▶│ AppSpec JSON      │
   │ - Aggregate       │         │ - Plan       │         │ モックプレビュー │
   │ - Entity / VO     │         │ - Screen     │         │ 画面遷移図        │
   │ - Service         │         │ - Transition │         │ ER 図 (※IR1)      │
   │ - UI ヒント        │         │ - Component  │         │ React アプリ tar  │
   └──────────────────┘         └──────────────┘         │ 起動済みアプリ    │
                                                         └──────────────────┘
```

- **IR1** は「ドメインの形」だけを表現する純粋なメタモデル。
- **ルールエンジン**が IR1 を受け取り、5 つの画面パターン (P1〜P5) のどれを
  各 Aggregate に割り当てるかを決定。
- **IR2** は「画面・遷移・コンポーネント」のレベルまで具体化された UI 仕様。
- IR2 から複数の成果物 (モックプレビュー / SVG 図 / 動く React アプリ) が導出。

詳細は [patterns.md](./patterns.md) と [outputs.md](./outputs.md) を参照。

## ディレクトリ構成

```
ddd-ui-designer/
├── server/                          … Go バックエンド
│   ├── main.go                      … embed (samples), 起動・signal handling
│   ├── samples/                     … バンドル済みサンプル JSON (//go:embed)
│   └── internal/
│       ├── domain/   model.go       … IR1 型定義
│       ├── ui/       spec.go        … IR2 型定義
│       ├── rules/    derive.go      … パターン選択 + Screen 生成エンジン
│       ├── samples/  samples.go     … bundled サンプルの読込
│       ├── storage/  store.go       … DomainModel の JSON 永続化
│       ├── generate/ react.go       … IR2 → React+Vite プロジェクトの生成
│       │            templates.go    … 生成プロジェクトの静的ファイル
│       ├── runner/   runner.go      … 生成アプリの npm install / vite dev 管理
│       │            sysproc_linux.go … Pdeathsig (Linux のみ)
│       │            sysproc_other.go … Linux 以外の no-op
│       └── api/      api.go         … HTTP ルーティング
└── ui/                              … React + Vite フロントエンド
    └── src/
        ├── App.tsx                  … 状態管理、トップバー、レイアウト
        ├── api.ts / types.ts        … 型と fetch ラッパ
        ├── styles.css               … レイアウト + モード切替 + フォーム
        └── components/
            ├── DomainTree.tsx       … 左ペイン: Aggregate ツリー
            ├── AggregateEditor.tsx  … 中央ペイン: 編集フォーム
            ├── RightPane.tsx        … 右ペイン: 3 タブ管理
            ├── ScreenPreview.tsx    … 🪟 モックプレビュー
            ├── FlowDiagram.tsx      … 🔀 画面遷移図 (SVG)
            ├── DomainDiagram.tsx    … 📐 ドメイン ER 図 (SVG)
            ├── SampleMenu.tsx       … 📂 サンプル読込メニュー
            └── RunPanel.tsx         … 🚀 生成 → 実行 のステータス
```

## データフロー (典型的なシナリオ)

```
[1] サンプル読込
   UI: 📂 サンプル → "Project Management" を選択
   → POST /api/samples/project/load
   → server: samples.Get → storage.Put → DomainModel を返却
   → UI: setDomain(d), 左ツリーに反映

[2] 画面導出
   UI: ▶ 画面を導出 ボタン
   → POST /api/derive { domain, config }
   → server: rules.Derive → AppSpec を返却
   → UI: setSpec(spec), 右ペインに表示

[3] 表示モード切替
   UI: 👁 表示 をクリック
   → mode state を localStorage に保存
   → .layout に data-mode="view" 付与
   → CSS で中央ペインを display:none、グリッド比を 220px / 1fr に再配分

[4] 動かしたい
   UI: 🚀 生成 → 実行
   → POST /api/launch
   → server: rules.Derive → generate.React → runner.Manager.Launch
        - <runs-dir>/<id>-app/ にファイル書出し
        - npm install (キャッシュヒット時 skip)
        - vite dev (空きポート, --strictPort)
        - port 待機 → ready
   → UI: RunPanel が 1 秒 polling、status=ready で URL を表示
   → ユーザーが新タブで開く → 生成アプリと対話
```

## サーバ起動 / シャットダウン

```go
// main.go
ctx, cancel := signal.NotifyContext(ctx, SIGINT, SIGTERM)
go srv.ListenAndServe()
<-ctx.Done()
mgr.StopAll()       // 起動中の全 vite dev を kill
srv.Shutdown(...)
```

子プロセス (`npm run dev`) は Linux では `Pdeathsig: SIGTERM` を設定してい
るため、親が異常終了しても孤児として残らないようカーネルレベルで保護。
macOS / Windows ではこの保証がないので、`StopAll()` での明示的な停止が
唯一の防衛線になる。

## モジュール間の責務

| パッケージ | 入力 | 出力 | 副作用 |
|------------|------|------|--------|
| `domain` | — | IR1 型のみ | なし |
| `ui` | — | IR2 型のみ | なし |
| `rules` | IR1 + Config | IR2 | なし (純関数) |
| `storage` | DomainModel | DomainModel | JSON ファイル R/W |
| `samples` | — | DomainModel | embed.FS 読込のみ (rw なし) |
| `generate` | IR2 | filename → bytes / tar.gz | なし (in-memory) |
| `runner` | filename → bytes | Run state | ファイル書出し / 子プロセス起動 |
| `api` | HTTP request | HTTP response | 上の合成 |

ルールエンジン (`rules`) と生成器 (`generate`) はどちらも純関数なので、
別の入力源 (例: `ddd-diagram-generator` の解析結果) からドメインを供給する
場合でも再利用可能。

## 拡張ポイント

- **ルールの差し替え** — `rules.Config` の閾値だけでは足りない場合、
  `rules.Derive` 内のロジックを差替えて `Config` に押し込めるか、別の関数
  にする。`uiHint.pattern` で個別上書きは既に可能。
- **新しいパターン** — `ui.Pattern` 定数を追加し、`rules.generateForPattern`
  に対応する関数を追加。Screen / Transition の生成だけ書けば連鎖して動く。
- **新しい出力フォーマット** — `generate` パッケージに `HTML(spec)` 等の
  関数を増やし、`POST /api/generate?format=html` を増やす。
- **コードからの IR1 生成** — `ddd-diagram-generator` の解析 JSON を
  `domain.DomainModel` に変換するアダプタを書けば、コード→図→アプリの
  完全パイプラインが繋がる。

## なぜ「中間表現 2 段」なのか

直接「DomainModel → React コード」と書くと、

- ドメインに無い情報 (Component の種類、画面遷移のフロー) がコード内で
  決め打ちになる
- 画面パターンを差し替えたいとき、コードを書き直す必要がある
- 「コードを生成しないがプレビューだけ見たい」「JSON 仕様だけ欲しい」
  などのバリエーションに対応しづらい

中間に IR2 (`AppSpec`) を挟むことで、

- ルールエンジンと生成器を分離 (どのパターンを採るかと、どう描画するかが
  独立)
- 同じ AppSpec から複数の出力物 (モック / SVG / React) が導出
- AppSpec を JSON として外部に渡せば、別言語・別フレームワーク向けの
  ジェネレータも書ける

という拡張性が得られる。
