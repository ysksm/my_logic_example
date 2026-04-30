-- 連番のチケット番号 (TICKET-1, TICKET-2, ...)。Git ブランチ名や
-- 表示用ラベルに使う。

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS number BIGINT;

WITH ordered AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS n
    FROM tickets WHERE number IS NULL
)
UPDATE tickets
SET number = ordered.n
FROM ordered
WHERE tickets.id = ordered.id;
