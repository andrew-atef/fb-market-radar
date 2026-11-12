/**
 * Facebook Supermarket Radar Scraper — 24/7 Unified Waterfall Engine
 *
 * Single Source of Truth (SSOT) Ingestion Engine for Egyptian Supermarket Flyers.
 *
 * Implements the STRICT STORY-BOUNDARY Extraction Waterfall (v3):
 *   Tier 1: Post-Own PCB Mediaset Page (set=pcb.<postId>)  — story-bound
 *   Tier 2: Post Permalink Story Window (incl. dialog-viewer preloads)
 *   Tier 3: Root Feed Fallback (Collage preview images)
 *
 * HARD RULES (post-incident, magalatna.com 2026-11-11):
 *   - A post's images must belong STRICTLY to that specific post.
 *   - NEVER paginate a general `set=a.` album (the HyperOne overshoot: the
 *     page's Timeline Photos album pulled dozens of old weeks into one post).
 *   - Anonymous GraphQL pagination (/api/graphql/ doc_id) is DEAD — Facebook
 *     answers with an error shell. Never relied upon.
 *   - Cover photos / profile avatars are rejected by canonical photo id
 *     (rendition-proof), not by full filename signature.
 *
 * Preceded by the Immutable Image Purification Gate:
 *   - Canonical Photo-ID grouping: the middle numeric sequence of the CDN
 *     filename is 1:1 with the photo node (proven on mediaset edge pairs).
 *   - Quality hierarchy: 100 (2K master), 50 (1080p), 0 (grid crops —
 *     rejected when any higher rendition exists for the same photo id).
 *   - Highest quality URL retained per photo id, chronological order, cap 80.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);

const WARP_PROXY = (process.env.WARP_PROXY || "socks5h://127.0.0.1:40000").trim();
const WORKER_URL = (process.env.WORKER_URL || "").trim().replace(/\/+$/, "");
const WORKER_KEY = (process.env.WORKER_KEY || "").trim();

const RADAR_DIRECT =
  process.env.RADAR_DIRECT === "1" ||
  ["true", "yes", "on"].includes((process.env.RADAR_DIRECT || "").toLowerCase());

if (!RADAR_DIRECT && !WARP_PROXY) {
  console.error("FATAL: WARP_PROXY is empty and RADAR_DIRECT is not set.");
  process.exit(1);
}

/**
 * 12 Authoritative Egyptian supermarket chains with verified slugs.
 */
export const STORES = [
  { handle: 'kazyonegypt', slug: 'kazyon', name: 'كازيون' },
  { handle: 'BIMmisr', slug: 'bimmisr', name: 'بيم' },
  { handle: 'carrefouregypt', slug: 'carrefouregypt', name: 'كارفور' },
  { handle: 'hyperone.eg', slug: 'hyperone', name: 'هايبر وان' },
  { handle: 'fathallacairomarket', slug: 'fathalla', name: 'فتح الله' },
  { handle: 'marketelfergany', slug: 'elfergany', name: 'الفرجاني' },
  { handle: 'AwladRagabCO', slug: 'awladragab', name: 'أولاد رجب' },
  { handle: 'Gomlamarket.Retailcompany', slug: 'gomlamarket', name: 'جملة ماركت' },
  { handle: 'KheirZamanEgypt', slug: 'kheirzaman', name: 'خير زمان' },
  { handle: 'SeoudiSupermarket', slug: 'seoudi', name: 'سعودي' },
  { handle: 'othaimmarketseg', slug: 'othaim', name: 'أسواق العثيم' },
  { handle: 'MetroMarketEgypt', slug: 'metromarket', name: 'مترو' }
];

const INTER_STORE_DELAY_MS = 2000;
const MAX_POST_AGE_HOURS = Number(process.env.MAX_POST_AGE_HOURS || 24);

/* ------------------------------------------------------------------ */
/* 1. Canonical Photo IDs & Quality Scoring                           */
/* ------------------------------------------------------------------ */

/**
 * Canonical, rendition-independent PHOTO ID from a Facebook CDN URL.
 *
 * CAUTION (proven live 2026-11-12): the middle numeric sequence is
 * rendition-family-specific. Within one source (SSR HTML) every rendition
 * of the same photo shares the middle id, so it is a valid dedup key
 * WITHIN that source — but Graph-API masters of the SAME photo carry a
 * DIFFERENT middle id than SSR renditions (0/48 identity, 0/24 overlap).
 * Cross-source canonicalization therefore requires ALIASING middle ids
 * to photo fbids via VERIFIED pairs (pcb mediaset edges, Graph
 * subattachments), which is what purifyImages(…, aliasMap) does.
 *   888089576_1544026577760568_542229003541084839_n.jpg → 1544026577760568
 */
export function photoCanonicalId(url) {
  if (!url || typeof url !== "string") return null;
  const m3 = /(\d{6,25})_(\d{6,40})_(\d{6,40})_n\.[a-z0-9]+/i.exec(url);
  if (m3) return m3[2];
  const m2 = /(\d{6,25})_(\d{6,40})_n\.[a-z0-9]+/i.exec(url);
  if (m2) return m2[1];
  return null;
}

