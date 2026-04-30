-- Ticket Manager initial schema (MySQL / MariaDB).
-- Cumulative schema. MySQL VARCHAR requires a length and DATETIME is preferred
-- over TIMESTAMP for application-set wall-clock timestamps.

CREATE TABLE IF NOT EXISTS tickets (
    id              VARCHAR(64)  NOT NULL PRIMARY KEY,
    parent_id       VARCHAR(64)  NULL,
    title           VARCHAR(512) NOT NULL,
    description     VARCHAR(2048) NOT NULL DEFAULT '',
    type            VARCHAR(16)  NOT NULL,
    status          VARCHAR(16)  NOT NULL,
    assignee        VARCHAR(128) NULL,
    estimate_hours  DOUBLE       NULL,
    due_date        DATE         NULL,
    repository_id   VARCHAR(64)  NULL,
    branch          VARCHAR(255) NULL,
    created_at      DATETIME     NOT NULL,
    updated_at      DATETIME     NOT NULL
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tags (
    name        VARCHAR(128) NOT NULL PRIMARY KEY,
    created_at  DATETIME     NOT NULL
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ticket_tags (
    ticket_id  VARCHAR(64)  NOT NULL,
    tag_name   VARCHAR(128) NOT NULL,
    PRIMARY KEY (ticket_id, tag_name)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS time_entries (
    id          VARCHAR(64)   NOT NULL PRIMARY KEY,
    ticket_id   VARCHAR(64)   NULL,
    user_name   VARCHAR(128)  NOT NULL DEFAULT '',
    hours       DOUBLE        NOT NULL,
    work_date   DATE          NOT NULL,
    start_at    DATETIME      NULL,
    end_at      DATETIME      NULL,
    note        VARCHAR(2048) NOT NULL DEFAULT '',
    created_at  DATETIME      NOT NULL
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS calendar_events (
    id           VARCHAR(64)   NOT NULL PRIMARY KEY,
    title        VARCHAR(512)  NOT NULL,
    description  VARCHAR(2048) NOT NULL DEFAULT '',
    start_date   DATE          NOT NULL,
    end_date     DATE          NULL,
    start_at     DATETIME      NULL,
    end_at       DATETIME      NULL,
    ticket_id    VARCHAR(64)   NULL,
    created_at   DATETIME      NOT NULL
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS repositories (
    id              VARCHAR(64)   NOT NULL PRIMARY KEY,
    name            VARCHAR(255)  NOT NULL,
    path            VARCHAR(1024) NOT NULL,
    default_branch  VARCHAR(255)  NOT NULL DEFAULT 'main',
    created_at      DATETIME      NOT NULL
) DEFAULT CHARSET=utf8mb4;
