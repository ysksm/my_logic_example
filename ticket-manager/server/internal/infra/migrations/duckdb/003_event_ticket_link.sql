-- Optional ticket reference on calendar_events: lets a 予定 be tied to
-- a ticket (e.g. a meeting tracked alongside the issue it concerns).

ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS ticket_id VARCHAR;
