/**
 * Facebook Supermarket Monitor — Cloudflare Worker (Modern Module Syntax)
 *
 * - Cron Trigger every 5 minutes: monitors 10 Egyptian supermarket
 *   Facebook pages via the free, keyless Google Alerts Atom feed,
 *   shares new posts to a Facebook Page via Meta Graph API v23.0,
 *   extracts image subattachments, and persists state in Cloudflare D1.
 * - Fetch handler: serves a dark-themed admin dashboard and JSON API
 *   endpoints (/api/stats, /api/posts, /api/logs, /api/sync).
 */

import { Env, SyncResult, SyncApiResponse, DashboardStats, RadarHookPayload } from "./types";
import {
  fetchAlertsFeedItems,
  SUPERMARKET_STORES,
} from "./services/alerts";
import {
  shareToFacebookPage,
  fetchPostAttachments,
  fetchOriginPostImages,
} from "./services/facebook";
import {
  renderDashboard,
  json,
  jsonError,
  requireAuth,
} from "./services/dashboard";
import { dispatchGitHubRadarWorkflow } from "./services/github";
import { forwardToLaravel, testLaravelIngest } from "./services/laravel";

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Formats a Date as a UTC "YYYY-MM-DD HH:MM:SS" string (D1 DATETIME). */
function toSqlDateTime(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

/**
 * Converts an ISO timestamp (from radar "creation_time") to a D1 DATETIME
 * string, or null when invalid.
 */
function isoToSqlDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return toSqlDateTime(new Date(ms));
}

/**
 * True radar latency in minutes: share time − creation_time.
 * Null when the timestamp is missing/unparseable, negative (clock skew),
 * or the post is older than 30 days — those would poison the average.
 */
function hookLatencyMinutes(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 0 || minutes > 43_200) return null;
  return minutes;
}


/**
 * Fetches the shared-post attachments with patient retries:
 * A link share's attachment graph on Meta's CDN may materialize shortly
 * after the feed POST returns, so we retry on empty results.
 */
async function fetchSharedImagesWithRetry(
  env: Env,
  sharedPostId: string,
  attempts = 4
): Promise<string[]> {
  const delaysMs = [500, 2000, 4000, 8000];
  for (let i = 0; i < attempts; i++) {
    if (delaysMs[i]) await new Promise((r) => setTimeout(r, delaysMs[i]));
    try {
      const imgs = await fetchPostAttachments(env, sharedPostId);
      if (imgs.length > 0) {
        console.log(
          `[hook] Extracted ${imgs.length} attachment images from shared post ${sharedPostId} on attempt ${i + 1}`
        );
        return imgs;
      }
    } catch (err) {
      console.error(
        `[hook] Attachment fetch attempt ${i + 1} failed for ${sharedPostId}:`,
        err
      );
    }
  }
  return [];
}


/* ------------------------------------------------------------------ */
/* Core Pipeline                                                      */
/* ------------------------------------------------------------------ */

/**
 * Runs a full sync cycle:
 *  1. Poll the Google Alerts Atom feed (single request covering all
 *     10 stores via the batched site:* OR query).
 *  2. For each new (not-yet-stored) post:
 *     a. Share to Facebook Page feed
 *     b. Fetch attachments / subattachments → image URLs
 *     c. Insert into D1 `posts` with latency intelligence:
 *        - post_published_at ≈ poll_time − post_age_at_crawl
 *        - latency_minutes   ≈ post_age_at_crawl  (crawl → discovery gap
 *          is bounded by the 5-minute cron interval)
 *  3. Write a summary row to `sync_logs`
 *
 * @returns SyncResult
 */
