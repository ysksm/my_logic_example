-- Ticket Manager initial schema (SQLite).
-- Cumulative schema: includes the optional intra-day timestamps (start_at /
-- end_at), the calendar_events.ticket_id link, and a nullable
-- time_entries.ticket_id from the start. SQLite's ALTER TABLE is limited so
-- we keep a single forward migration rather than splitting per feature.

CREATE TABLE IF NOT EXISTS tickets (
    id              TEXT PRIMARY KEY,
    parent_id       TEXT,
    title           TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    type            TEXT NOT NULL,
    status          TEXT NOT NULL,
    assignee        TEXT,
    estimate_hours  REAL,
    due_date        DATE,
    repository_id   TEXT,
    branch          TEXT,
    created_at      TIMESTAMP NOT NULL,
    updated_at      TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
    name        TEXT PRIMARY KEY,
    created_at  TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS ticket_tags (
    ticket_id  TEXT NOT NULL,
    tag_name   TEXT NOT NULL,
    PRIMARY KEY (ticket_id, tag_name)
);

CREATE TABLE IF NOT EXISTS time_entries (
    id          TEXT PRIMARY KEY,
    ticket_id   TEXT,
    user_name   TEXT NOT NULL DEFAULT '',
    hours       REAL NOT NULL,
    work_date   DATE NOT NULL,
    start_at    TIMESTAMP,
    end_at      TIMESTAMP,
    note        TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_events (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    start_date   DATE NOT NULL,
    end_date     DATE,
    start_at     TIMESTAMP,
    end_at       TIMESTAMP,
    ticket_id    TEXT,
    created_at   TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS repositories (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    path            TEXT NOT NULL,
    default_branch  TEXT NOT NULL DEFAULT 'main',
    created_at      TIMESTAMP NOT NULL
);
