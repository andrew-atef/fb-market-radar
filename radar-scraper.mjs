/**
 * Facebook Radar Scraper — runs on GitHub Actions (ubuntu-latest) or any
 * Linux/Windows host that has a Cloudflare WARP SOCKS5 proxy on port 40000.
 *
 * Empirically verified (2026-11-03): fetching a Facebook PAGE ROOT via the
 * WARP proxy completely bypasses Meta's datacenter block and returns the
 * full ~1.5MB SSR HTML containing, per post:
 *   - "post_id":"1582809850544586"   (exact numeric post ID)
 *   - "creation_time":1793704803     (exact publish time, Unix seconds)
 *   - "message":{"text":"..."}       (full caption, Relay JSON encoding)
 *   - scontent master image URLs     (t39.30808-6 / t39.99422-6, 2K quality)
 *
 * For each of the 10 monitored Egyptian supermarket stores this script:
 *   1. curl → https://www.facebook.com/{handle} via socks5h://127.0.0.1:40000
 *   2. Parses the Relay SSR payload with the regexes below
 *   3. POSTs the post to the Cloudflare Worker ingest endpoint (/api/hook)
 *      which dedupes against D1 and shares it to the user's Facebook Page.
 *
 * Env vars required:
 *   WORKER_URL — e.g. https://facebook-supermarket-monitor.<acct>.workers.dev
 *   WORKER_KEY — the DASHBOARD_AUTH_KEY secret value
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const WARP_PROXY = (process.env.WARP_PROXY || "socks5h://127.0.0.1:40000").trim();
// NB: .trim() guards against secrets set via STDIN/carriage-return artifacts
// (CRLF) — Node's URL parser rejects URLs containing control characters.
const WORKER_URL = (process.env.WORKER_URL || "").trim().replace(/\/+$/, "");
const WORKER_KEY = (process.env.WORKER_KEY || "").trim();

if (!WORKER_URL || !WORKER_KEY) {
  console.error(
    "FATAL: WORKER_URL and WORKER_KEY env vars are required (GitHub repo secrets)."
  );
  process.exit(1);
}

/** The 10 monitored Egyptian supermarket Facebook pages. */
const STORES = [
  { slug: "kazyonegypt",        name: "Kazyon Egypt" },
  { slug: "BIMStoresEgypt",     name: "BIM Stores Egypt" },
  { slug: "Fathallamarket1948", name: "Fathalla Market 1948" },
  { slug: "KheirZamanEgypt",    name: "Kheir Zaman Egypt" },
  { slug: "AlMahmal",           name: "Al Mahmal" },
  { slug: "ZahranMarket",       name: "Zahran Market" },
  { slug: "FerganiMarket",      name: "Fergani Market" },
  { slug: "OscarStores",        name: "Oscar Stores" },
  { slug: "SpinneysEgypt",      name: "Spinneys Egypt" },
  { slug: "HyperOne",           name: "Hyper One" },
];

/** Human-like rhythm: pause between page requests (ms). */
const INTER_STORE_DELAY_MS = 2000;

/**
 * Recency guard: FB pages leak their PINNED post in the SSR HTML (e.g.
 * AlMahmal's Sept-2022 pin). Dispatching those would share years-old offers
 * as "new". Only dispatch posts with a parseable creation_time newer than
 * this threshold (hours). Posts without creation_time are never dispatched —
 * they cannot be proven fresh.
 */
const MAX_POST_AGE_HOURS = Number(process.env.MAX_POST_AGE_HOURS || 24);

/* ------------------------------------------------------------------ */
/* Extraction (the empirically-proven patterns)                        */
/* ------------------------------------------------------------------ */

/**
 * Extracts the newest post from a page's guest-SSR HTML.
 *
 * @param {string} html - raw SSR response body
 * @returns {{ postId: string, publishedAt: string|null, text: string|null,
 *             images: string[] } | null}
 */
