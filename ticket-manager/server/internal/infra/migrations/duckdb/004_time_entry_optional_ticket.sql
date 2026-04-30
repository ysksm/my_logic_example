-- 工数 (time_entries) のチケット紐付けを任意に。
-- 既存の NOT NULL 制約を緩める。

ALTER TABLE time_entries ALTER COLUMN ticket_id DROP NOT NULL;
