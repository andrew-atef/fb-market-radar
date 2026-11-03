/**
 * Google Alerts Atom feed client — free, keyless discovery source.
 *
 * Replaces the Google Custom Search JSON API. The feed URL (a Google
 * Alerts RSS/Atom feed built from the same site:* OR site:* query) is
 * polled every 5 minutes from the Worker cron.
 *
 * Feed quirks handled here:
 *  - `published`/`updated` are epoch-zero → useless; we derive times ourselves.
 *  - Links are Google redirects: the real Facebook post URL is inside the
 *    `url=` query param and is percent-encoded TWICE (Arabic slugs).
 *  - `<content>` embeds Facebook's relative post age at Google's CRAWL time
 *    (e.g. "22m · Públic."). Comment ages (e.g. "10m.") end with a dot and
 *    are ignored — post ages are anchored by the middot separator "·".
 */

import { Env, AlertsFeedItem, StoreConfig } from "../types";

/** The 10 Egyptian supermarket Facebook pages we monitor. */
export const SUPERMARKET_STORES: StoreConfig[] = [
  { name: "Kazyon Egypt", facebookPage: "kazyonegypt" },
  { name: "BIM Stores Egypt", facebookPage: "BIMStoresEgypt" },
  { name: "Fathalla Market 1948", facebookPage: "Fathallamarket1948" },
  { name: "Kheir Zaman Egypt", facebookPage: "KheirZamanEgypt" },
  { name: "Al Mahmal", facebookPage: "AlMahmal" },
  { name: "Zahran Market", facebookPage: "ZahranMarket" },
  { name: "Fergani Market", facebookPage: "FerganiMarket" },
  { name: "Oscar Stores", facebookPage: "OscarStores" },
  { name: "Spinneys Egypt", facebookPage: "SpinneysEgypt" },
  { name: "Hyper One", facebookPage: "HyperOne" },
];

/** Facebook URL host aliases to ignore when matching store slugs. */
const HOST_ALIASES = new Set([
  "www",
  "web",
  "m",
  "mbasic",
  "l",
  "i",
  "touch",
  "x",
]);

/** Unit → minutes multipliers for Facebook relative ages. */
const AGE_UNIT_MINUTES: Record<string, number> = {
  m: 1,
  h: 60,
  d: 1440,
};

/** Raw successful feed response type. */
export interface RawFeedEntry {
  entryId: string;
  title: string;
  href: string;
  content: string;
}

/**
 * Decodes the handful of HTML entities Google embeds in the feed.
 * Order matters: &amp; is decoded LAST so double-encoded entities survive.
 */
export function htmlUnescape(input: string): string {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Parses the Google Alerts Atom feed into raw entries using a small,
 * zero-dependency regex parser (the feed structure is simple and stable).
 */
export function parseAtomFeed(xml: string): RawFeedEntry[] {
  const entries: RawFeedEntry[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    const idMatch = block.match(/googlealerts\/feed:(\d+)/);
    const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/);
    const hrefMatch = block.match(/<link\s+href="([^"]+)"/);
    const contentMatch = block.match(/<content[^>]*>([\s\S]*?)<\/content>/);

    if (!idMatch || !hrefMatch) continue;

    entries.push({
      entryId: idMatch[1],
      title: titleMatch ? htmlUnescape(titleMatch[1]) : "",
      href: htmlUnescape(hrefMatch[1]),
      content: contentMatch ? htmlUnescape(contentMatch[1]) : "",
    });
  }

  return entries;
}

/**
 * Extracts the real Facebook post URL from a Google redirect link.
 * The `url=` param value is percent-encoded TWICE by Google Alerts.
 * Trailing `?locale=..` query strings are stripped.
 */