/**
 * Legacy full-filename signature (kept for rejected-set compatibility):
 * e.g. "884555872_4561104667540680_6272468966122969527_n.png"
 */
export function photoSignature(url) {
  if (!url || typeof url !== "string") return null;
  const m =
    /(\d{7,25}_\d{7,40}_\d{7,40}_n\.[a-z0-9]+)/i.exec(url) ||
    /(\d{7,25}_\d{7,40}_n\.[a-z0-9]+)/i.exec(url);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Quality score per the platform hierarchy:
 *   100: unconstrained 2K master (t39.99422-6, t39.30808-6, mx2048, s2048x2048)
 *   50:  1080p high-res (mx1080, s1080x1080, s960x960, p720x720)
 *   0:   grid crops / avatars (s552x414, s320x320, s150x150, t39.30808-1)
 *        — STRICTLY REJECTED whenever a higher rendition of the same photo
 *        id exists; dropped outright for known avatar/profile types.
 */
export function scoreUrl(url) {
  if (!url || typeof url !== "string") return 0;
  // t39.30808-1 is the avatar / tiny-profile rendition type: never a flyer page.
  if (/t39\.30808-1\//i.test(url)) return 0;
  if (/mx2048|s2048x2048|t39\.(?:99422|30808)-6\//i.test(url)) return 100;
  if (/mx1080|s1080x1080|s960x960|p720x720/i.test(url)) return 50;
  if (/s552x414|s320x320|s150x150|p180x540/i.test(url)) return 0;
  return 20; // default for other scontent URLs
}

/**
 * Extracts cover photo and profile avatar identifiers from HTML.
 * Returns BOTH full filename signatures and canonical photo ids so the
 * purification gate can reject every rendition of those photos
 * (renditions of one photo differ in filename but share the photo id).
 */
export function extractRejectedSignatures(html) {
  const rejectedSignatures = new Set();
  const rejectedPhotoIds = new Set();
  if (!html || typeof html !== "string") {
    return { rejectedSignatures, rejectedPhotoIds };
  }
  const clean = html.replace(/\\\//g, "/");

  const collect = (blocks) => {
    for (const block of blocks) {
      const urls = block.match(/https:\/\/scontent[^"\\<>\s]+/g) || [];
      for (const u of urls) {
        const sig = photoSignature(u);
        if (sig) rejectedSignatures.add(sig);
        const id = photoCanonicalId(u);
        if (id) rejectedPhotoIds.add(id);
      }
    }
  };

  // Cover photo blocks
  collect(clean.match(/"cover_photo"\s*:\s*\{[^}]+\}|"coverPhoto"\s*:\s*\{[^}]+\}/g) || []);

  // Profile picture / avatar blocks
  collect(
    clean.match(
      /"profile_picture"\s*:\s*\{[^}]+\}|"profile_photo"\s*:\s*\{[^}]+\}|"profilePhoto"\s*:\s*\{[^}]+\}/g
    ) || []
  );

  return { rejectedSignatures, rejectedPhotoIds };
}

/**
 * Master image URL regexes to pull high-res CDN nodes from raw HTML.
 */
export const MASTER_IMAGE_PATTERNS = [
  /https:\/\/scontent[^"\\<>\s]+\/v\/t39\.(?:30808|99422)-6\/[^"\\<>\s]+/gi,
  /https:\/\/scontent[^"\\<>\s]+(?:mx2048|s2048x2048|s1080x1080|s960x960|p720x720)[^"\\<>\s]+/gi,
];

/**
 * Extracts raw master URLs and viewer_image nodes from HTML text.
 */
export function extractMasterUrlsFromHtml(html) {
  if (!html || typeof html !== "string") return [];
  const clean = html.replace(/\\\//g, "/");
  const urls = [];

  for (const pattern of MASTER_IMAGE_PATTERNS) {
    for (const match of clean.matchAll(pattern)) {
      urls.push(match[0].replace(/&amp;/g, "&"));
    }
  }

  // Embedded viewer_image nodes in Relay SSR
  const viewerMatches = clean.matchAll(/"viewer_image"\s*:\s*\{[^}]*"uri"\s*:\s*"([^"]+)"/g);
  for (const vm of viewerMatches) {
    if (vm[1] && vm[1].startsWith("http")) {
      urls.push(vm[1].replace(/&amp;/g, "&"));
    }
  }

  return urls;
}

/* ------------------------------------------------------------------ */
/* 2. The Immutable Image Purification Gate                           */
/* ------------------------------------------------------------------ */

/**
 * Extra CDN source URLs beyond the master regexes: the dialog-viewer
 * preload <link rel=preload as=image> tags. On a post permalink these
 * carry the CONTINUATION of the post's own mediaset (the photo viewer
 * walks exactly the story's photos), which is how the 24-edges-first-page
 * pcb album extends to the full set (e.g. El Fergany 24 → 47+).
 */
export function extractPreloadImageUrls(html) {
  if (!html || typeof html !== "string") return [];
  const urls = [];
  for (const m of html.matchAll(
    /<link[^>]*rel="preload"[^>]*href="(https:\/\/scontent[^"]+)"[^>]*as="image"/g
  )) {
    urls.push(m[1].replace(/&amp;/g, "&"));
  }
  return urls;
}

