/**
 * Meta Graph API v23.0 client.
 *
 * Responsibilities:
 *  1. Auto-publish newly discovered supermarket posts to the configured
 *     Facebook Page as a link share (permanent page access token).
 *  2. Fetch the full attachment graph of the shared post to extract
 *     high-resolution image URLs from subattachments.
 */

import { Env } from "../types";

const GRAPH_BASE = "https://graph.facebook.com/v23.0";

/** Shape of the response from POST /{page-id}/feed. */
export interface FacebookShareResponse {
  id: string;
  success: boolean;
}

/** Media object inside an attachment or subattachment. */
export interface AttachmentMedia {
  image?: {
    src?: string;
    height?: number;
    width?: number;
  };
  source?: string;
  [key: string]: unknown;
}

/** A single subattachment within an attachment (individual album photos). */
export interface Subattachment {
  media?: AttachmentMedia;
  target?: {
    id?: string;
    url?: string;
  };
  type?: string;
  url?: string;
  [key: string]: unknown;
}

/** A single attachment object. */
export interface Attachment {
  media?: AttachmentMedia;
  subattachments?: {
    data?: Subattachment[];
  };
  target?: {
    id?: string;
    url?: string;
  };
  title?: string;
  type?: string;
  url?: string;
  [key: string]: unknown;
}

/**
 * Shape of the response from GET /{post-id}?fields=attachments,child_attachments.
 * Meta returns the post object directly containing `attachments` and `id`.
 */
export interface PostAttachmentsResponse {
  id?: string;
  attachments?: {
    data?: Attachment[];
  };
  child_attachments?: {
    data?: Array<{ media?: AttachmentMedia; [key: string]: unknown }>;
  };
  /** Fallback in case Meta wraps the response in a connection-style data array. */
  data?: Array<{
    attachments?: Attachment;
    child_attachments?: {
      data?: Array<{ media?: AttachmentMedia }>;
    };
  }>;
  [key: string]: unknown;
}

/**
 * Shares a link post to the configured Facebook Page.
 *
 * POST https://graph.facebook.com/v23.0/{FB_PAGE_ID}/feed
 *
 * @param env   - Worker environment bindings
 * @param link  - Original Facebook post URL to share
 * @param message - Message text to accompany the link
 * @returns The shared post ID (format: {page_id}_{post_id}), or null on failure
 * @throws If the Graph API returns a non-OK status
 */
