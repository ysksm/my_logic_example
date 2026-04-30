-- チケット連番 (SQLite)。SQLite 3.33+ の UPDATE ... FROM 構文を使う。

ALTER TABLE tickets ADD COLUMN number INTEGER;

WITH ordered AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS n
    FROM tickets WHERE number IS NULL
)
UPDATE tickets
SET number = ordered.n
FROM ordered
WHERE tickets.id = ordered.id;
