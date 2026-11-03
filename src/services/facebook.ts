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
    src: string;
    height: number;
    width: number;
  };
  [key: string]: unknown;
}

/** A single subattachment within an attachment. */
export interface Subattachment {
  media: AttachmentMedia;
  [key: string]: unknown;
}

/** A single attachment object. */
export interface Attachment {
  media?: AttachmentMedia;
  subattachments?: {
    data: Subattachment[];
  };
  [key: string]: unknown;
}

/** Shape of the response from GET /{post-id}?fields=attachments{...}. */
export interface PostAttachmentsResponse {
  data: Array<{
    attachments?: Attachment;
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
 * high-resolution image URL from subattachments (and top-level media).
 *
 * GET https://graph.facebook.com/v23.0/{shared_post_id}?fields=attachments{media,subattachments.limit(50){media}}&access_token=...
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
  params.set(
    "fields",
    "attachments{media,subattachments.limit(50){media}}"
  );
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

  for (const item of data.data ?? []) {
    const attachment = item.attachments;
    if (!attachment) continue;

    // Top-level media image
    if (attachment.media?.image?.src) {
      images.push(attachment.media.image.src);
    }

    // Subattachments (carousel / multi-image posts)
    const subattachments = attachment.subattachments?.data ?? [];
    for (const sub of subattachments) {
      if (sub.media?.image?.src) {
        images.push(sub.media.image.src);
      }
    }
  }

  return images;
}