-- Migration 002: Google Alerts discovery source latency columns.
-- Adds post-timing intelligence derived from the Google Alerts feed:
--   post_published_at      — estimated original publish time (first_seen - age)
--   post_age_index_minutes — post age (minutes) at Google's crawl time
--   latency_minutes        — minutes from publish to discovery (approx = age)

ALTER TABLE posts ADD COLUMN post_published_at DATETIME;
ALTER TABLE posts ADD COLUMN post_age_index_minutes INTEGER;
ALTER TABLE posts ADD COLUMN latency_minutes INTEGER;

CREATE INDEX IF NOT EXISTS idx_posts_latency
  ON posts(latency_minutes)
  WHERE latency_minutes IS NOT NULL;