/**
 * Parses the mediaset edge list ("media":{"edges":[{"node":{...,"image":
 * {...,"uri":"..."},"id":"<photoFbid>"}...]}) — the post's own photo
 * bundle with a VERIFIED (photoFbid → rendition uri) 1:1 mapping.
 */
export function extractMediasetEdges(html) {
  if (!html || typeof html !== "string") return [];
  const clean = html.replace(/\\\//g, "/");
  const start = clean.indexOf('"__typename":"MediaContainerMediaSet"');
  if (start < 0) return [];
  const window = clean.slice(start, start + 1_200_000);
  const edges = [];
  for (const m of window.matchAll(
    /"__typename":"Photo","__isMedia":"Photo","image":\{"height":\d+,"width":\d+,"uri":"(https:\/\/scontent[^"]+)"[^}]*\},"id":"(\d{10,20})"/g
  )) {
    edges.push({ uri: m[1].replace(/&amp;/g, "&"), photoFbid: m[2] });
  }
  return edges;
}

/**
 * Purifies raw image URLs (the Immutable Image Purification Gate):
 *   1. Drops avatars / tiny thumbnails outright
 *   2. Drops cover photos and profile avatars (by signature AND photo id)
 *   3. Groups all renditions by canonical PHOTO ID
 *   4. Per photo id keeps EXACTLY ONE URL — the highest quality rendition;
 *      grid crops (score 0) are rejected whenever any higher rendition
 *      exists for the same photo id
 *   5. Preserves chronological discovery order
 *   6. Caps at 80 master URLs
 */
export function purifyImages(
  rawUrls,
  rejected = { rejectedSignatures: new Set(), rejectedPhotoIds: new Set() },
  aliasMap = new Map(),
  opts = {}
) {
  const rejectedSignatures = rejected.rejectedSignatures || rejected;
  const rejectedPhotoIds = rejected.rejectedPhotoIds || new Set();
  const restrictToAliased = Boolean(opts.restrictToAliased);

  const byId = new Map();
  const order = [];

  for (const raw of rawUrls) {
    if (!raw || typeof raw !== "string" || !raw.startsWith("http")) continue;
    const cleanUrl = raw.replace(/\\\//g, "/").replace(/&amp;/g, "&");

    // Tiny UI avatars and low-res thumbnails: never flyer pages.
    if (/t39\.30808-1\/|s50x50|s150x150|p50x50/i.test(cleanUrl)) continue;

    const canonicalId = photoCanonicalId(cleanUrl);
    const sig = photoSignature(cleanUrl);
    if (!canonicalId && !sig) continue;

    // STRICT STORY-BOUNDARY: when verified story pairs exist (pcb mediaset
    // edges, Graph ground truth), a master whose id does NOT alias to a
    // verified story photo is FOREIGN (permalink preloads carry other
    // posts' photos — proven live: 36 of 41 preload ids) and is dropped.
    if (
      restrictToAliased &&
      (!canonicalId || !aliasMap.has(canonicalId))
    ) {
      continue;
    }

    // Cross-source canonical key: verified pairs alias a middle id to its
    // photo fbid, collapsing SSR renditions and Graph masters of the same
    // photo into ONE entry.
    const key = (canonicalId && aliasMap.get(canonicalId)) || canonicalId || sig;

    if (rejectedPhotoIds.has(canonicalId)) continue;
    if (rejectedPhotoIds.has(key)) continue;
    if (sig && rejectedSignatures.has(sig)) continue;

    const score = scoreUrl(cleanUrl);
    if (score === 0) continue; // grid crops / avatar types: strictly rejected

    if (!byId.has(key)) {
      byId.set(key, { url: cleanUrl, score });
      order.push(key);
    } else {
      const existing = byId.get(key);
      if (score > existing.score) {
        byId.set(key, { url: cleanUrl, score });
      }
    }
  }

  return order.map((key) => byId.get(key).url).slice(0, 80);
}

/* ------------------------------------------------------------------ */
/* 3. HTTP / WARP Fetching Engine                                     */
/* ------------------------------------------------------------------ */

export async function fetchUrlViaWarp(url, customHeaders = []) {
  const args = ["-s", "-L"];
  if (!RADAR_DIRECT) args.push("-x", WARP_PROXY);
  args.push(
    "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "-H", "Accept-Language: ar-EG,ar;q=0.9,en-US;q=0.8",
    "-H", "Cookie: locale=ar_AR; wd=1440x900;",
    "-H", "Sec-Fetch-Dest: document",
    "-H", "Sec-Fetch-Mode: navigate",
    "-H", "Sec-Fetch-Site: none",
    "--retry", "2",
    "--retry-delay", "1",
    "--max-time", "20",
    ...customHeaders,
    url
  );

  const { stdout } = await execFileAsync("curl", args, {
    maxBuffer: 25 * 1024 * 1024,
    timeout: 30_000,
  });
  return stdout;
}

export async function fetchViaWarp(handle) {
  return fetchUrlViaWarp(`https://www.facebook.com/${handle}`);
}

/**
 * Application-level resilient fetch: known WARP transient drops (verified
 * across GitHub Actions runs 41651570483+) kill a single curl invocation
 * even with curl's own --retry. Retries the WHOLE fetch and rejects
 * suspiciously short bodies (error shells are 1.5-4KB).
 */
export async function fetchUrlViaWarpResilient(url, customHeaders = [], attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const out = await fetchUrlViaWarp(url, customHeaders);
      if (out && out.length > 8000) return out; // real SSR payload, not a shell
      lastErr = new Error(`suspiciously short body (${out ? out.length : 0}B)`);
    } catch (err) {
      lastErr = err;
    }
    if (i < attempts - 1) await sleep(2000 * (i + 1));
  }
  throw lastErr;
}

