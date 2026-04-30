-- "user" は MySQL などで予約語のためマルチ DB 対応にあたり time_entries.user
-- を user_name に正規化する。既存の DuckDB DB はこのマイグレーションでリネーム
-- される。新規 DB は migrations/duckdb/001_init.sql 側でも user_name に揃えた
-- 上で、まだ "user" が残っている既存環境にだけ ALTER が効く形にしている。

ALTER TABLE time_entries RENAME COLUMN "user" TO user_name;
