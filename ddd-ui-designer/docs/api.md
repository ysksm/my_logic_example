# HTTP API リファレンス

すべて `http://localhost:8095` (既定ポート) で提供。CORS は `*` で許可。

## 一覧

| Method | Path | 用途 |
|-------:|------|------|
| GET    | `/api/health`                | 生存確認 |
| GET    | `/api/rules`                 | ルール定義 + 既定閾値 |
| GET    | `/api/domains`               | DomainModel 一覧 |
| POST   | `/api/domains`               | DomainModel upsert |
| GET    | `/api/domains/{id}`          | DomainModel 取得 |
| DELETE | `/api/domains/{id}`          | DomainModel 削除 |
| POST   | `/api/derive`                | DomainModel → AppSpec を導出 |
| POST   | `/api/generate`              | DomainModel → React アプリ tar.gz |
| POST   | `/api/launch`                | 生成 + npm install + dev server 起動 |
| GET    | `/api/runs`                  | 起動中アプリ一覧 |
| GET    | `/api/runs/{id}`             | 起動中アプリの状態 |
| POST   | `/api/runs/{id}/stop`        | dev server 停止 |
| GET    | `/api/samples`               | バンドル済みサンプル一覧 |
| GET    | `/api/samples/{id}`          | サンプル詳細 (info + domain) |
| POST   | `/api/samples/{id}/load`     | サンプルを保存 (storage.Put) |

---

## エンドポイント詳細

### GET /api/health

生存確認。

**Response 200**
```json
{ "status": "ok" }
```

### GET /api/rules

```json
{
  "config": {
    "SmallFormFieldLimit": 5,
    "WizardFieldLimit": 20
  },
  "patterns": [
    { "id": "P1", "label": "List + Modal",  "when": "..." },
    { "id": "P2", "label": "List + Detail", "when": "..." },
    { "id": "P3", "label": "Master-Detail", "when": "..." },
    { "id": "P4", "label": "Wizard",        "when": "..." },
    { "id": "P5", "label": "Single Form",   "when": "..." }
  ]
}
```

### GET /api/domains

すべての DomainModel を name 順で返す。

**Response 200**: `DomainModel[]`

### POST /api/domains

DomainModel を upsert。`id` は必須。

**Request**: `DomainModel`
**Response 200**: `DomainModel`

### GET /api/domains/{id}

**Response 200**: `DomainModel`
**Response 404**: 存在しない場合

### DELETE /api/domains/{id}

**Response 204**: 成功（存在しなくても 204）

### POST /api/derive

DomainModel から AppSpec を導出。

**Request**:
```json
{
  "domainId": "shop",       // または下の domain
  "domain": { ... },         // インライン渡し
  "config": {                // 任意
    "SmallFormFieldLimit": 3,
    "WizardFieldLimit": 15
  }
}
```

**Response 200**: `AppSpec`

```jsonc
{
  "domainId": "shop",
  "domainName": "Shop Domain",
  "plans": [
    {
      "aggregateRef": "Order",
      "pattern": "P3",
      "reason": "子Entityあり (Master-Detail)",
      "screenIds": ["scr_Order_master"],
      "navLabel": "Order"
    }
  ],
  "screens": [...],
  "transitions": [...],
  "navRoots": [...]
}
```

### POST /api/generate

React+Vite プロジェクトを tar.gz で返却。

**Request**:
```json
{
  "domainId": "shop",
  "domain": { ... },
  "config": {...},
  "format": "react"          // 既定 "react" (現状唯一)
}
```

**Response 200**:
- Content-Type: `application/gzip`
- Content-Disposition: `attachment; filename="shop-app.tar.gz"`
- X-App-Root: `shop-app` (展開後のルート名)
- Body: gzipped tar

### POST /api/launch

生成 + (オプションで) `npm install` + `vite dev` を起動。即時 202 で
返却し、状態は `/api/runs/{id}` でポーリング。

**Request**:
```json
{
  "domainId": "shop",
  "domain": {...},
  "config": {...},
  "install": true,           // 任意、既定 true (false なら writeFiles のみ)
  "start": true              // 任意、既定 true
}
```

**Response 202**: `Run` 構造体 (initial; status は通常 `"generating"`)

```jsonc
{
  "domainId": "shop",
  "path": "/abs/runs/shop-app",
  "port": 0,
  "url": "",
  "status": "generating",
  "startedAt": "2026-05-02T...",
  "updatedAt": "2026-05-02T...",
  "logPath": "/abs/runs/shop-app/.dev.log"
}
```

### GET /api/runs

すべての run の現在の状態。

**Response 200**: `Run[]`

### GET /api/runs/{id}

特定 domain の run。

**Response 200**: `Run`
**Response 404**: 存在しない

### POST /api/runs/{id}/stop

dev server を停止。フォルダは残る (`.tmp/data` などのファイルもそのまま)。

**Response 200**: `Run` (`status: "stopped"`)
**Response 204**: 該当 run なし

### GET /api/samples

バンドル済みサンプル一覧。

**Response 200**:
```json
[
  { "id": "blog",    "name": "Blog Domain",        "description": "...", "aggregateCount": 4 },
  { "id": "project", "name": "Project Management", "description": "...", "aggregateCount": 4 },
  { "id": "shop",    "name": "Shop Domain",        "description": "...", "aggregateCount": 4 }
]
```

