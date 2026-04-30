-- Optional intra-day timestamps so the calendar can show items on a weekly
-- view at 15-minute resolution. Existing rows keep work_date / start_date
-- and remain valid (start_at / end_at are nullable).

ALTER TABLE time_entries    ADD COLUMN IF NOT EXISTS start_at TIMESTAMP;
ALTER TABLE time_entries    ADD COLUMN IF NOT EXISTS end_at   TIMESTAMP;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS start_at TIMESTAMP;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS end_at   TIMESTAMP;
