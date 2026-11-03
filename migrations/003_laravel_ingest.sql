-- Migration 003: Laravel ingestion integration
-- Tracks whether posts have been forwarded to the Laravel backend and the response status.

ALTER TABLE posts ADD COLUMN forwarded_to_laravel INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN laravel_status TEXT DEFAULT 'Local Only';

CREATE INDEX IF NOT EXISTS idx_posts_forwarded ON posts(forwarded_to_laravel);