/* ------------------------------------------------------------------ */
/* 4. Post Metadata Extraction                                        */
/* ------------------------------------------------------------------ */

export function extractPostMetadata(html) {
  if (!html || html.length < 1000) return null;

  let postId = null;
  let postIdIndex = -1;

  const numeric = /"post_id":"(\d{10,})"/.exec(html);
  if (numeric) {
    postId = numeric[1];
    postIdIndex = numeric.index;
  } else {
    const pfbid = /facebook\.com\/[A-Za-z0-9_.-]+\/posts\/(pfbid[0-9A-Za-z]{20,})/.exec(html);
    if (pfbid) {
      postId = pfbid[1];
      postIdIndex = pfbid.index;
    }
  }
  if (!postId) return null;

  let publishedAt = null;
  if (postIdIndex >= 0) {
    const window = html.slice(postIdIndex, postIdIndex + 800);
    const ct = /"creation_time":(\d{10})/.exec(window);
    if (ct) publishedAt = new Date(Number(ct[1]) * 1000).toISOString();
  }

  let text = null;
  const msg = /"message":\s*\{\s*"text":\s*"((?:[^"\\]|\\.)*)"/.exec(html);
  if (msg && msg[1]) {
    try {
      text = JSON.parse(`"${msg[1]}"`);
    } catch {
      text = msg[1];
    }
    text = text.replace(/\s+/g, " ").trim() || null;
  }

  // Post-own mediaset token: STRICT story-boundary rule — only accept a
  // pcb token that belongs to THIS post (pcb.<postId>). A generic
  // mediaset_token elsewhere in the payload may belong to another story.
  // The page's global Timeline Photos album (set=a.<albumId>) is NEVER a
  // story boundary and is only recorded for diagnostics.
  let pcbToken = null;
  const pcbOwn = new RegExp(`"mediaset_token"\\s*:\\s*"pcb\\.${postId}"`).exec(html);
  if (pcbOwn) {
    pcbToken = postId;
  } else {
    const pcbMatch = /"mediaset_token"\s*:\s*"pcb\.(\d+)"/.exec(html);
    if (pcbMatch) pcbToken = pcbMatch[1];
  }

  // Album ID is diagnostic-only: paginating it is FORBIDDEN (general album).
  let albumId = null;
  const albumMatch =
    /set=a\.(\d+)/.exec(html) ||
    /"album_id"\s*:\s*"(\d+)"/.exec(html);
  if (albumMatch) {
    albumId = albumMatch[1];
  }

  // Index of the story's own attachment payload on the page (used by the
  // permalink story window): prefer the mediaset token position, then the
  // post_id position.
  const storyIndex = pcbOwn
    ? pcbOwn.index
    : postIdIndex >= 0
      ? postIdIndex
      : -1;

  return { postId, publishedAt, text, pcbToken, albumId, postIdIndex, storyIndex };
}

/* ------------------------------------------------------------------ */
/* 5. The STRICT STORY-BOUNDARY Waterfall (v3)                        */
/* ------------------------------------------------------------------ */

/**
 * Extracts master URLs STRICTLY from the story window of a post permalink:
 * [storyIndex → the next DIFFERENT post_id, capped at +600KB].
 * Includes the dialog-viewer preload <link> images, which carry the
 * continuation of the post's own mediaset. Masters for OTHER posts that
 * appear after the story block are excluded by the boundary.
 */
