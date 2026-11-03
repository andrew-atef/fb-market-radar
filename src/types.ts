/**
 * TypeScript type definitions for the Facebook Supermarket Monitor Worker.
 * Strictly typed interfaces for Env, stores, API responses, and D1 rows.
 */

/** Environment bindings and secrets injected by Cloudflare Workers. */
export interface Env {
  DB: D1Database;
  /** Google Alerts Atom feed URL (secret) — free, keyless discovery source. */
  GOOGLE_ALERTS_FEED_URL: string;
  FB_PAGE_ID: string;
  FB_PAGE_ACCESS_TOKEN: string;
  DASHBOARD_AUTH_KEY: string;
  /** GitHub Personal Access Token with repo or actions:write permissions. */
  GITHUB_TOKEN?: string;
  /** GitHub repository in "owner/repo" format. Defaults to "andrew-atef/fb-market-radar". */
  GITHUB_REPO?: string;
  /** Target branch to dispatch. Defaults to "main". */
  GITHUB_BRANCH?: string;
}

/** Configured Egyptian supermarket stores to monitor on Facebook. */
export interface StoreConfig {
  name: string;
  facebookPage: string;
}

/** A fully-mapped item from the Google Alerts Atom feed (pipeline-ready). */
export interface AlertsFeedItem {
  /** Numeric Google Alerts entry ID (stable per entry). */
  entryId: string;
  /** Facebook post ID extracted from the decoded post URL. */
  postId: string;
  /** Store display name mapped from the Facebook page slug. */
  storeName: string;
  /** Raw Facebook page slug (e.g. "SpinneysEgypt"). */
  storeSlug: string;
  /** Decoded real Facebook post URL (query strings stripped). */
  postUrl: string;
  /** Google Alerts entry title (" - Facebook" suffix removed). */
  title: string;
  /** Feed content snippet (whitespace-collapsed). */
  snippet: string;
  /** Post age in minutes at Google's crawl time (null when unknown). */
  ageMinutes: number | null;
  /** Raw age marker text (e.g. "22m") for debugging. */
  ageMarkerRaw: string | null;
}

/** Result of processing a single newly discovered post. */
export interface NewPostResult {
  post_id: string;
  store_name: string;
  post_url: string;
  post_title: string;
  post_snippet: string;
  shared_post_id: string | null;
  images: string[];
}

/** Summary of a sync run. */
export interface SyncResult {
  stores_checked: number;
  new_posts_found: number;
  status: "SUCCESS" | "ERROR";
  error_message: string | null;
}

/** Aggregated statistics for the admin dashboard. */
export interface DashboardStats {
  total_posts: number;
  new_posts_today: number;
  last_sync_time: string | null;
  db_health: "healthy" | "error";
  /** Average discovery latency (minutes) over the last 24h; null if none. */
  avg_latency_24h: number | null;
}

/** A row from the `posts` D1 table. */
export interface PostRow {
  id: number;
  post_id: string;
  store_name: string;
  post_url: string;
  post_title: string | null;
  post_snippet: string | null;
  shared_post_id: string | null;
  images_json: string | null;
  post_published_at: string | null;
  post_age_index_minutes: number | null;
  latency_minutes: number | null;
  discovered_at: string;
}

/** A row from the `sync_logs` D1 table. */
export interface SyncLogRow {
  id: number;
  run_at: string;
  stores_checked: number;
  new_posts_found: number;
  status: string;
  error_message: string | null;
}

/** Ingest payload sent by the GitHub Actions radar scraper (POST /api/hook). */
export interface RadarHookPayload {
  /** Facebook page slug the post was scraped from (e.g. "kazyonegypt"). */
  retailerSlug: string;
  /** Numeric Facebook post ID ("1582809850544586") or pfbid token. */
  postId: string;
  /** Full post caption text decoded from the SSR Relay JSON (optional). */
  postText?: string | null;
  /** Master-quality scontent image URLs extracted from the SSR HTML. */
  imageUrls?: string[] | null;
  /** Exact publish time in ISO format derived from "creation_time". */
  publishedAt?: string | null;
}

/** JSON payload for the /api/sync response. */
export interface SyncApiResponse {
  status: "SUCCESS" | "ERROR";
  stores_checked: number;
  new_posts_found: number;
  error_message: string | null;
}