# Ticket Manager

チケット管理 / カレンダー管理 / 工数管理を提供する小さな自前ツール。

- **チケット**: Epic / Story / Task / Subtask の階層、状態 (TODO / IN_PROGRESS / DONE)、タグ
- **カレンダー**: チケットの期日・工数・任意イベントを月別ビューで表示
- **工数**: 任意のチケットに対して日次の作業時間を登録 / 集計
- **リポジトリ管理**: ローカルのGit working tree を登録し、ブランチ一覧表示・ブランチ作成
- **メンテナンスモード**: DBのテーブル一覧、テーブル全件 dump、任意 SQL 実行
- **マルチ DB**: DuckDB / SQLite / PostgreSQL / MySQL を起動時 env で切替

## アーキテクチャ

```
ticket-manager/
├── idl/openapi.yaml           OpenAPI 3.0 で API を定義 (IDL)
├── server/                    Go + DuckDB
│   ├── cmd/server/main.go
│   └── internal/
│       ├── domain/            ドメインモデル
│       ├── repository/        DB アクセス
│       ├── service/           ビジネスロジック
│       ├── handler/           HTTP ルーティング (chi)
│       ├── infra/             DB 接続 + 埋め込みマイグレーション (driver 別)
│       │   └── dbx/           方言抽象 (?→$N、ON CONFLICT/INSERT IGNORE 切替)
│       ├── git/               git CLI ラッパー
│       └── maintenance/       メンテナンスモード (テーブル dump, 任意 SQL)
└── frontend/                  React + TypeScript + Vite (レイヤード)
    └── src/
        ├── domain/            型 (IDL と整合)
        ├── infrastructure/    API クライアント
        ├── application/       ユースケース hook
        ├── presentation/      ページ / コンポーネント
        └── shared/            共通スタイル
```

レイヤー間は外側 → 内側のみ依存させ、`presentation` から直接 `fetch` を呼ばないようにしています。

## API IDL

OpenAPI 3.0 (`idl/openapi.yaml`) を Source of Truth として、サーバーとフロントの双方を整合させています。
クライアントの型 (`frontend/src/domain/types`) は IDL と手動で整合させた最小実装です。コード生成器を後で
入れる場合も、生成物は `frontend/src/infrastructure/generated/` に配置する想定です。

## 実行

### 1コマンドでビルド & 起動

```bash
make run        # フロントを vite build → Go バイナリへ go:embed → :8080 で起動
```

http://localhost:8080 で UI と API が同一ポートから配信されます。
オプション:

| 変数 | 用途 | デフォルト |
| --- | --- | --- |
| `ADDR` | listen アドレス | `:8080` |
| `DB_DRIVER` | DB ドライバ (`duckdb` / `sqlite` / `postgres` / `mysql`) | `duckdb` |
| `DB`   | DSN: ファイルパスまたは接続文字列 (詳細下記) | `ticket-manager.duckdb` |
| `MAINTENANCE_TOKEN` | メンテナンスモード有効化時に必要なトークン | (未設定: 誰でも有効化可) |

例: `make run ADDR=:9000 DB=:memory:`

#### DB ドライバごとの DSN 例

| `DB_DRIVER` | `DB` の例 | 備考 |
| --- | --- | --- |
| `duckdb` | `ticket-manager.duckdb`, `:memory:` | 既存の挙動。go-duckdb が組み込みで動作 |
| `sqlite` | `ticket-manager.sqlite`, `:memory:` | modernc.org/sqlite (CGO 不要) |
| `postgres` | `postgres://user:pass@host:5432/db?sslmode=disable` | jackc/pgx の stdlib 経由 |
| `mysql` | `user:pass@tcp(host:3306)/db` | go-sql-driver/mysql。`parseTime=true` は自動付与 |

スキーマは `server/internal/infra/migrations/<driver>/` 以下に方言別の SQL を
配置しており、`schema_migrations` テーブルで適用済みファイル名を記録するので
再起動時に同じマイグレーションが二重適用されることはありません。

例:

```bash
# SQLite
make dev DB_DRIVER=sqlite DB=tm.sqlite

# PostgreSQL
make dev DB_DRIVER=postgres DB='postgres://tm:tm@localhost:5432/tm?sslmode=disable'

# MySQL
make dev DB_DRIVER=mysql DB='tm:tm@tcp(localhost:3306)/tm'
```

### その他のターゲット

```bash
make build      # フロント + バイナリをビルドし bin/ticket-manager に出力
make dev        # サーバ (:8080) と Vite dev (:5173, /api をプロキシ) を並走
make clean      # ビルド成果物を削除
```

### 個別に動かす場合

```bash
# サーバ単体
cd server && go run ./cmd/server -addr :8080 -db-driver duckdb -db ticket-manager.duckdb

# フロントエンド単体 (HMR、API は :8080 にプロキシ)
cd frontend && npm install && npm run dev
```

`make build` / `make run` は frontend の vite build を
`server/internal/webui/static/` に出力し、`go:embed` でバイナリに同梱します。

## 主要 API

| Method | Path | 説明 |
| --- | --- | --- |
| GET | `/api/health` | ヘルス & メンテ状態 |
| GET / POST | `/api/tickets` | チケット一覧 / 作成 |
| GET / PUT / DELETE | `/api/tickets/{id}` | 詳細 / 更新 / 削除 |
| POST / DELETE | `/api/tickets/{id}/tags` | タグ付与 / 解除 |
| GET | `/api/tags` | タグ一覧 |
| GET / POST | `/api/time-entries` | 工数一覧 / 登録 |
| DELETE | `/api/time-entries/{id}` | 工数削除 |
| GET | `/api/calendar?from=&to=` | 期日 / 工数 / イベントの統合表示 |
| GET / POST / DELETE | `/api/calendar/events` | カレンダーイベント |
| GET / POST / DELETE | `/api/repositories` | リポジトリ登録 |
| GET / POST | `/api/repositories/{id}/branches` | ブランチ一覧 / 作成 |
| GET / POST | `/api/maintenance/status,enable,disable` | メンテモード制御 |
| GET | `/api/maintenance/tables` | テーブル一覧 |
| GET | `/api/maintenance/tables/{name}` | テーブル dump |
| POST | `/api/maintenance/query` | 任意 SQL 実行 |

詳細は `idl/openapi.yaml` を参照してください。

## メモ

- ブランチ作成は登録済みリポジトリのローカル working tree に対して `git branch <new> [<from>]`
  (オプションで `git checkout`) を実行します。push は行いません。
- メンテナンスモードの任意 SQL は DDL/DML も許可しています。本番運用時はトークン必須で運用してください。