export function extractStoryWindowUrls(html, meta) {
  if (!html || typeof html !== "string" || meta.storyIndex < 0) return [];
  const clean = html.replace(/\\\//g, "/");

  // Boundary: the next occurrence of a DIFFERENT post_id after the story.
  const storyStart = meta.storyIndex;
  let storyEnd = storyStart + 600_000;
  for (const m of clean.matchAll(/"post_id":"(\d{10,})"/g)) {
    if (m.index > storyStart && m[1] !== meta.postId) {
      storyEnd = Math.min(storyEnd, m.index);
      break;
    }
  }
  const window = clean.slice(storyStart, storyEnd);
  return [...extractMasterUrlsFromHtml(window), ...extractPreloadImageUrls(window)];
}

/**
 * Graph-API ground truth: asks the Worker for the COMPLETE story photo set
 * behind a radar-discovered post. The Worker resolves the post's page-share
 * in D1 and reads the share's full attachment mirror (subattachments →
 * per-photo master renditions). Returns flat master URLs, empty on any
 * failure — the waterfall then proceeds with what SSR saw.
 *
 * The Worker is consulted, never obeyed: returned URLs enter the SAME
 * purification gate (photo-id grouping, cover/avatar rejection, quality
 * hierarchy) as every other source.
 */
async function fetchGraphStoryPhotoPairs(postId) {
  const url = `${WORKER_URL}/api/radar/photos?key=${encodeURIComponent(
    WORKER_KEY
  )}&postId=${encodeURIComponent(postId)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      if (response.status === 404) return []; // no share yet: nothing to enrich
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${JSON.stringify(body).slice(0, 160)}`
        );
      }
      const photos = Array.isArray(body.photos) ? body.photos : [];
      return photos
        .filter(
          (p) =>
            p &&
            typeof p.master === "string" &&
            p.master.startsWith("http") &&
            typeof p.fbid === "string"
        )
        .map((p) => ({ fbid: p.fbid, master: p.master }));
    } catch (err) {
      if (attempt === 2) throw err;
      await sleep(2000 * (attempt + 1));
    }
  }
  return [];
}

/**
 * Executes the STORY-BOUNDARY Waterfall:
 *   Tier 1: post-own PCB mediaset page (set=pcb.<postId>)
 *   Tier 2: post permalink story window (masters + dialog-viewer preloads)
 *   Tier 3: root feed fallback (last resort)
 *
 * Tiers 1 and 2 are BOTH story-bound by construction, so their union is
 * the story's complete photo set. The general album (set=a.<id>) and the
 * anonymous GraphQL endpoint are NEVER used — that is what pulled dozens
 * of past weeks into the HyperOne flyer.
 *
 * @param {object} store - Store definition
 * @param {object} meta - Post metadata
 * @param {string} rootHtml - Root page HTML (Tier 3 fallback source)
 * @returns {Promise<{ images: string[], tier: string, detail: object }>}
 */