export function extractNewestPost(html) {
  if (!html || html.length < 1000) return null;

  // --- Post ID: prefer numeric Relay story id, fall back to pfbid link ---
  let postId = null;
  let postIdIndex = -1;

  const numeric = /"post_id":"(\d{10,})"/.exec(html);
  if (numeric) {
    postId = numeric[1];
    postIdIndex = numeric.index;
  } else {
    const pfbid =
      /facebook\.com\/[A-Za-z0-9_.-]+\/posts\/(pfbid[0-9A-Za-z]{20,})/.exec(html);
    if (pfbid) {
      postId = pfbid[1];
      postIdIndex = pfbid.index;
    }
  }
  if (!postId) return null;

  // --- Publish time: "creation_time" appears near the post_id in the Relay
  //     payload; search the window right after the ID match ---
  let publishedAt = null;
  if (postIdIndex >= 0) {
    const window = html.slice(postIdIndex, postIdIndex + 700);
    const ct = /"creation_time":(\d{10})/.exec(window);
    if (ct) publishedAt = new Date(Number(ct[1]) * 1000).toISOString();
  }

  // --- Caption: first Relay message text (page's own newest post) ---
  let text = null;
  const msg = /"message":\s*\{\s*"text":\s*"((?:[^"\\]|\\.)*)"/.exec(html);
  if (msg && msg[1]) {
    try {
      text = JSON.parse(`"${msg[1]}"`);
    } catch {
      text = msg[1];
    }
    // Collapse whitespace; the share message reads better single-spaced.
    text = text.replace(/\s+/g, " ").trim() || null;
  }

  // --- Master images: unescape \/ separators, then match high-res CDN urls ---
  const clean = html.replace(/\\\//g, "/");
  const masterPatterns = [
    /https:\/\/scontent[^"\\<>\s]+\/v\/t39\.(?:30808|99422)-6\/[^"\\<>\s]+/gi,
    /https:\/\/scontent[^"\\<>\s]+(?:mx2048|s2048x2048|s960x960|p720x720)[^"\\<>\s]+/gi,
  ];
  const exclude = ["t39.30808-1", "s50x50", "s150x150"];
  const images = [];
  for (const pattern of masterPatterns) {
    for (const url of clean.matchAll(pattern)) {
      const u = url[0].replace(/&amp;/g, "&");
      if (exclude.some((e) => u.includes(e))) continue;
      if (!images.includes(u)) images.push(u);
    }
  }

  return { postId, publishedAt, text, images: images.slice(0, 12) };
}

/* ------------------------------------------------------------------ */
/* Fetch via WARP                                                      */
/* ------------------------------------------------------------------ */

/**
 * Fetches a Facebook page root by shelling out to curl through the WARP
 * SOCKS5 proxy with the exact proven headers.
 *
 * @param {string} handle - Facebook page slug
 * @returns {Promise<string>} response body
 */
async function fetchViaWarp(handle) {
  const args = [
    "-s", "-L",
    "-x", WARP_PROXY,
    "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "-H", "Accept-Language: ar-EG,ar;q=0.9,en-US;q=0.8",
    "-H", "Cookie: locale=ar_AR; wd=1440x900;",
    "-H", "Sec-Fetch-Dest: document",
    "-H", "Sec-Fetch-Mode: navigate",
    "-H", "Sec-Fetch-Site: none",
    "--max-time", "20",
    `https://www.facebook.com/${handle}`,
  ];
  const { stdout } = await execFileAsync("curl", args, {
    maxBuffer: 30 * 1024 * 1024,
    timeout: 30_000,
  });
  return stdout;
}

/**
 * POSTs one detected post to the Worker ingest endpoint.
 *
 * @returns {Promise<{status:number, body:object}>}
 */
