# Ticket Manager

チケット管理 / カレンダー管理 / 工数管理を提供する小さな自前ツール。

- **チケット**: Epic / Story / Task / Subtask の階層、状態 (TODO / IN_PROGRESS / DONE)、タグ
- **カレンダー**: チケットの期日・工数・任意イベントを月別ビューで表示
- **工数**: 任意のチケットに対して日次の作業時間を登録 / 集計
- **リポジトリ管理**: ローカルのGit working tree を登録し、ブランチ一覧表示・ブランチ作成
- **メンテナンスモード**: DBのテーブル一覧、テーブル全件 dump、任意 SQL 実行

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
│       ├── infra/             DuckDB 接続 + 埋め込みマイグレーション
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

### 1. サーバー (Go + DuckDB)

```bash
cd server
go mod tidy
go run ./cmd/server -addr :8080 -db ticket-manager.duckdb
```

主な環境変数:

| 変数 | 用途 |
| --- | --- |
| `MAINTENANCE_TOKEN` | メンテナンスモード有効化時に必要なトークン (未設定なら誰でも有効化可) |

### 2. フロントエンド (React + Vite)

```bash
cd frontend
npm install
npm run dev    # http://localhost:5173 (API は :8080 にプロキシ)
```

本番ビルドは `npm run build`。

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
