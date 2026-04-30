-- チケット連番 (MySQL / MariaDB 8.0+)。

ALTER TABLE tickets ADD COLUMN number BIGINT NULL;

UPDATE tickets t
JOIN (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS n
    FROM tickets WHERE number IS NULL
) o ON t.id = o.id
SET t.number = o.n;