async function dispatchToWorker(store, post) {
  const url = `${WORKER_URL}/api/hook?key=${encodeURIComponent(WORKER_KEY)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      retailerSlug: store.slug,
      postId: post.postId,
      postText: post.text,
      imageUrls: post.images,
      publishedAt: post.publishedAt,
    }),
  });
  let body = {};
  try {
    body = await response.json();
  } catch {
    /* non-JSON error body — keep empty */
  }
  return { status: response.status, body };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Main loop                                                           */
/* ------------------------------------------------------------------ */

async function main() {
  console.log(`[radar] Scraping ${STORES.length} stores via ${WARP_PROXY}`);

  // Sanity check: confirm WARP egress is live before touching Facebook.
  try {
    const { stdout } = await execFileAsync(
      "curl",
      ["-s", "-x", WARP_PROXY, "--max-time", "10", "https://cloudflare.com/cdn-cgi/trace"],
      { timeout: 15_000 }
    );
    const warp = /warp=on/.test(stdout);
    console.log(`[radar] WARP trace: warp=on → ${warp ? "CONNECTED ✓" : "OFF ✗"}`);
    if (!warp) {
      console.error("[radar] FATAL: WARP proxy is not connected. Aborting.");
      process.exit(1);
    }
  } catch (err) {
    console.error(`[radar] FATAL: WARP trace check failed: ${err.message}`);
    process.exit(1);
  }

  const summary = [];

  for (let i = 0; i < STORES.length; i++) {
    const store = STORES[i];
    if (i > 0) await sleep(INTER_STORE_DELAY_MS);

    try {
      const html = await fetchViaWarp(store.slug);
      const post = extractNewestPost(html);

      if (!post) {
        summary.push({ store: store.slug, status: "NO_ID", htmlBytes: html.length });
        console.log(
          `[radar] ${store.slug.padEnd(20)} NO_ID (${html.length}B — error/login shell, like locally)`
        );
        continue;
      }

      // Recency guard: never dispatch pinned or undatable posts.
      const ageHours = post.publishedAt
        ? (Date.now() - Date.parse(post.publishedAt)) / 3_600_000
        : null;
      if (ageHours === null || ageHours > MAX_POST_AGE_HOURS) {
        summary.push({
          store: store.slug,
          status: ageHours === null ? "SKIP_NO_TIME" : "SKIP_OLD",
          postId: post.postId,
          ageHours: ageHours === null ? null : Math.round(ageHours),
        });
        console.log(
          `[radar] ${store.slug.padEnd(20)} ${ageHours === null ? "SKIP_NO_TIME" : `SKIP_OLD (${Math.round(ageHours)}h)`} ${post.postId}`
        );
        continue;
      }

      const { status, body } = await dispatchToWorker(store, post);
      if (status === 200 && body.success && body.duplicate) {
        summary.push({ store: store.slug, status: "DUPLICATE", postId: post.postId });
        console.log(
          `[radar] ${store.slug.padEnd(20)} DUPLICATE ${post.postId}`
        );
      } else if (status === 200 && body.success) {
        summary.push({
          store: store.slug,
          status: "SHARED",
          postId: post.postId,
          sharedPostId: body.sharedPostId,
          latency: body.latencyMinutes,
        });
        console.log(
          `[radar] ${store.slug.padEnd(20)} SHARED ${post.postId} → ${body.sharedPostId}` +
            (body.latencyMinutes !== null && body.latencyMinutes !== undefined
              ? ` (true latency: ${body.latencyMinutes}m)`
              : "")
        );
      } else {
        summary.push({ store: store.slug, status: "HOOK_ERROR", http: status, body });
        console.error(
          `[radar] ${store.slug.padEnd(20)} HOOK_ERROR HTTP ${status}: ${JSON.stringify(body)}`
        );
      }
    } catch (err) {
      summary.push({ store: store.slug, status: "FETCH_ERROR", error: err.message });
      console.error(`[radar] ${store.slug.padEnd(20)} FETCH_ERROR: ${err.message}`);
    }
  }

  // Console report digested by the GitHub Actions log viewer.
  const shared = summary.filter((s) => s.status === "SHARED");
  console.log("\n[radar] ===== RUN SUMMARY =====");
  console.log(`[radar] stores scanned : ${summary.length}`);
  console.log(`[radar] new shared     : ${shared.length}${shared.length ? ` (${shared.map((s) => s.store).join(", ")})` : ""}`);
  console.log(`[radar] duplicates     : ${summary.filter((s) => s.status === "DUPLICATE").length}`);
  console.log(`[radar] skipped (old)  : ${summary.filter((s) => s.status === "SKIP_OLD").length}`);
  console.log(`[radar] no id / errors : ${summary.filter((s) => ["NO_ID", "FETCH_ERROR", "HOOK_ERROR", "SKIP_NO_TIME"].includes(s.status)).length}`);
}

main();
