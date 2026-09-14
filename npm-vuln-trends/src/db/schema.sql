-- 公式情報 → 原本保存 → 正規化・履歴 → 月次集計 のためのスキーマ。
-- すべての時刻は UTC の ISO8601 文字列で保持する。

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- 実行履歴とカーソル（差分取得は公開日ではなく modified を追う）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fetch_runs (
  run_id       TEXT PRIMARY KEY,
  source       TEXT NOT NULL,              -- 'github_advisories' | 'osv' | 'github_issues' | 'npm_audit'
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  status       TEXT NOT NULL,              -- 'running' | 'success' | 'failed'
  pages        INTEGER NOT NULL DEFAULT 0,
  items        INTEGER NOT NULL DEFAULT 0,
  error        TEXT
);

-- 全ページ成功後にだけ更新する保存位置。失敗時は前回結果を維持する。
CREATE TABLE IF NOT EXISTS source_cursors (
  source        TEXT NOT NULL,
  scope         TEXT NOT NULL DEFAULT '',  -- repository など、情報源内の区分
  cursor_at     TEXT NOT NULL,             -- 次回の since 起点（modified 基準）
  updated_at    TEXT NOT NULL,
  updated_by    TEXT NOT NULL,             -- run_id
  PRIMARY KEY (source, scope)
);

-- ---------------------------------------------------------------------------
-- 原本保存（URL・取得日時・ハッシュ・実行 ID を付ける）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw_documents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source       TEXT NOT NULL,
  source_key   TEXT NOT NULL,              -- GHSA-xxxx / owner/repo#123 など
  url          TEXT NOT NULL,
  fetched_at   TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  run_id       TEXT NOT NULL,
  payload      TEXT NOT NULL,
  UNIQUE (source, source_key, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_raw_source_key ON raw_documents (source, source_key, fetched_at);

-- ---------------------------------------------------------------------------
-- 正規化した advisory（重複解決後の 1 件 = 1 行）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS advisories (
  ghsa_id       TEXT PRIMARY KEY,
  cve_id        TEXT,
  summary       TEXT NOT NULL DEFAULT '',
  severity      TEXT NOT NULL DEFAULT 'unknown', -- critical|high|moderate|low|unknown
  cvss_score    REAL,
  review_state  TEXT NOT NULL DEFAULT 'reviewed', -- reviewed|unreviewed|malware
  published_at  TEXT,                    -- 公開月の新規件数に使う
  modified_at   TEXT,                    -- 更新追跡。新規件数には加算しない
  withdrawn_at  TEXT,                    -- 撤回。新規件数から除外する
  first_seen_at TEXT NOT NULL,           -- observed_at: 把握した時点
  last_seen_at  TEXT NOT NULL,
  origin        TEXT NOT NULL,           -- 'github' | 'osv' | 'manual'
  html_url      TEXT,
  taxonomy_version TEXT,
  category_id   TEXT,                    -- 主分類（積み上げ図では 1 件 1 分類）
  registry_version TEXT
);
CREATE INDEX IF NOT EXISTS idx_adv_published ON advisories (published_at);
CREATE INDEX IF NOT EXISTS idx_adv_first_seen ON advisories (first_seen_at);

-- 明示 alias でのみ照合する（related は同一性の根拠にしない）
CREATE TABLE IF NOT EXISTS advisory_aliases (
  alias    TEXT NOT NULL,
  ghsa_id  TEXT NOT NULL REFERENCES advisories(ghsa_id) ON DELETE CASCADE,
  PRIMARY KEY (alias, ghsa_id)
);
CREATE INDEX IF NOT EXISTS idx_alias_ghsa ON advisory_aliases (ghsa_id);

-- 1 advisory が複数パッケージに影響する場合、全体件数は 1、パッケージ別は各 1
CREATE TABLE IF NOT EXISTS advisory_packages (
  ghsa_id          TEXT NOT NULL REFERENCES advisories(ghsa_id) ON DELETE CASCADE,
  package_name     TEXT NOT NULL,
  ecosystem        TEXT NOT NULL DEFAULT 'npm',
  vulnerable_range TEXT,
  patched_version  TEXT,
  PRIMARY KEY (ghsa_id, package_name, ecosystem)
);
CREATE INDEX IF NOT EXISTS idx_advpkg_name ON advisory_packages (package_name);

CREATE TABLE IF NOT EXISTS advisory_cwes (
  ghsa_id TEXT NOT NULL REFERENCES advisories(ghsa_id) ON DELETE CASCADE,
  cwe_id  TEXT NOT NULL,                 -- 全 CWE は明細に残す
  ordinal INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ghsa_id, cwe_id)
);

