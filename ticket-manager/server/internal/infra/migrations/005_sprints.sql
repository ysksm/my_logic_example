-- スプリント (反復) と、チケットのスプリント割当て。
-- バックログ = sprint_id が NULL のチケット

CREATE TABLE IF NOT EXISTS sprints (
    id          VARCHAR PRIMARY KEY,
    name        VARCHAR NOT NULL,
    goal        VARCHAR DEFAULT '',
    state       VARCHAR NOT NULL,        -- PLANNED | ACTIVE | CLOSED
    start_date  DATE,
    end_date    DATE,
    created_at  TIMESTAMP NOT NULL
);

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sprint_id VARCHAR;