export async function shareToFacebookPage(
  env: Env,
  link: string,
  message: string
): Promise<string | null> {
  const url = `${GRAPH_BASE}/${env.FB_PAGE_ID}/feed`;
  const body = new URLSearchParams();
  body.set("link", link);
  body.set("message", message);
  body.set("access_token", env.FB_PAGE_ACCESS_TOKEN);
  body.set("published", "true");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Facebook share error: ${response.status} ${errorBody}`
    );
  }

  const data = (await response.json()) as { id?: string };
  return data.id ?? null;
}

/**
 * Fetches the full attachment graph for a shared post and extracts every
 * image URL from subattachments (and top-level media).
 *
 * GET https://graph.facebook.com/v23.0/{shared_post_id}?fields=attachments,child_attachments&access_token=...
 *
 * @param env          - Worker environment bindings
 * @param sharedPostId - The shared post ID returned by the feed publish step
 * @returns Array of high-resolution image source URLs
 * @throws If the Graph API returns a non-OK status
 */
export async function fetchPostAttachments(
  env: Env,
  sharedPostId: string
): Promise<string[]> {
  const url = `${GRAPH_BASE}/${encodeURIComponent(sharedPostId)}`;
  const params = new URLSearchParams();
  // Standard fields query as confirmed working with Graph API v23.0:
  // automatically expands media, image, and all subattachments in the album.
  params.set("fields", "attachments,child_attachments");
  params.set("access_token", env.FB_PAGE_ACCESS_TOKEN);

  const response = await fetch(`${url}?${params.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Facebook attachments error: ${response.status} ${errorBody}`
    );
  }

  const data = (await response.json()) as PostAttachmentsResponse;
  return extractImageUrls(data);
}

/**
 * Fetches the COMPLETE story photo set behind one of OUR OWN shared posts —
 * the Graph-API ground truth for story-bound enrichment.
 *
 * Why: anonymous SSR scraping of a multi-photo post can only see the FIRST
 * page of the post's own pcb mediaset (24 of e.g. 47 photos for El Fergany).
 * Every other anonymous continuation channel is dead (GraphQL error shell,
 * mbasic/m/touch unavailable, dialogs = login wall). But when the Worker
 * shares the post to OUR page, Facebook mirrors the ORIGINAL post's FULL
 * attachment set onto the share — and we own that share, so the page token
 * reads every subattachment.
 *
 * Step 1 — enumerate photo fbids:
 *   GET /{shared_post_id}?fields=attachments{media,subattachments.limit(100){media,target}}
 * Step 2 — resolve each photo's MASTER rendition:
 *   GET /?ids=<fbids>[,fbids...]&fields=images{source,width,height}
 *   (batched 50 ids per call; `images.source` is the unconstrained master)
 *
 * @param env          - Worker environment bindings
 * @param sharedPostId - Our page's share of the story ({page_id}_{post_id})
 * @returns Array of { fbid, master } photo records
 */
export interface StoryPhotoMaster {
  fbid: string;
  master: string;
  width?: number;
  height?: number;
}

export async function fetchStoryPhotoMasters(
  env: Env,
  sharedPostId: string
): Promise<StoryPhotoMaster[]> {
  // --- Step 1: enumerate the story's photo fbids from the share ---
  const attUrl = `${GRAPH_BASE}/${encodeURIComponent(sharedPostId)}`;
  const attParams = new URLSearchParams();
  attParams.set(
    "fields",
    "attachments{media,subattachments.limit(100){media,target}}"
  );
  attParams.set("access_token", env.FB_PAGE_ACCESS_TOKEN);

  const attResponse = await fetch(`${attUrl}?${attParams.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!attResponse.ok) {
    const errorBody = await attResponse.text();
    throw new Error(
      `Facebook shared-post attachments error: ${attResponse.status} ${errorBody}`
    );
  }
  const attData = (await attResponse.json()) as PostAttachmentsResponse;

  const fbids = new Set<string>();
  for (const att of attData.attachments?.data ?? []) {
    for (const sub of att.subattachments?.data ?? []) {
      const tid = sub.target?.id;
      if (tid && /^\d{10,20}$/.test(tid)) fbids.add(tid);
    }
  }
  if (fbids.size === 0) return [];

  // --- Step 2: batch-resolve each photo's master rendition ---
  const idList = [...fbids];
  const masters: StoryPhotoMaster[] = [];
  for (let i = 0; i < idList.length; i += 50) {
    const chunk = idList.slice(i, i + 50);
    const imgParams = new URLSearchParams();
    imgParams.set("ids", chunk.join(","));
    imgParams.set("fields", "images{source,width,height}");
    imgParams.set("access_token", env.FB_PAGE_ACCESS_TOKEN);

    const imgResponse = await fetch(`${GRAPH_BASE}/?${imgParams.toString()}`, {
      headers: { Accept: "application/json" },
    });
    if (!imgResponse.ok) {
      const errorBody = await imgResponse.text();
      throw new Error(
        `Facebook photo images error: ${imgResponse.status} ${errorBody}`
      );
    }
    const imgData = (await imgResponse.json()) as Record<
      string,
      {
        images?: Array<{ source?: string; width?: number; height?: number }>;
      }
    >;

    for (const fbid of chunk) {
      const images = imgData[fbid]?.images ?? [];
      // `images` lists every rendition; the widest entry is the master.
      let best: { source: string; width: number } | null = null;
      for (const img of images) {
        if (!img.source) continue;
        if (!best || (img.width ?? 0) > best.width) {
          best = { source: img.source, width: img.width ?? 0 };
        }
      }
      if (best) {
        masters.push({
          fbid,
          master: best.source,
          width: best.width,
          height: undefined,
        });
      }
    }
  }

  return masters;
}

/**
 * Fetches the ORIGINAL downstream post's preview image via the public
 * OpenGraph meta tags (og:image).
 *
 * This is where the real product image lives — our own share is a link
 * post and carries no attachments of its own.
 *
 * Graph API routes are NOT usable here: foreign-page post reads and
 * oEmbed require Meta app-review permissions. The OpenGraph HTML served
 * to embedder crawlers (User-Agent "facebookexternalhit") is public and
 * contains a fresh CDN image URL.
 *
 * @param env          - Worker environment bindings (unused, kept for parity)
 * @param originPostUrl - Full URL of the supermarket's original post
 * @returns Array containing the image URL when present
 * @throws If the HTTP fetch fails or returns a non-OK status
 */
export async function fetchOriginPostImages(
  _env: Env,
  originPostUrl: string
): Promise<string[]> {
  const response = await fetch(originPostUrl, {
    headers: {
      "User-Agent": "facebookexternalhit/1.1",
      Accept: "text/html",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Facebook OpenGraph fetch error: ${response.status} for ${originPostUrl}`
    );
  }

  const html = await response.text();
  const match = html.match(
    /<meta\s+property="og:image"\s+content="([^"]+)"/
  );
  if (!match) return [];

  const imageUrl = match[1].replace(/&amp;/g, "&");
  return imageUrl ? [imageUrl] : [];
}

/** Shared extraction: top-level media + all subattachment media images. */
function extractImageUrls(data: PostAttachmentsResponse): string[] {
  const images: string[] = [];

  const addImage = (src?: string | null) => {
    if (!src || typeof src !== "string") return;
    const cleanUrl = src.replace(/&amp;/g, "&").trim();
    if (cleanUrl.startsWith("http") && !images.includes(cleanUrl)) {
      images.push(cleanUrl);
    }
  };

  // 1. Primary path: attachments.data (direct post object from Graph API)
  const attachments = data.attachments?.data ?? [];
  for (const attachment of attachments) {
    const subattachments = attachment.subattachments?.data ?? [];
    if (subattachments.length > 0) {
      // Album / multi-photo post: subattachments hold each flyer page in exact order
      for (const sub of subattachments) {
        addImage(sub.media?.image?.src || sub.media?.source);
      }
    } else if (attachment.media?.image?.src || attachment.media?.source) {
      // Single photo post
      addImage(attachment.media?.image?.src || attachment.media?.source);
    }
  }

  // 2. Child attachments (multi-media link shares)
  const childAttachments = data.child_attachments?.data ?? [];
  for (const child of childAttachments) {
    addImage(child.media?.image?.src || child.media?.source);
  }

  // 3. Fallback: if Meta returned wrapped data array
  if (Array.isArray(data.data)) {
    for (const item of data.data) {
      if (item.attachments) {
        const sub = item.attachments.subattachments?.data ?? [];
        if (sub.length > 0) {
          for (const s of sub) {
            addImage(s.media?.image?.src || s.media?.source);
          }
        } else if (
          item.attachments.media?.image?.src ||
          item.attachments.media?.source
        ) {
          addImage(
            item.attachments.media?.image?.src || item.attachments.media?.source
          );
        }
      }
      for (const child of item.child_attachments?.data ?? []) {
        addImage(child.media?.image?.src || child.media?.source);
      }
    }
  }

  return images;
}