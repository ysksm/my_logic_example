# バンドル済みサンプル

ddd-ui-designer の server バイナリには **3 種類のサンプルドメイン**が
`//go:embed samples/*.json` で同梱されており、UI から 1 クリックで読込
できます。

## ファイル配置

```
ddd-ui-designer/
└── server/
    ├── main.go
    │      //go:embed samples/*.json
    │      var samplesFS embed.FS
    └── samples/
        ├── shop.json     … EC ドメイン
        ├── blog.json     … ブログ
        └── project.json  … プロジェクト管理
```

`server/internal/samples/samples.go` の `Manager` が `embed.FS` から読込み、
description は `DomainModel` とは別の小さな struct に展開してメタ情報として
保持。

## 一覧

| サンプル | 集約数 | 集約 | 実演されるパターン |
|---------|-------|------|-------------------|
| **Shop Domain** | 4 | Order / Customer / Product / ShopSettings | P1 + P2 + P3 + P5 |
| **Blog Domain** | 4 | Post / Author / Comment / BlogSettings | P1 + P2 + P5 |
| **Project Management** | 4 | Project / Task / User / AppSettings | P1 + P3 + P4 + P5 |

3 サンプル合わせて **P1〜P5 の全パターン**が網羅される。

### Shop Domain

EC (電子商取引) ドメイン。最もリッチな組合せ。

- **Order** (P3 — Master-Detail): `OrderLine` を子 Entity に持つ + `Money`
  VO 利用。`uiHint.childStyle: "table"` で子をテーブル表示。
- **Customer** (P1 — List+Modal): 3 フィールド (id, name, email)。
- **Product** (P2 — List+Detail): 6 フィールド + `Money` VO。
- **ShopSettings** (P5 — Single Form): Singleton。

ドメインサービス (`PlaceOrder`, `CancelOrder`) は `confirm: true` 付きで、
派生時に `svc_Order_<service>_confirm` 画面が追加生成される。

### Blog Domain

ブログ。シンプルだが現実的な業務ドメイン。

- **Post** (P2 — List+Detail): 9 フィールド (title, slug, body, status, ...)
  + `Author` への ref。
- **Author** (P1 — List+Modal): 3 フィールド。
- **Comment** (P1 — List+Modal): `Post` への ref + 投稿者・本文。
- **BlogSettings** (P5 — Single Form): Singleton。

子 Entity が無いシンプルな構成なので **P3 / P4 の発動条件は満たさない**
代わりに、`ref` の応酬と「VO は ID のみ使う」スタイルを示す。

### Project Management

プロジェクト管理。**P4 ウィザードを既定の閾値で発動**する唯一のサンプル。

- **Project** (P4 — Wizard): 子 Entity (`Milestone`, `Risk`) + 23 フィールド
  (Money VO 展開後)。`WizardFieldLimit=20` を超えるため P4 が選ばれる。
- **Task** (P3 — Master-Detail): 子 Entity (`TaskComment`)。
- **User** (P1 — List+Modal): 4 フィールド。
- **AppSettings** (P5 — Single Form): Singleton。

「すぐに 4 パターン全種を見たい」ときの定番。

## 読込操作

### UI から

トップバー **📂 サンプル ▾** をクリック → ドロップダウンが開き、3 サンプル
それぞれに 2 つのボタンが付く。

| ボタン | 動作 | API |
|--------|------|-----|
| **編集に読込** | 編集ペインの state にだけ反映 (永続化なし) | `GET /api/samples/{id}` |
| **読込 + 保存** | 上記 + サーバー側ストレージに保存 (一覧 dropdown にも追加) | `POST /api/samples/{id}/load` |

メニュー外をクリックすると自動で閉じる。

実装: `ui/src/components/SampleMenu.tsx`

### CLI から

```bash
# 一覧
curl http://localhost:8095/api/samples | jq

# サンプルの詳細 (info + 完全な domain)
curl http://localhost:8095/api/samples/blog | jq

# サーバ側ストレージへ保存
curl -X POST http://localhost:8095/api/samples/project/load | jq
```

## サンプル JSON の仕様

通常の `DomainModel` JSON に **`description` フィールド**を追加可能 (UI の
メニューで表示される)。`DomainModel` 構造体は `description` を持たない
ので、サーバ側で別 struct に分離 unmarshal:

```go
// samples/samples.go
var meta struct {
    Description string `json:"description"`
}
_ = json.Unmarshal(b, &meta)

var d domain.DomainModel
_ = json.Unmarshal(b, &d)
```

これにより `Domain` を round-trip しても description は失われず、かつ
`DomainModel` の構造はクリーンに保たれる。

## サンプルを追加する手順

1. `server/samples/<id>.json` に新規ファイルを置く
2. JSON のトップに以下を含める:
   ```json
   {
     "id": "<unique id>",
     "name": "<表示名>",
     "description": "<UI に表示される短い説明 (推奨 60〜120 文字)>",
     "aggregates": [...]
   }
   ```
3. ビルド (`go build .`) すれば `embed.FS` に取り込まれて UI のメニューに
   自動表示される

特別なツール / 登録は不要。`samples.Manager` がディレクトリを動的にスキャン。

## テスト

`server/internal/samples/samples_test.go` で `testing/fstest.MapFS` を使った
ユニットテストを実装。

```bash
cd ddd-ui-designer/server
go test ./internal/samples
```

E2E テスト (`e2e/tests/samples.spec.ts`) では:
- `/api/samples` が blog/project/shop の 3 件を返す
- メニュー操作で blog の 4 集約が読み込まれる
- 「読込 + 保存」で `/api/domains` に project が現れる
を検証。

## サンプルのライセンス / 権利

すべてダミーデータで、実在の企業・個人と関係ない。リポジトリのライセンスに
従って自由に複製・改変可能。
