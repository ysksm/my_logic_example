-- スプリント (反復) と、チケットのスプリント割当て (MySQL / MariaDB)。

CREATE TABLE IF NOT EXISTS sprints (
    id          VARCHAR(64)  NOT NULL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    goal        VARCHAR(2048) NOT NULL DEFAULT '',
    state       VARCHAR(16)  NOT NULL,
    start_date  DATE         NULL,
    end_date    DATE         NULL,
    created_at  DATETIME     NOT NULL
) DEFAULT CHARSET=utf8mb4;

ALTER TABLE tickets ADD COLUMN sprint_id VARCHAR(64) NULL;