export function extractRealPostUrl(href: string): string | null {
  const m = href.match(/url=([^&]+)/);
  if (!m) return null;

  let url: string;
  try {
    url = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  try {
    url = decodeURIComponent(url);
  } catch {
    /* already decoded once — fine */
  }

  return url.split("?")[0] || null;
}

/**
 * Extracts the numeric Facebook post ID from a decoded post URL.
 * Uses the LAST pure-numeric path segment of length >= 10 (IDs are
 * 15-16 digits). Arabic slugs may contain short numbers like "2000"
 * inside "ب-2000-جنيه" — those can never match by construction.
 */
export function extractPostIdFromUrl(url: string): string | null {
  const path = url.replace(/^https?:\/\/[^/]+/i, "");
  const segments = path.split(/[/?]/).filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i--) {
    if (/^\d{10,}$/.test(segments[i])) {
      return segments[i];
    }
  }

  const fallbacks = [
    /\/posts\/(\d{10,})/i,
    /\/photos\/(\d{10,})/i,
    /story_fbid=(\d{10,})/,
    /fbid=(\d{10,})/,
  ];
  for (const pattern of fallbacks) {
    const m = url.match(pattern);
    if (m) return m[1];
  }
  return null;
}

/**
 * Extracts the store slug from `/facebook.com/{slug}/posts/` and maps it
 * to the configured store name (case-insensitive). Host aliases skipped.
 */
export function extractStoreNameFromUrl(url: string): string | null {
  const m = url.match(/facebook\.com\/([^/?#]+)\/(?:posts|photos)\//i);
  if (!m) return null;

  const slug = m[1];
  if (HOST_ALIASES.has(slug.toLowerCase())) return null;

  const store = SUPERMARKET_STORES.find(
    (s) => s.facebookPage.toLowerCase() === slug.toLowerCase()
  );
  return store ? store.name : null;
}

/**
 * Parses Facebook's relative post age from the feed content.
 * POST ages use a middot separator (e.g. "22m · Public", "3h · Public")
 * while COMMENT ages use a dot (e.g. "10m." after a commenter's name).
 * Returns age in minutes, or null when no marker exists.
 */
export function parsePostAgeMinutes(content: string): number | null {
  const m = content.match(/(\d+)\s*([mhd])\s*[·•]/);
  if (!m) return null;

  const value = parseInt(m[1], 10);
  const multiplier = AGE_UNIT_MINUTES[m[2].toLowerCase()];
  if (!Number.isFinite(value) || !multiplier) return null;

  return value * multiplier;
}

/**
 * Returns the raw age marker string (e.g. "22m") for storage/debugging.
 */
export function extractAgeMarkerRaw(content: string): string | null {
  const m = content.match(/(\d+)\s*([mhd])\s*[·•]/);
  return m ? `${m[1]}${m[2]}` : null;
}

/** Trims Google's " - Facebook" suffix and whitespace from a title. */
function cleanTitle(title: string): string {
  return title
    .replace(/\s*-\s*Facebook\s*$/i, "")
    .trim();
}

/** Normalises the snippet text a bit (collapses whitespace). */
function cleanSnippet(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

/**
 * Fetches the Google Alerts feed and converts entries into typed,
 * pipeline-ready items. Entries that don't map to a monitored store or
 * lack an extractable numeric post ID are skipped.
 *
 * @throws when the HTTP fetch fails or returns a non-OK status
 */
export async function fetchAlertsFeedItems(
  env: Env
): Promise<AlertsFeedItem[]> {
  const response = await fetch(env.GOOGLE_ALERTS_FEED_URL, {
    headers: {
      "User-Agent": "SupermarketMonitor/1.0 (+cloudflare-worker)",
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Google Alerts feed error: ${response.status} ${errorBody}`
    );
  }

  const xml = await response.text();
  const rawEntries = parseAtomFeed(xml);
  const items: AlertsFeedItem[] = [];

  for (const entry of rawEntries) {
    const postUrl = extractRealPostUrl(entry.href);
    if (!postUrl) continue;

    const postId = extractPostIdFromUrl(postUrl);
    if (!postId) continue;

    const storeName = extractStoreNameFromUrl(postUrl);
    if (!storeName) continue;

    items.push({
      entryId: entry.entryId,
      postId,
      storeName,
      storeSlug: postUrl.match(/facebook\.com\/([^/?#]+)\/(?:posts|photos)\//i)?.[1] ?? "",
      postUrl,
      title: cleanTitle(entry.title),
      snippet: cleanSnippet(entry.content),
      ageMinutes: parsePostAgeMinutes(entry.content),
      ageMarkerRaw: extractAgeMarkerRaw(entry.content),
    });
  }

  return items;
}