-- advisory の変更履歴（更新・撤回・重大度変更を追跡する）
CREATE TABLE IF NOT EXISTS advisory_revisions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ghsa_id      TEXT NOT NULL,
  observed_at  TEXT NOT NULL,
  modified_at  TEXT,
  withdrawn_at TEXT,
  severity     TEXT,
  content_hash TEXT NOT NULL,
  run_id       TEXT NOT NULL,
  UNIQUE (ghsa_id, content_hash)
);

-- ---------------------------------------------------------------------------
-- 通常の不具合（Issue）。全状態で取り込み、後から判定する
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS issues (
  repository    TEXT NOT NULL,
  number        INTEGER NOT NULL,
  package_name  TEXT NOT NULL,
  title         TEXT NOT NULL DEFAULT '',
  state         TEXT NOT NULL,           -- open|closed
  state_reason  TEXT,                    -- completed|not_planned|reopened|null
  is_pull_request INTEGER NOT NULL DEFAULT 0, -- PR は除外する
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  closed_at     TEXT,
  labels        TEXT NOT NULL DEFAULT '[]', -- JSON 配列。ラベル削除も反映する
  bug_state     TEXT NOT NULL DEFAULT 'reported', -- reported|confirmed|duplicate|invalid
  is_bug        INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  html_url      TEXT,
  PRIMARY KEY (repository, number)
);
CREATE INDEX IF NOT EXISTS idx_issue_created ON issues (created_at);
CREATE INDEX IF NOT EXISTS idx_issue_pkg ON issues (package_name, created_at);

-- 月末未解決数のための状態遷移履歴（close ≠ 修正、再オープンも残す）
CREATE TABLE IF NOT EXISTS issue_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  repository  TEXT NOT NULL,
  number      INTEGER NOT NULL,
  event       TEXT NOT NULL,             -- opened|closed|reopened|labeled|unlabeled
  detail      TEXT,
  occurred_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  UNIQUE (repository, number, event, detail, occurred_at)
);

-- ---------------------------------------------------------------------------
-- 自システムへの影響（npm audit：診断対象・実行時点ごとの結果）
-- 公開報告数とは別指標なので、advisories とは合算しない。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_snapshots (
  snapshot_id  TEXT PRIMARY KEY,
  target       TEXT NOT NULL,            -- 診断対象（プロジェクト名など）
  executed_at  TEXT NOT NULL,
  tool         TEXT NOT NULL DEFAULT 'npm audit',
  total        INTEGER NOT NULL DEFAULT 0,
  critical     INTEGER NOT NULL DEFAULT 0,
  high         INTEGER NOT NULL DEFAULT 0,
  moderate     INTEGER NOT NULL DEFAULT 0,
  low          INTEGER NOT NULL DEFAULT 0,
  raw_id       INTEGER REFERENCES raw_documents(id)
);
CREATE TABLE IF NOT EXISTS audit_findings (
  snapshot_id  TEXT NOT NULL REFERENCES audit_snapshots(snapshot_id) ON DELETE CASCADE,
  package_name TEXT NOT NULL,
  severity     TEXT NOT NULL,
  ghsa_id      TEXT,
  via          TEXT,
  PRIMARY KEY (snapshot_id, package_name, severity, ghsa_id)
);

-- ---------------------------------------------------------------------------
-- 収集の可用性（欠測と 0 を区別するために月ごとの収集可否を残す）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coverage (
  source     TEXT NOT NULL,
  scope      TEXT NOT NULL,             -- package 名 / 'npm-all'
  month      TEXT NOT NULL,             -- 'YYYY-MM' (UTC)
  status     TEXT NOT NULL,             -- 'collected' | 'missing' | 'partial'
  note       TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source, scope, month)
);

-- ---------------------------------------------------------------------------
-- 版の記録（対象台帳・分類・alias 統合ルールにも版を付ける）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rule_versions (
  kind       TEXT NOT NULL,             -- 'registry' | 'taxonomy'
  version    TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  PRIMARY KEY (kind, version)
);
