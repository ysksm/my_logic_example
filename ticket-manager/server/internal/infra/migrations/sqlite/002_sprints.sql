-- スプリント (反復) と、チケットのスプリント割当て (SQLite)。

CREATE TABLE IF NOT EXISTS sprints (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    goal        TEXT NOT NULL DEFAULT '',
    state       TEXT NOT NULL,
    start_date  DATE,
    end_date    DATE,
    created_at  TIMESTAMP NOT NULL
);

ALTER TABLE tickets ADD COLUMN sprint_id TEXT;
