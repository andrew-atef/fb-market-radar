-- Cloudflare D1 Schema for Facebook Supermarket Monitor
-- Apply with: wrangler d1 execute facebook-monitor-db --file=schema.sql

-- Table: posts
-- Stores every discovered Facebook post, whether it was shared, and
-- the extracted image subattachment URLs.
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT UNIQUE NOT NULL,
  store_name TEXT NOT NULL,
  post_url TEXT NOT NULL,
  post_title TEXT,
  post_snippet TEXT,
  shared_post_id TEXT,
  images_json TEXT,
  -- Google Alerts latency intelligence (migration 002)
  post_published_at DATETIME,
  post_age_index_minutes INTEGER,
  latency_minutes INTEGER,
  forwarded_to_laravel INTEGER DEFAULT 0,
  laravel_status TEXT DEFAULT 'Local Only',
  discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_posts_post_id ON posts(post_id);
CREATE INDEX IF NOT EXISTS idx_posts_store_name ON posts(store_name);
CREATE INDEX IF NOT EXISTS idx_posts_discovered_at ON posts(discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_forwarded ON posts(forwarded_to_laravel);

-- Table: sync_logs
-- Audit trail of every cron / manual sync run.
CREATE TABLE IF NOT EXISTS sync_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  stores_checked INTEGER NOT NULL DEFAULT 0,
  new_posts_found INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'ERROR')),
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_logs_run_at ON sync_logs(run_at DESC);