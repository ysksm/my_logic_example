-- スプリント (反復) と、チケットのスプリント割当て (PostgreSQL)。

CREATE TABLE IF NOT EXISTS sprints (
    id          VARCHAR(64)  PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    goal        TEXT         NOT NULL DEFAULT '',
    state       VARCHAR(16)  NOT NULL,
    start_date  DATE,
    end_date    DATE,
    created_at  TIMESTAMP    NOT NULL
);

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sprint_id VARCHAR(64);
