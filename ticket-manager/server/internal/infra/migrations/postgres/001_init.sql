-- Ticket Manager initial schema (PostgreSQL).
-- Cumulative schema with start_at / end_at, ticket_id link on calendar_events,
-- and nullable ticket_id on time_entries from the start.

CREATE TABLE IF NOT EXISTS tickets (
    id              VARCHAR(64)  PRIMARY KEY,
    parent_id       VARCHAR(64),
    title           VARCHAR(512) NOT NULL,
    description     TEXT         NOT NULL DEFAULT '',
    type            VARCHAR(16)  NOT NULL,
    status          VARCHAR(16)  NOT NULL,
    assignee        VARCHAR(128),
    estimate_hours  DOUBLE PRECISION,
    due_date        DATE,
    repository_id   VARCHAR(64),
    branch          VARCHAR(255),
    created_at      TIMESTAMP    NOT NULL,
    updated_at      TIMESTAMP    NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
    name        VARCHAR(128) PRIMARY KEY,
    created_at  TIMESTAMP    NOT NULL
);

CREATE TABLE IF NOT EXISTS ticket_tags (
    ticket_id  VARCHAR(64)  NOT NULL,
    tag_name   VARCHAR(128) NOT NULL,
    PRIMARY KEY (ticket_id, tag_name)
);

CREATE TABLE IF NOT EXISTS time_entries (
    id          VARCHAR(64)   PRIMARY KEY,
    ticket_id   VARCHAR(64),
    user_name   VARCHAR(128)  NOT NULL DEFAULT '',
    hours       DOUBLE PRECISION NOT NULL,
    work_date   DATE          NOT NULL,
    start_at    TIMESTAMP,
    end_at      TIMESTAMP,
    note        TEXT          NOT NULL DEFAULT '',
    created_at  TIMESTAMP     NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_events (
    id           VARCHAR(64)  PRIMARY KEY,
    title        VARCHAR(512) NOT NULL,
    description  TEXT         NOT NULL DEFAULT '',
    start_date   DATE         NOT NULL,
    end_date     DATE,
    start_at     TIMESTAMP,
    end_at       TIMESTAMP,
    ticket_id    VARCHAR(64),
    created_at   TIMESTAMP    NOT NULL
);

CREATE TABLE IF NOT EXISTS repositories (
    id              VARCHAR(64)  PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    path            VARCHAR(1024) NOT NULL,
    default_branch  VARCHAR(255) NOT NULL DEFAULT 'main',
    created_at      TIMESTAMP    NOT NULL
);