### GET /api/samples/{id}

サンプル詳細。

**Response 200**:
```json
{
  "id": "...",
  "name": "...",
  "description": "...",
  "aggregateCount": 4,
  "domain": { ... DomainModel ... }
}
```

### POST /api/samples/{id}/load

サンプルの DomainModel を `storage.Put` で永続化 (= 一覧 dropdown にも
出るように)。

**Response 200**: `DomainModel`

---

## データ型

### DomainModel (IR1)

```go
type DomainModel struct {
    ID         string      `json:"id"`
    Name       string      `json:"name"`
    Aggregates []Aggregate `json:"aggregates"`
    Services   []Service   `json:"services,omitempty"`
}

type Aggregate struct {
    Name         string        `json:"name"`
    IsSingleton  bool          `json:"isSingleton,omitempty"`
    Root         Entity        `json:"root"`
    Entities     []Entity      `json:"entities,omitempty"`
    ValueObjects []ValueObject `json:"valueObjects,omitempty"`
    Hint         UIHint        `json:"uiHint,omitempty"`
}

type Entity struct {
    Name     string   `json:"name"`
    Fields   []Field  `json:"fields"`
    Children []string `json:"children,omitempty"` // 同集約内の子Entity名
    IsRoot   bool     `json:"isRoot,omitempty"`
}

type ValueObject struct {
    Name         string  `json:"name"`
    Fields       []Field `json:"fields"`
    IsIdentifier bool    `json:"isIdentifier,omitempty"`
}

type Field struct {
    Name       string    `json:"name"`
    Type       FieldType `json:"type"` // string|text|int|bool|date|enum|ref|vo
    Required   bool      `json:"required,omitempty"`
    EnumValues []string  `json:"enumValues,omitempty"`
    RefTo      string    `json:"refTo,omitempty"`
    VOTypeRef  string    `json:"voTypeRef,omitempty"`
    Many       bool      `json:"many,omitempty"`
}

type UIHint struct {
    Pattern    string `json:"pattern,omitempty"`    // P1..P5、空なら自動
    FormStyle  string `json:"formStyle,omitempty"`  // 予約
    ChildStyle string `json:"childStyle,omitempty"` // tab|section|table
}

type Service struct {
    Name         string  `json:"name"`
    AggregateRef string  `json:"aggregateRef"`
    Inputs       []Field `json:"inputs,omitempty"`
    Confirm      bool    `json:"confirm,omitempty"`
}
```

### AppSpec (IR2)

```go
type AppSpec struct {
    DomainID    string          `json:"domainId"`
    DomainName  string          `json:"domainName"`
    Plans       []AggregatePlan `json:"plans"`
    Screens     []Screen        `json:"screens"`
    Transitions []Transition    `json:"transitions"`
    NavRoots    []string        `json:"navRoots"`
}

type AggregatePlan struct {
    AggregateRef string   `json:"aggregateRef"`
    Pattern      Pattern  `json:"pattern"` // P1..P5
    Reason       string   `json:"reason"`
    ScreenIDs    []string `json:"screenIds"`
    NavLabel     string   `json:"navLabel"`
}

type Screen struct {
    ID            string      `json:"id"`
    Kind          ScreenKind  `json:"kind"`
    Title         string      `json:"title"`
    AggregateRef  string      `json:"aggregateRef"`
    EntityRef     string      `json:"entityRef,omitempty"`
    ParentScreen  string      `json:"parentScreen,omitempty"`
    Components    []Component `json:"components"`
    StepIndex     int         `json:"stepIndex,omitempty"`
}

type Component struct {
    Type     string                 `json:"type"`
    Bind     string                 `json:"bind,omitempty"`
    Label    string                 `json:"label,omitempty"`
    Props    map[string]interface{} `json:"props,omitempty"`
    Children []Component            `json:"children,omitempty"`
}

type Transition struct {
    From  string `json:"from"`
    To    string `json:"to"`
    Event string `json:"event"`
}
```

### Run

```go
type Run struct {
    DomainID  string    `json:"domainId"`
    Path      string    `json:"path"`
    Port      int       `json:"port"`
    URL       string    `json:"url,omitempty"`
    Status    Status    `json:"status"` // generating|installing|starting|ready|stopped|error
    Error     string    `json:"error,omitempty"`
    StartedAt time.Time `json:"startedAt"`
    UpdatedAt time.Time `json:"updatedAt"`
    LogPath   string    `json:"logPath,omitempty"`
}
```

### RulesConfig

```go
type Config struct {
    SmallFormFieldLimit int // P1 を選ぶ閾値 (≦)
    WizardFieldLimit    int // P4 を選ぶ閾値 (>)
}
```

---

## エラーフォーマット

```json
{ "error": "メッセージ" }
```

HTTP ステータスは適切なものを返す:

| 状況 | ステータス |
|------|-----------|
| 不正なリクエスト (JSON パース失敗、id 欠落) | 400 |
| 未存在 (domain / sample / run) | 404 |
| メソッド不一致 | 405 (Allow ヘッダ付き) |
| 内部エラー | 500 |

## CORS

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS
Access-Control-Allow-Headers: Content-Type
```

開発時の Vite proxy (`/api → :8095`) で済むため、通常の運用では同一
オリジンを推奨。
