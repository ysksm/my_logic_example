-- Ticket Manager initial schema (DuckDB)

CREATE TABLE IF NOT EXISTS tickets (
    id              VARCHAR PRIMARY KEY,
    parent_id       VARCHAR,
    title           VARCHAR NOT NULL,
    description     VARCHAR DEFAULT '',
    type            VARCHAR NOT NULL,        -- EPIC | STORY | TASK | SUBTASK
    status          VARCHAR NOT NULL,        -- TODO | IN_PROGRESS | DONE
    assignee        VARCHAR,
    estimate_hours  DOUBLE,
    due_date        DATE,
    repository_id   VARCHAR,
    branch          VARCHAR,
    created_at      TIMESTAMP NOT NULL,
    updated_at      TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
    name        VARCHAR PRIMARY KEY,
    created_at  TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS ticket_tags (
    ticket_id  VARCHAR NOT NULL,
    tag_name   VARCHAR NOT NULL,
    PRIMARY KEY (ticket_id, tag_name)
);

CREATE TABLE IF NOT EXISTS time_entries (
    id          VARCHAR PRIMARY KEY,
    ticket_id   VARCHAR NOT NULL,
    "user"      VARCHAR DEFAULT '',
    hours       DOUBLE  NOT NULL,
    work_date   DATE    NOT NULL,
    note        VARCHAR DEFAULT '',
    created_at  TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_events (
    id           VARCHAR PRIMARY KEY,
    title        VARCHAR NOT NULL,
    description  VARCHAR DEFAULT '',
    start_date   DATE NOT NULL,
    end_date     DATE,
    created_at   TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS repositories (
    id              VARCHAR PRIMARY KEY,
    name            VARCHAR NOT NULL,
    path            VARCHAR NOT NULL,
    default_branch  VARCHAR DEFAULT 'main',
    created_at      TIMESTAMP NOT NULL
);