export async function harvestPostImagesWaterfall(store, meta, rootHtml) {
  const rejected = extractRejectedSignatures(rootHtml);
  const sources = [];
  // Cross-source canonicalization: VERIFIED (middleId → photoFbid) pairs.
  // Built from pcb mediaset edges and Graph ground-truth masters; used by
  // purifyImages to collapse SSR renditions and Graph masters of the SAME
  // photo into a single entry.
  const aliasMap = new Map();

  // ----------------------------------------------------------------
  // TIER 1: Post-Own PCB Mediaset Page (story-bound by construction)
  // ----------------------------------------------------------------
  const pcbCandidate = meta.pcbToken;
  let pcbHasNext = false;
  if (pcbCandidate) {
    try {
      const pcbUrl = `https://www.facebook.com/media/set/?set=pcb.${pcbCandidate}`;
      const pcbHtml = await fetchUrlViaWarpResilient(pcbUrl);
      if (pcbHtml && pcbHtml.length > 2000) {
        // (a) Mediaset edges: VERIFIED (photoFbid → rendition) pairs.
        const edges = extractMediasetEdges(pcbHtml);
        const edgeUrls = edges.map((e) => e.uri);
        for (const e of edges) {
          const mid = photoCanonicalId(e.uri);
          if (mid && e.photoFbid) aliasMap.set(mid, e.photoFbid);
        }
        // (b) Whole-page masters (higher renditions of the same photos).
        const pageUrls = extractMasterUrlsFromHtml(pcbHtml);
        // (c) Connection state: does the mediaset have MORE pages than the
        //     first 24 edges? Anonymous continuation is impossible (GraphQL
        //     dead, mbasic dead, SSR cursor params ignored) — when true, the
        //     Graph ground-truth tier below completes the story.
        pcbHasNext = /"has_next_page":true/.test(
          pcbHtml.replace(/\\\//g, "/")
        );
        sources.push({
          tier: "TIER_1_PCB_MEDIASET",
          raw: [...edgeUrls, ...pageUrls],
          edges: edges.length,
          pcbHasNext,
          verified: true,
        });
      }
    } catch (err) {
      console.warn(
        `[radar] TIER_1_PCB_MEDIASET failed for ${pcbCandidate}: ${err.message}`
      );
      // Fall through to Tier 2
    }
  }

  // ----------------------------------------------------------------
  // TIER 2: Post Permalink Story Window (masters + viewer preloads)
  // ----------------------------------------------------------------
  if (meta.postId) {
    try {
      const permalinkUrl = `https://www.facebook.com/${store.handle}/posts/${meta.postId}`;
      const permalinkHtml = await fetchUrlViaWarpResilient(permalinkUrl);
      if (permalinkHtml && permalinkHtml.length > 2000) {
        // Re-extract metadata ON the permalink: the story token and
        // boundaries live there (the root feed HTML may not carry them).
        const permMeta =
          extractPostMetadata(permalinkHtml) || meta;
        const mergedMeta = {
          ...meta,
          pcbToken: meta.pcbToken || permMeta.pcbToken,
          storyIndex: permMeta.storyIndex >= 0 ? permMeta.storyIndex : meta.storyIndex,
        };
        const windowUrls = extractStoryWindowUrls(permalinkHtml, mergedMeta);
        sources.push({
          tier: "TIER_2_PERMALINK_STORY",
          raw: windowUrls,
          verified: false,
        });
      }
    } catch (err) {
      console.warn(
        `[radar] TIER_2_PERMALINK_STORY failed for ${meta.postId}: ${err.message}`
      );
      // Fall through to Tier 3
    }
  }

  // ----------------------------------------------------------------
  // TIER GRAPH GROUND TRUTH (post-own share via the Worker's page token)
  // ----------------------------------------------------------------
  // Fires ONLY when the pcb mediaset itself declared more pages than the
  // first page (has_next_page) — i.e. anonymous SSR is provably incomplete.
  // The Worker answers with the COMPLETE story photo set read from OUR page
  // share (subattachments = the original post's full attachment mirror,
  // master renditions via images{source}). Story-bound by construction:
  // the share mirrors exactly this one post.
  let graphPhotos = 0;
  if (pcbHasNext && WORKER_URL && WORKER_KEY && meta.postId) {
    try {
      const graphPairs = await fetchGraphStoryPhotoPairs(meta.postId);
      if (graphPairs.length > 0) {
        graphPhotos = graphPairs.length;
        for (const p of graphPairs) {
          const mid = photoCanonicalId(p.master);
          if (mid && p.fbid) aliasMap.set(mid, p.fbid);
        }
        sources.push({
          tier: "TIER_GRAPH_GROUND_TRUTH",
          raw: graphPairs.map((p) => p.master),
          photos: graphPhotos,
          verified: true,
        });
      }
    } catch (err) {
      console.warn(
        `[radar] Graph ground truth unavailable for ${meta.postId}: ${err.message}`
      );
    }
  }

  // Purification: verified sources (pcb page, Graph) unrestricted; the
  // unverified story-window masters are restricted to aliased (verified
  // story) photos whenever we hold verified pairs — foreign permalink
  // preloads have proven contaminating. Without any verified pair (e.g.
  // single-photo posts with no pcb mediaset and no share yet), the window
  // stands alone.
  const verifiedRaw = sources.filter((s) => s.verified).flatMap((s) => s.raw);
  const windowRaw = sources.filter((s) => !s.verified).flatMap((s) => s.raw);
  const storyRaw = [
    ...purifyImages(verifiedRaw, rejected, aliasMap),
    ...purifyImages(windowRaw, rejected, aliasMap, {
      restrictToAliased: aliasMap.size > 0,
    }),
  ];
  const storyPurified = purifyImages(storyRaw, rejected, aliasMap);
  if (storyPurified.length > 0) {
    return {
      images: storyPurified,
      tier: sources.map((s) => s.tier).join("+"),
      detail: {
        sources: sources.map((s) => s.tier),
        raw: storyRaw.length,
        graphPhotos,
      },
    };
  }

  // ----------------------------------------------------------------
  // TIER 3: Root Feed Fallback (Last Resort)
  // ----------------------------------------------------------------
  const rootUrls = extractMasterUrlsFromHtml(rootHtml);
  const purifiedFallback = purifyImages(rootUrls, rejected);
  return {
    images: purifiedFallback,
    tier: "TIER_3_ROOT_FEED_FALLBACK",
    detail: { sources: ["TIER_3_ROOT_FEED_FALLBACK"], raw: rootUrls.length },
  };
}

/* ------------------------------------------------------------------ */
/* 6. Worker Dispatching (Single Ingestion Authority)                 */
/* ------------------------------------------------------------------ */

export async function dispatchToWorker(store, post) {
  const url = `${WORKER_URL}/api/hook?key=${encodeURIComponent(WORKER_KEY)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      retailerSlug: store.slug,
      retailerHandle: store.handle,
      retailerName: store.name,
      postId: post.postId,
      postText: post.text,
      imageUrls: post.images,
      publishedAt: post.publishedAt,
      extractionTier: post.extractionTier,
    }),
  });
  let body = {};
  try {
    body = await response.json();
  } catch {
    /* non-JSON error body */
  }
  return { status: response.status, body };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* 7. Main Loop & CLI Test Modes                                      */
/* ------------------------------------------------------------------ */

export async function main() {
  const args = process.argv.slice(2);

  // CLI Test Mode: e.g. `node radar-scraper.mjs --test hyperone`
  const testFlagIndex = args.indexOf("--test");
  if (testFlagIndex >= 0 && args[testFlagIndex + 1]) {
    const target = args[testFlagIndex + 1].toLowerCase();
    await runLocalVerificationTest(target);
    return;
  }

  // CLI Benchmark Mode: e.g. `node radar-scraper.mjs --benchmark <permalink>`
  const benchFlagIndex = args.indexOf("--benchmark");
  if (benchFlagIndex >= 0 && args[benchFlagIndex + 1]) {
    await runBenchmark(args[benchFlagIndex + 1]);
    return;
  }

  if (!WORKER_URL || !WORKER_KEY) {
    console.error(
      "FATAL: WORKER_URL and WORKER_KEY env vars are required."
    );
    process.exit(1);
  }

  console.log(
    `[radar] Starting 24/7 Waterfall Ingestion for ${STORES.length} stores via ${
      RADAR_DIRECT ? "DIRECT residential IP (no proxy)" : WARP_PROXY
    }`
  );

  if (!RADAR_DIRECT) {
    try {
      const { stdout } = await execFileAsync(
        "curl",
        ["-s", "-x", WARP_PROXY, "--max-time", "10", "https://cloudflare.com/cdn-cgi/trace"],
        { timeout: 15_000 }
      );
      const warp = /warp=on/.test(stdout);
      console.log(`[radar] WARP trace check: warp=on -> ${warp ? "CONNECTED ✓" : "OFF ✗"}`);
      if (!warp) {
        console.error("[radar] FATAL: WARP proxy is not connected. Aborting.");
        process.exit(1);
      }
    } catch (err) {
      console.error(`[radar] FATAL: WARP trace check failed: ${err.message}`);
      process.exit(1);
    }
  }

  const summary = [];

  for (let i = 0; i < STORES.length; i++) {
    const store = STORES[i];
    if (i > 0) await sleep(INTER_STORE_DELAY_MS);

    try {
      const rootHtml = await fetchViaWarp(store.handle);
      const meta = extractPostMetadata(rootHtml);

      if (!meta || !meta.postId) {
        summary.push({ store: store.slug, status: "NO_ID", htmlBytes: rootHtml.length });
        console.log(
          `[radar] ${(store.slug + " (" + store.handle + ")").padEnd(30)} NO_ID (${rootHtml.length}B)`
        );
        continue;
      }

      const ageHours = meta.publishedAt
        ? (Date.now() - Date.parse(meta.publishedAt)) / 3_600_000
        : null;
      if (ageHours === null || ageHours > MAX_POST_AGE_HOURS) {
        summary.push({
          store: store.slug,
          status: ageHours === null ? "SKIP_NO_TIME" : "SKIP_OLD",
          postId: meta.postId,
          ageHours: ageHours === null ? null : Math.round(ageHours),
        });
        console.log(
          `[radar] ${store.slug.padEnd(20)} ${ageHours === null ? "SKIP_NO_TIME" : `SKIP_OLD (${Math.round(ageHours)}h)`} ${meta.postId}`
        );
        continue;
      }

      // Execute Strict 4-Tier Waterfall Extraction
      const { images, tier } = await harvestPostImagesWaterfall(store, meta, rootHtml);

      const postPayload = {
        postId: meta.postId,
        publishedAt: meta.publishedAt,
        text: meta.text,
        images,
        extractionTier: tier,
      };

      const { status, body } = await dispatchToWorker(store, postPayload);

      if (status === 200 && body.success && body.duplicate) {
        summary.push({ store: store.slug, status: "DUPLICATE", postId: meta.postId, tier });
        console.log(
          `[radar] ${store.slug.padEnd(20)} DUPLICATE ${meta.postId} | ${tier} (${images.length} imgs)`
        );
      } else if (status === 200 && body.success) {
        summary.push({
          store: store.slug,
          status: "SHARED",
          postId: meta.postId,
          sharedPostId: body.sharedPostId,
          tier,
          imageCount: images.length,
        });
        console.log(
          `[radar] ${store.slug.padEnd(20)} DISPATCHED ${meta.postId} | ${tier} (${images.length} master imgs) -> Laravel 202`
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

  console.log("\n[radar] ===== WATERFALL RUN SUMMARY =====");
  console.log(`[radar] Stores scanned : ${summary.length}`);
  console.log(`[radar] Dispatched     : ${summary.filter((s) => s.status === "SHARED").length}`);
  console.log(`[radar] Duplicates     : ${summary.filter((s) => s.status === "DUPLICATE").length}`);
  console.log(`[radar] Skipped (old)  : ${summary.filter((s) => s.status === "SKIP_OLD").length}`);
}

/**
 * Local Verification Test against saved snapshots or targets
 */
async function runLocalVerificationTest(target) {
  console.log(`\n=== RUNNING LOCAL VERIFICATION TEST: ${target.toUpperCase()} ===`);
  const filename = target.includes("hyper") ? "new12_hyperone_eg.html" : "new12_marketelfergany.html";
  const filePath = path.resolve(filename);

  if (!fs.existsSync(filePath)) {
    console.error(`Snapshot file not found: ${filePath}`);
    return;
  }

  const html = fs.readFileSync(filePath, "utf8");
  const store = STORES.find((s) => s.slug === target || s.handle.toLowerCase().includes(target)) || STORES[0];
  const meta = extractPostMetadata(html);
  const rejected = extractRejectedSignatures(html);

  console.log(`Store         : ${store.name} (${store.slug})`);
  console.log(`Post ID       : ${meta?.postId}`);
  console.log(`Publish Time  : ${meta?.publishedAt}`);
  console.log(`PCB Token     : ${meta?.pcbToken || "None"}`);
  console.log(`Album ID      : ${meta?.albumId || "None"}`);
  console.log(`Rejected Sigs : ${rejected.size} (Covers & Avatars)`);

  const rawUrls = extractMasterUrlsFromHtml(html);
  const purified = purifyImages(rawUrls, rejected);

  console.log(`\nPurification Results:`);
  console.log(`- Raw Master URLs Found : ${rawUrls.length}`);
  console.log(`- Purified Unique Pages : ${purified.length}`);
  console.log(`- Cover Photo Rejected  : ${rejected.rejectedPhotoIds.size > 0 ? "YES ✓" : "NO"}`);
  console.log(`- Sample Master URL 1   : ${purified[0] || "None"}`);
  console.log(`- Sample Master URL Last: ${purified[purified.length - 1] || "None"}`);
  console.log(`=== VERIFICATION COMPLETE ===\n`);
}

/**
 * Benchmark a specific post permalink through the full story-boundary
 * waterfall (live via WARP) — the acceptance gate for the refactored
 * extraction pipeline:
 *
 *   node radar-scraper.mjs --benchmark "https://www.facebook.com/hyperone.eg/posts/pfbid0..."
 */
async function runBenchmark(permalink) {
  console.log(`\n=== STORY-BOUNDARY BENCHMARK ===`);
  console.log(`Permalink: ${permalink}`);

  // Derive the store handle from the URL.
  const handleMatch = /facebook\.com\/([A-Za-z0-9_.-]+)\/posts\//.exec(permalink);
  if (!handleMatch) {
    console.error("FATAL: could not parse handle from permalink URL.");
    process.exit(1);
  }
  const handle = handleMatch[1];
  const store =
    STORES.find((s) => s.handle === handle) ||
    STORES.find((s) => s.handle.toLowerCase() === handle.toLowerCase()) || {
      handle,
      slug: handle,
      name: handle,
    };

  const permalinkHtml = await fetchUrlViaWarp(permalink);
  console.log(`Permalink fetch: ${permalinkHtml.length} bytes`);

  const meta = extractPostMetadata(permalinkHtml);
  if (!meta || !meta.postId) {
    console.error("FATAL: no post metadata extracted from permalink.");
    process.exit(1);
  }
  console.log(`Post ID       : ${meta.postId}`);
  console.log(`Publish Time  : ${meta.publishedAt}`);
  console.log(`PCB Token     : ${meta.pcbToken || "None"}`);
  console.log(`Album ID (diagnostic-only, never paginated): ${meta.albumId || "None"}`);

  const rejected = extractRejectedSignatures(permalinkHtml);
  console.log(
    `Rejected cover/avatar photo ids: ${rejected.rejectedPhotoIds.size} (+${rejected.rejectedSignatures.size} signatures)`
  );

  // Tier 1: pcb mediaset page
  let edges = 0;
  let pcbPurified = [];
  if (meta.pcbToken) {
    const pcbHtml = await fetchUrlViaWarp(
      `https://www.facebook.com/media/set/?set=pcb.${meta.pcbToken}`
    );
    edges = extractMediasetEdges(pcbHtml).length;
    pcbPurified = purifyImages(
      [
        ...extractMediasetEdges(pcbHtml).map((e) => e.uri),
        ...extractMasterUrlsFromHtml(pcbHtml),
      ],
      rejected
    );
    console.log(`Tier 1 PCB page: ${pcbHtml.length}B | mediaset edges: ${edges} | purified: ${pcbPurified.length}`);
  } else {
    console.log("Tier 1 PCB page: SKIPPED (no post-own pcb token)");
  }

  // Tier 2: permalink story window
  const windowUrls = extractStoryWindowUrls(permalinkHtml, meta);
  const windowPurified = purifyImages(windowUrls, rejected);
  console.log(`Tier 2 story window: ${windowUrls.length} raw urls | purified: ${windowPurified.length}`);

  // Full waterfall verdict
  const result = await harvestPostImagesWaterfall(store, meta, permalinkHtml);
  console.log(`\n--- WATERFALL VERDICT ---`);
  console.log(`Tier          : ${result.tier}`);
  console.log(`Unique photos : ${result.images.length}`);
  console.log(`Detail        : ${JSON.stringify(result.detail)}`);
  console.log(`First master  : ${result.images[0] || "None"}`);
  console.log(`Last master   : ${result.images[result.images.length - 1] || "None"}`);
  console.log(`=== BENCHMARK COMPLETE ===\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
