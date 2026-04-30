-- チケット連番 (PostgreSQL)。

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS number BIGINT;

WITH ordered AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS n
    FROM tickets WHERE number IS NULL
)
UPDATE tickets
SET number = ordered.n
FROM ordered
WHERE tickets.id = ordered.id;