export async function runSyncPipeline(env: Env): Promise<SyncResult> {
  const storesChecked = 10; // number of configured supermarket stores
  let newPostsFound = 0;
  const IMAGE_BACKFILL_LIMIT_PER_RUN = 10;
  let imageBackfills = 0;

  try {
    // --- Step 1: Poll the Google Alerts feed ---
    const pollTime = new Date();
    const items = await fetchAlertsFeedItems(env);

    for (const item of items) {
      // --- Step 2a: Skip already-stored posts (with image backfill) ---
      const existing = await env.DB
        .prepare("SELECT id, images_json FROM posts WHERE post_id = ?")
        .bind(item.postId)
        .first<{ id: number; images_json: string | null }>();

      if (existing) {
        // Older posts were stored before origin-image extraction existed.
        // Backfill their images (capped per run to keep the sync snappy).
        let storedImages: string[] = [];
        try {
          storedImages = existing.images_json
            ? (JSON.parse(existing.images_json) as string[])
            : [];
        } catch {
          storedImages = [];
        }

        if (storedImages.length === 0 && imageBackfills < IMAGE_BACKFILL_LIMIT_PER_RUN) {
          imageBackfills++;
          try {
            const imgs = await fetchOriginPostImages(env, item.postUrl);
            if (imgs.length > 0) {
              await env.DB
                .prepare("UPDATE posts SET images_json = ? WHERE id = ?")
                .bind(JSON.stringify(imgs), existing.id)
                .run();
            }
          } catch (backfillErr) {
            console.error(
              `[backfill] Failed to fetch origin images for ${item.postId}:`,
              backfillErr
            );
          }
        }

        continue;
      }

      // --- Step 2b: Share to Facebook Page ---
      const message = `عروض جديدة من ${item.storeName} 🛒🔥\n\n${item.snippet}`;
      let sharedPostId: string | null = null;

      try {
        sharedPostId = await shareToFacebookPage(env, item.postUrl, message);
      } catch (shareErr) {
        console.error(
          `[share] Failed to share post ${item.postId} (${item.storeName}):`,
          shareErr
        );
        // Continue — we still record the post even if sharing failed.
      }

      // --- Step 2c: Extract images ---
      // Primary: Graph API attachments from our own shared post (subattachments/photos).
      // Fallback: OpenGraph meta tag from the supermarket's original post.
      let images: string[] = [];

      if (sharedPostId) {
        try {
          images = await fetchSharedImagesWithRetry(env, sharedPostId);
        } catch (attachErr) {
          console.error(
            `[attachments] Failed to fetch attachments for shared post ${sharedPostId}:`,
            attachErr
          );
        }
      }

      if (images.length === 0) {
        try {
          images = await fetchOriginPostImages(env, item.postUrl);
        } catch (originErr) {
          console.error(
            `[attachments] Failed to fetch origin attachments for ${item.postId} (${item.storeName}):`,
            originErr
          );
        }
      }

      // --- Step 2d: Latency intelligence + insert into D1 ---
      // post_published_at = poll_time − age_at_crawl (± the minute-level
      // rounding Facebook uses for relative ages). Entries without an age
      // marker (or implausibly old backfill) keep null published_at.
      const ageMinutes = item.ageMinutes;
      const isBackfill = ageMinutes !== null && ageMinutes > 720; // > 12h
      const postPublishedAt =
        ageMinutes !== null && !isBackfill
          ? toSqlDateTime(new Date(pollTime.getTime() - ageMinutes * 60_000))
          : null;

      const matchedStore = SUPERMARKET_STORES.find(
        (s) =>
          s.slug.toLowerCase() === item.storeSlug.toLowerCase() ||
          s.handle.toLowerCase() === item.storeSlug.toLowerCase() ||
          (s.facebookPage && s.facebookPage.toLowerCase() === item.storeSlug.toLowerCase())
      );
      const laravelSlug = matchedStore?.slug || item.storeSlug;

      let forwardedToLaravel = 0;
      let laravelStatus = "Local Only";
      if (env.LARAVEL_INGEST_URL) {
        try {
          const laravelRes = await forwardToLaravel(env, {
            retailerSlug: laravelSlug,
            postId: item.postId,
            postText: item.snippet || item.title || "",
            imageUrls: images,
            publishedAt: postPublishedAt,
          });
          forwardedToLaravel = laravelRes.forwarded ? 1 : 0;
          laravelStatus = laravelRes.statusText;
        } catch (lErr) {
          console.error(`[sync-pipeline] Laravel forward error:`, lErr);
          laravelStatus = "Error";
        }
      }

      await env.DB
        .prepare(
          `INSERT INTO posts (
            post_id, store_name, post_url, post_title, post_snippet,
            shared_post_id, images_json,
            post_published_at, post_age_index_minutes, latency_minutes,
            forwarded_to_laravel, laravel_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          item.postId,
          item.storeName,
          item.postUrl,
          item.title || null,
          item.snippet || null,
          sharedPostId,
          JSON.stringify(images),
          postPublishedAt,
          ageMinutes,
          ageMinutes !== null && !isBackfill ? ageMinutes : null,
          forwardedToLaravel,
          laravelStatus
        )
        .run();

      newPostsFound++;
    }

    // --- Step 3: Log success ---
    await env.DB
      .prepare(
        `INSERT INTO sync_logs (stores_checked, new_posts_found, status)
         VALUES (?, ?, 'SUCCESS')`
      )
      .bind(storesChecked, newPostsFound)
      .run();

    return {
      stores_checked: storesChecked,
      new_posts_found: newPostsFound,
      status: "SUCCESS",
      error_message: null,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Log the error run
    try {
      await env.DB
        .prepare(
          `INSERT INTO sync_logs (stores_checked, new_posts_found, status, error_message)
           VALUES (?, ?, 'ERROR', ?)`
        )
        .bind(storesChecked, newPostsFound, errorMessage)
        .run();
    } catch (logErr) {
      console.error("[sync_logs] Failed to write error log:", logErr);
    }

    return {
      stores_checked: storesChecked,
      new_posts_found: newPostsFound,
      status: "ERROR",
      error_message: errorMessage,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Dashboard / API Data Helpers                                       */
/* ------------------------------------------------------------------ */

/** Fetch aggregated dashboard statistics from D1. */
async function getDashboardStats(env: Env): Promise<DashboardStats> {
  // Total posts
  const totalRow = await env.DB
    .prepare("SELECT COUNT(*) AS c FROM posts")
    .first<{ c: number }>();
  const totalPosts = totalRow?.c ?? 0;

  // New posts today (UTC date)
  const todayRow = await env.DB
    .prepare(
      `SELECT COUNT(*) AS c FROM posts
       WHERE date(discovered_at) = date('now')`
    )
    .first<{ c: number }>();
  const newPostsToday = todayRow?.c ?? 0;

  // Last sync time
  const lastSyncRow = await env.DB
    .prepare(
      `SELECT run_at FROM sync_logs ORDER BY run_at DESC LIMIT 1`
    )
    .first<{ run_at: string }>();
  const lastSyncTime = lastSyncRow?.run_at ?? null;

  // Average discovery latency over the last 24h (minutes).
  // Nulls (entries without an age marker) and backfill entries (>12h)
  // are excluded so the average stays honest.
  const latencyRow = await env.DB
    .prepare(
      `SELECT AVG(latency_minutes) AS avg_latency FROM posts
       WHERE latency_minutes IS NOT NULL
         AND latency_minutes <= 1440
         AND discovered_at >= datetime('now', '-1 day')`
    )
    .first<{ avg_latency: number | null }>();
  const avgLatency =
    latencyRow?.avg_latency !== null && latencyRow?.avg_latency !== undefined
      ? Math.round(latencyRow.avg_latency)
      : null;

  // DB health: try a trivial query
  let dbHealth: "healthy" | "error" = "healthy";
  try {
    await env.DB.prepare("SELECT 1").run();
  } catch {
    dbHealth = "error";
  }

  return {
    total_posts: totalPosts,
    new_posts_today: newPostsToday,
    last_sync_time: lastSyncTime,
    db_health: dbHealth,
    avg_latency_24h: avgLatency,
  };
}

/** Fetch recent posts (newest first), limited to 100. */
async function getRecentPosts(env: Env): Promise<Array<Record<string, unknown>>> {
  const result = await env.DB
    .prepare(
      `SELECT id, post_id, store_name, post_url, post_title, post_snippet,
              shared_post_id, images_json,
              post_published_at, post_age_index_minutes, latency_minutes,
              forwarded_to_laravel, laravel_status,
              discovered_at
       FROM posts
       ORDER BY discovered_at DESC
       LIMIT 100`
    )
    .all<Record<string, unknown>>();
  return result.results ?? [];
}

/** Fetch the last 10 sync logs (newest first). */
async function getSyncLogs(env: Env): Promise<Array<Record<string, unknown>>> {
  const result = await env.DB
    .prepare(
      `SELECT id, run_at, stores_checked, new_posts_found, status, error_message
       FROM sync_logs
       ORDER BY run_at DESC
       LIMIT 10`
    )
    .all<Record<string, unknown>>();
  return result.results ?? [];
}

/* ------------------------------------------------------------------ */
/* Fetch Router                                                       */
/* ------------------------------------------------------------------ */

/**
 * Handles HTTP requests: dashboard page + JSON API endpoints.
 * All API endpoints require the DASHBOARD_AUTH_KEY via ?key= or Bearer.
 */
async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  // Normalize path: strip trailing slashes, keep "/" for root
  const path = url.pathname.replace(/\/+$/, "") || "/";

  // Favicon: return empty response to silence browser console errors
  if (path === "/favicon.ico") {
    return new Response(null, { status: 204 });
  }

  // Root / dashboard page
  if (path === "/" || path === "/dashboard") {
    const key = url.searchParams.get("key");
    if (!key || key !== env.DASHBOARD_AUTH_KEY) {
      return new Response("Unauthorized", { status: 401 });
    }
    const html = renderDashboard(); // shell is self-fetching via JS
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // API routes require auth
  const authErr = requireAuth(request, env);
  if (authErr) return authErr;

  // POST /api/hook — ingest endpoint for the GitHub Actions radar scraper.
  // Scenario: scraper runs on Ubuntu via WARP SOCKS5 proxy, extracts guest-SSR
  // post intelligence (exact creation_time + master images), and pushes it here.
  // Responsibilities: auth → validate → dedupe vs D1 → share via Graph API →
  // persist with true publish time → report outcome.
  if (path === "/api/hook" && request.method === "POST") {
    const raw = await request.json().catch(() => null);
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return jsonError("Invalid JSON body", 400);
    }
    const payload = raw as RadarHookPayload;

    const postId =
      typeof payload.postId === "string" ? payload.postId.trim() : "";
    const slug =
      typeof payload.retailerSlug === "string"
        ? payload.retailerSlug.trim()
        : "";

    if (!postId || !slug) {
      return jsonError("Fields 'retailerSlug' and 'postId' are required", 400);
    }

    const store = SUPERMARKET_STORES.find(
      (s) =>
        s.slug.toLowerCase() === slug.toLowerCase() ||
        s.handle.toLowerCase() === slug.toLowerCase() ||
        (s.facebookPage && s.facebookPage.toLowerCase() === slug.toLowerCase())
    );
    if (!store) {
      return jsonError(`Unknown store slug: ${slug}`, 400);
    }

    // --- Dedupe against D1 (numeric post_id or pfbid token) ---
    // If already exists, return status: 'DUPLICATE' to prevent calling Laravel and wasting Gemini AI quota
    const existing = await env.DB
      .prepare(
        "SELECT id, shared_post_id, images_json, forwarded_to_laravel, laravel_status FROM posts WHERE post_id = ?"
      )
      .bind(postId)
      .first<{
        id: number;
        shared_post_id: string | null;
        images_json: string | null;
        forwarded_to_laravel: number | null;
        laravel_status: string | null;
      }>();

    if (existing) {
      // Backfill: upgrade previously-stored posts that have a shared post
      // but no canonical Graph attachment images yet.
      let storedImages: string[] = [];
      try {
        storedImages = existing.images_json
          ? (JSON.parse(existing.images_json) as string[])
          : [];
      } catch {
        storedImages = [];
      }

      if (existing.shared_post_id && storedImages.length === 0) {
        try {
          const graphImages = await fetchPostAttachments(
            env,
            existing.shared_post_id
          );
          await env.DB
            .prepare("UPDATE posts SET images_json = ? WHERE id = ?")
            .bind(JSON.stringify(graphImages.slice(0, 30)), existing.id)
            .run();
          return json({
            status: "DUPLICATE",
            success: true,
            duplicate: true,
            postId,
            sharedPostId: existing.shared_post_id,
            imagesBackfilled: graphImages.length,
            forwardedToLaravel: Boolean(existing.forwarded_to_laravel),
            laravelStatus: existing.laravel_status || "Local Only",
          });
        } catch (backfillErr) {
          console.error(
            `[hook] Image backfill failed for ${postId}:`,
            backfillErr
          );
        }
      }

      return json({
        status: "DUPLICATE",
        success: true,
        duplicate: true,
        postId,
        sharedPostId: existing.shared_post_id,
        forwardedToLaravel: Boolean(existing.forwarded_to_laravel),
        laravelStatus: existing.laravel_status || "Local Only",
      });
    }

    // --- Share to the user's Facebook Page ---
    const handle = store.handle || store.facebookPage;
    const postUrl = `https://www.facebook.com/${handle}/posts/${postId}`;
    const postText =
      typeof payload.postText === "string" ? payload.postText.trim() : "";
    const message = `عروض جديدة من ${store.name} 🛒🔥\n\n${postText}`;

    let sharedPostId: string | null = null;
    try {
      sharedPostId = await shareToFacebookPage(env, postUrl, message);
    } catch (shareErr) {
      console.error(
        `[hook] Failed to share post ${postId} (${store.name}):`,
        shareErr
      );
      // Still record the post — repro de-dupe must hold even if sharing failed.
    }

    // --- Image pipeline ---
    // Canonical source: the Graph API attachment graph of OUR OWN shared
    // post (`fields=attachments,child_attachments`). This extracts the full
    // album/subattachments directly from Facebook. If present, these are the
    // exact, official photos of the post/album.
    // The SSR master URLs extracted by the scraper act only as fallback.
    const ssrImages = Array.isArray(payload.imageUrls)
      ? payload.imageUrls
          .filter(
            (u): u is string => typeof u === "string" && u.startsWith("http")
          )
          .slice(0, 80)
      : [];

    let images: string[] = [];
    let imageSource = "none";

    if (sharedPostId) {
      const graphImages = await fetchSharedImagesWithRetry(env, sharedPostId);
      if (graphImages.length > 0) {
        images = graphImages;
        imageSource = "graph-attachments";
      } else if (ssrImages.length > 0) {
        images = ssrImages;
        imageSource = "ssr-fallback";
      }
    } else if (ssrImages.length > 0) {
      images = ssrImages;
      imageSource = "ssr-fallback";
    }

    const publishedSql = isoToSqlDateTime(payload.publishedAt ?? null);
    const latency = hookLatencyMinutes(payload.publishedAt ?? null);

    // --- Forward to Laravel backend ingestion API ---
    const laravelRes = await forwardToLaravel(env, {
      retailerSlug: store.slug, // exact database slug (e.g. "kazyon", "bimmisr")
      postId,
      postText: postText || "",
      imageUrls: images.length > 0 ? images : (ssrImages.length > 0 ? ssrImages : []),
      publishedAt: payload.publishedAt || null,
    });

    const forwardedToLaravel = laravelRes.forwarded ? 1 : 0;
    const laravelStatus = laravelRes.statusText;

    await env.DB
      .prepare(
        `INSERT INTO posts (
          post_id, store_name, post_url, post_title, post_snippet,
          shared_post_id, images_json,
          post_published_at, post_age_index_minutes, latency_minutes,
          forwarded_to_laravel, laravel_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        postId,
        store.name,
        postUrl,
        null,
        postText || null,
        sharedPostId,
        JSON.stringify(images),
        publishedSql,
        null,
        latency,
        forwardedToLaravel,
        laravelStatus
      )
      .run();

    return json({
      status: "SUCCESS",
      success: true,
      duplicate: false,
      postId,
      sharedPostId,
      imageCount: images.length,
      imageSource,
      latencyMinutes: latency,
      forwardedToLaravel: Boolean(forwardedToLaravel),
      laravelStatus,
    });
  }

  // GET /api/stats
  if (path === "/api/stats" && request.method === "GET") {
    try {
      const stats = await getDashboardStats(env);
      return json(stats);
    } catch (err) {
      return jsonError(
        err instanceof Error ? err.message : "Failed to load stats",
        500
      );
    }
  }

  // GET /api/posts
  if (path === "/api/posts" && request.method === "GET") {
    try {
      const posts = await getRecentPosts(env);
      return json(posts);
    } catch (err) {
      return jsonError(
        err instanceof Error ? err.message : "Failed to load posts",
        500
      );
    }
  }

  // GET /api/logs
  if (path === "/api/logs" && request.method === "GET") {
    try {
      const logs = await getSyncLogs(env);
      return json(logs);
    } catch (err) {
      return jsonError(
        err instanceof Error ? err.message : "Failed to load logs",
        500
      );
    }
  }

  // GET or POST /api/test-laravel — diagnostic test probe to verify Laravel webhook connectivity
  if (path === "/api/test-laravel") {
    const probe = await testLaravelIngest(env);
    return json(probe);
  }

  // POST /api/retry-laravel — retries forwarding failed posts to Laravel
  if (path === "/api/retry-laravel" && request.method === "POST") {
    const targetPostId = url.searchParams.get("postId");
    const query = targetPostId
      ? env.DB.prepare(
          "SELECT id, post_id, store_name, post_snippet, post_published_at, images_json FROM posts WHERE post_id = ?"
        ).bind(targetPostId)
      : env.DB.prepare(
          "SELECT id, post_id, store_name, post_snippet, post_published_at, images_json FROM posts WHERE forwarded_to_laravel = 0 ORDER BY id DESC LIMIT 10"
        );

    const rows = await query.all<{
      id: number;
      post_id: string;
      store_name: string;
      post_snippet: string | null;
      post_published_at: string | null;
      images_json: string | null;
    }>();

    const results = [];
    for (const row of rows.results ?? []) {
      const store = SUPERMARKET_STORES.find((s) => s.name === row.store_name);
      const slug = store?.slug || "unknown";
      let images: string[] = [];
      try {
        images = row.images_json ? JSON.parse(row.images_json) : [];
      } catch {
        images = [];
      }

      const res = await forwardToLaravel(env, {
        retailerSlug: slug,
        postId: row.post_id,
        postText: row.post_snippet || "",
        imageUrls: images,
        publishedAt: row.post_published_at,
      });

      if (res.forwarded) {
        await env.DB
          .prepare(
            "UPDATE posts SET forwarded_to_laravel = 1, laravel_status = ? WHERE id = ?"
          )
          .bind(res.statusText, row.id)
          .run();
      } else {
        await env.DB
          .prepare(
            "UPDATE posts SET laravel_status = ? WHERE id = ?"
          )
          .bind(res.statusText, row.id)
          .run();
      }

      results.push({
        postId: row.post_id,
        slug,
        forwarded: res.forwarded,
        status: res.statusText,
        body: res.responseBody,
      });
    }

    return json({ success: true, retried: results.length, details: results });
  }

  // POST or GET /api/dispatch — triggers GitHub Actions radar workflow immediately
  if (path === "/api/dispatch" && (request.method === "POST" || request.method === "GET")) {
    const res = await dispatchGitHubRadarWorkflow(env);
    return json(res, res.success ? 200 : (res.status || 500));
  }

  // POST /api/backfill-images — updates existing posts that have shared_post_id but empty/missing images
  if (path === "/api/backfill-images" && request.method === "POST") {
    try {
      const rows = await env.DB
        .prepare(
          `SELECT id, post_id, shared_post_id, images_json
           FROM posts
           WHERE shared_post_id IS NOT NULL
             AND (images_json IS NULL OR images_json = '[]' OR images_json = '')
           ORDER BY id DESC
           LIMIT 20`
        )
        .all<{ id: number; post_id: string; shared_post_id: string; images_json: string | null }>();

      const results = [];
      for (const row of rows.results ?? []) {
        try {
          const imgs = await fetchPostAttachments(env, row.shared_post_id);
          if (imgs.length > 0) {
            await env.DB
              .prepare("UPDATE posts SET images_json = ? WHERE id = ?")
              .bind(JSON.stringify(imgs.slice(0, 50)), row.id)
              .run();
            results.push({
              id: row.id,
              postId: row.post_id,
              sharedPostId: row.shared_post_id,
              imagesCount: imgs.length,
            });
          }
        } catch (err) {
          results.push({
            id: row.id,
            postId: row.post_id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return json({ success: true, updated: results.length, details: results });
    } catch (err) {
      return jsonError(
        err instanceof Error ? err.message : "Backfill failed",
        500
      );
    }
  }

  // POST /api/sync (manual trigger)
  if (path === "/api/sync" && request.method === "POST") {
    try {
      const result: SyncResult = await runSyncPipeline(env);
      const response: SyncApiResponse = {
        status: result.status,
        stores_checked: result.stores_checked,
        new_posts_found: result.new_posts_found,
        error_message: result.error_message,
      };
      return json(response, result.status === "SUCCESS" ? 200 : 200);
    } catch (err) {
      return jsonError(
        err instanceof Error ? err.message : "Sync failed",
        500
      );
    }
  }

  return new Response("Not Found", { status: 404 });
}

/* ------------------------------------------------------------------ */
/* Worker Entry Point                                                 */
/* ------------------------------------------------------------------ */

export default {
  /**
   * Cron Trigger: fires with sub-second precision every 10 minutes.
   *
   * Responsibilities:
   *  1. "Wakes up" GitHub Actions by dispatching the `radar.yml` workflow,
   *     which spins up Ubuntu + WARP SOCKS5 proxy to scrape the 12 supermarket
   *     Facebook pages and push new posts back to /api/hook.
   *  2. Runs supplementary Google Alerts sync as fallback.
   */
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    console.log("[cron] Scheduled trigger fired at", new Date().toISOString());

    // 1. Awaken GitHub Actions radar workflow
    if (env.GITHUB_TOKEN) {
      const dispatchRes = await dispatchGitHubRadarWorkflow(env);
      console.log(`[cron] GitHub radar dispatch: ${dispatchRes.message}`);
    } else {
      console.log(
        "[cron] Note: GITHUB_TOKEN not configured. Set via `wrangler secret put GITHUB_TOKEN` to awaken GitHub Actions automatically."
      );
    }

    // 2. Supplementary Alerts sync
    try {
      const result = await runSyncPipeline(env);
      console.log(
        `[cron] Supplementary Alerts sync complete: ${result.new_posts_found} new post(s), status=${result.status}`
      );
      if (result.error_message) {
        console.error("[cron] Alerts sync error:", result.error_message);
      }
    } catch (err) {
      console.error("[cron] Alerts sync exception:", err);
    }
  },

  /**
   * Fetch: serves the admin dashboard and JSON API.
   */
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      console.error("[fetch] Unhandled error:", err);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
};
