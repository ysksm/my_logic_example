# 表示ビューとモード切替

ddd-ui-designer は 2 軸で「見せ方」を制御します。

1. **右ペインの 3 タブ** — 同じデータを 3 通りに描画 (モック / フロー / ER)
2. **🛠 設定 / 👁 表示 モード** — レイアウト全体を編集向き / 表示向きに切替

両者は独立しており、組み合わせて使えます (例: 表示モード × 画面遷移図 =
プレゼン用フロー図ビュー)。

## 1. 右ペインの 3 タブ

| タブ | 内容 | 必要なもの | 実装 |
|------|------|-----------|------|
| 🪟 **モックプレビュー** | 派生結果を画面ごとにモック UI で描画 | `▶ 派生` 実行後 | `ScreenPreview.tsx` |
| 🔀 **画面遷移図** | Screen をノード、Transition を矢印にした SVG フロー | `▶ 派生` 実行後 | `FlowDiagram.tsx` |
| 📐 **ドメイン ER 図** | Aggregate / Entity / VO を ER 風に描画 | （常時表示） | `DomainDiagram.tsx` |

タブの切替は state 管理のみで、データ自体は同じ `domain` / `spec` を参照。
タブ間で行き来しても再 fetch は走らない。

タブ実装: `ui/src/components/RightPane.tsx`

### 🔀 画面遷移図の構成要素

```
紫の破線 swim lane × Aggregate の数

  [Tag]  [P2] 子なし かつ フィールド数2
   ┌───────┐   select   ┌────────┐   edit   ┌────────┐
   │ list  │──────────▶ │ detail │ ───────▶ │  edit  │
   │       │            │        │ ◀─────── │        │
   └───────┘            └────────┘  back     └────────┘
                          ▲ cancel             │ save
                          └─────────────────────┘
```

- **ノード**: 200×76 の角丸矩形、上部 20px に kind の色帯
- **kind 色マッピング** (`kindColor()`):
  - `list` = #3b82f6 (青)
  - `detail` = #10b981 (緑)
  - `edit` / `create` = #f59e0b (オレンジ)
  - `modal` = #fb7185 (ピンク)
  - `master` = #a855f7 (紫)
  - `settings` / `form` = #8b5cf6 (紫)
  - `wizard-step` = #06b6d4 (シアン)
  - `wizard-review` = #0891b2 (濃シアン)
  - `confirm` = #dc2626 (赤)
- **矢印スタイル**:
  - 順方向 (左→右、同じ swim lane): 黒実線、ラベル白背景
  - 戻り方向 (右→左): 灰破線、上にカーブ
  - 自己ループ: 小さなアーチ
  - 異 swim lane: 直線対角

### 📐 ドメイン ER 図の構成要素

```
紫の破線クラスタ × Aggregate の数 (横並び)

  ┌─ ◆ Order ──────────────────────────┐
  │  ╔════════════════════════════════╗ │
  │  ║ Order                  [root] ║ │
  │  ║ * id   : «OrderId»            ║ │ ← 緑ヘッダ = Root Entity
  │  ║ * status : enum(4)            ║ │
  │  ║   total : «Money»             ║ │
  │  ╚════════════════════════════════╝ │
  │  ╔════════════════════════════════╗ │
  │  ║ OrderLine             [child] ║ │ ← 青ヘッダ = 子 Entity
  │  ║ * product : → Product         ║ │
  │  ║ * quantity : int              ║ │
  │  ╚════════════════════════════════╝ │
  │  ╔════════════════════════════════╗ │
  │  ║ Money              «VO»        ║ │ ← 紫ヘッダ = 複合 VO
  │  ║   amount : int                 ║ │
  │  ║   currency : string            ║ │
  │  ╚════════════════════════════════╝ │
  │  ╔════════════════════════════════╗ │
  │  ║ OrderId      «id»  (薄め)     ║ │ ← 灰ヘッダ = Identifier VO
  │  ╚════════════════════════════════╝ │
  └────────────────────────────────────┘
```

- **アイコン**: ◆ = 通常、⚙ = Singleton
- **行表記** (`fieldTypeLabel()`):
  - `name`     : `string` / `text` / `int` / `bool` / `date` …
  - `name`     : `→ <Aggregate>[]` (`ref` への参照、`many` ならば `[]`)
  - `name`     : `«<VO 名>»`        (VO への参照)
  - `name`     : `enum(3)`           (enum、`enumValues` の長さ)
- **required** は `*` プレフィックス
- **異 Aggregate 間の `ref`** は灰の点線で結線、ラベルに `<entity>.<field>`
  を表示

### 「選択中のみ」フィルタとの関係

| タブ | 「選択中のみ」が効くか |
|------|----------------------|
| 🪟 モックプレビュー | **効く** (左ツリーで選んだ Aggregate のみ) |
| 🔀 画面遷移図 | 効かない (常に全 Aggregate 表示) |
| 📐 ドメイン ER 図 | 効かない (常に全 Aggregate 表示) |

## 2. 🛠 設定 / 👁 表示 モード切替

トップバー左のセグメント切替で、レイアウト全体を切替。

| モード | レイアウト | 用途 |
|--------|------------|------|
| **🛠 設定** (既定) | `320px / 1fr / 380px` の 3 ペイン | ドメイン編集 |
| **👁 表示** | `220px / 1fr` (中央エディタ非表示) | プレゼン、ドキュメント生成、画面遷移図のフル表示 |

実装の核:
```css
.layout {
  display: grid;
  grid-template-columns: 320px 1fr 380px;
  transition: grid-template-columns 180ms ease-out;
}
.layout[data-mode="view"] {
  grid-template-columns: 220px 1fr;
}
.layout[data-mode="view"] > .pane:nth-child(2) {
  display: none;
}
```

### 永続化

選択は `localStorage` (key: `ddd-ui-designer:mode`) に保存。次回起動時も
同じモードで開く。

### アクセシビリティ

```html
<div class="mode-switch" role="group" aria-label="表示モード切替">
  <button aria-pressed="true">🛠 設定</button>
  <button aria-pressed="false">👁 表示</button>
</div>
```

`aria-pressed` で active 状態を表現。

### モード × タブの組合せの意図

| 組合せ | 想定シナリオ |
|--------|-------------|
| 🛠 設定 × 🪟 モックプレビュー | 編集しながら結果を確認 (デフォルトの作業モード) |
| 🛠 設定 × 🔀 画面遷移図 | 編集しながら全体構造を確認 |
| 🛠 設定 × 📐 ER 図 | 編集しながらモデルの全体像を確認 |
| 👁 表示 × 🪟 モックプレビュー | プロトタイプを大画面で見せる |
| **👁 表示 × 🔀 画面遷移図** | **画面遷移図のプレゼン (推奨)** |
| **👁 表示 × 📐 ER 図** | **ドメイン構造のレビュー会** |

## デモでの使われ方

`e2e/demo/demo.spec.ts` のステップ 13a (`mode-view-on`) で 👁 表示モードに
切替えてから 🔀 / 📐 を順次撮影。撮影後は 🛠 設定モードに戻して通常の
ワークフローを再開。これによりデモ動画 1 本で「編集 → 表示 → 編集」の
スイッチが自然に流れる。

実体は `page.getByTestId("mode-view").click()` だけで、CSS に書いた切替を
そのまま操作している (以前の `page.evaluate` で grid-template-columns を
書き換えていた hack は撤去済み)。
