/**
 * Laravel Ingestion Service.
 *
 * Forwards newly discovered, deduplicated Facebook supermarket posts from
 * the Cloudflare Worker to the Laravel backend ingestion API.
 *
 * Requirements:
 *   - env.LARAVEL_INGEST_URL: Target Laravel ingestion endpoint
 *   - env.LARAVEL_INGEST_SECRET: Shared secret matching Laravel's INGEST_WEBHOOK_SECRET
 *
 * Header sent:
 *   X-Ingest-Secret: {env.LARAVEL_INGEST_SECRET}
 *
 * Payload:
 *   {
 *     "retailer_slug": string,
 *     "facebook_post_id": string,
 *     "post_text": string,
 *     "image_urls": string[],
 *     "published_at": string | null
 *   }
 *
 * Expected Laravel response: HTTP 202 Accepted.
 */

import { Env } from "../types";

export interface LaravelForwardPayload {
  retailerSlug: string;
  postId: string;
  postText?: string | null;
  imageUrls: string[];
  publishedAt?: string | null;
}

export interface LaravelForwardResult {
  forwarded: boolean;
  statusCode: number;
  statusText: string;
  responseBody?: unknown;
}

/**
 * Dispatches a POST request to the Laravel ingestion webhook.
 */
export async function forwardToLaravel(
  env: Env,
  payload: LaravelForwardPayload
): Promise<LaravelForwardResult> {
  const url = env.LARAVEL_INGEST_URL?.trim();
  if (!url) {
    console.log("[laravel-ingest] LARAVEL_INGEST_URL is not set; post stored locally only.");
    return {
      forwarded: false,
      statusCode: 0,
      statusText: "Local Only",
    };
  }

  const secret = env.LARAVEL_INGEST_SECRET?.trim() || "";
  const requestBody = {
    retailer_slug: payload.retailerSlug,
    facebook_post_id: payload.postId,
    post_text: payload.postText || "",
    image_urls: payload.imageUrls,
    published_at: payload.publishedAt || new Date().toISOString(),
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (secret) {
    headers["X-Ingest-Secret"] = secret;
  }

  try {
    console.log(
      `[laravel-ingest] Dispatching to Laravel: ${url} (retailer=${payload.retailerSlug}, post_id=${payload.postId}, images=${payload.imageUrls.length})`
    );

    // Use redirect: "manual" so we can intercept 301/302 redirects and preserve POST method
    let targetUrl = url;
    let response = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      redirect: "manual",
    });

    // If redirected (e.g. trailing slash or HTTP -> HTTPS), re-post to Location
    if (
      response.status === 301 ||
      response.status === 302 ||
      response.status === 307 ||
      response.status === 308 ||
      (response.status >= 300 && response.status < 400)
    ) {
      const location = response.headers.get("Location");
      if (location) {
        targetUrl = new URL(location, url).toString();
        console.log(`[laravel-ingest] Intercepted redirect ${response.status} -> Re-POSTing to: ${targetUrl}`);
        response = await fetch(targetUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody),
        });
      }
    }

    const responseText = await response.text().catch(() => "");
    let parsedBody: unknown = null;
    try {
      parsedBody = JSON.parse(responseText);
    } catch {
      parsedBody = responseText;
    }

    const allowHeader = response.headers.get("Allow");
    console.log(
      `[laravel-ingest] Laravel responded HTTP ${response.status} for post ${payload.postId}` +
      (allowHeader ? ` (Allow: ${allowHeader})` : "") +
      ` (target: ${targetUrl}):`,
      typeof parsedBody === "object" ? JSON.stringify(parsedBody) : String(parsedBody).slice(0, 300)
    );

    // HTTP 202 Accepted is the primary contract; accept any 2xx
    const isSuccess = response.status === 202 || (response.status >= 200 && response.status < 300);

    return {
      forwarded: isSuccess,
      statusCode: response.status,
      statusText: isSuccess ? `Forwarded (${response.status})` : `Failed (${response.status})`,
      responseBody: parsedBody,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[laravel-ingest] Network exception while forwarding to Laravel: ${errorMsg}`);
    return {
      forwarded: false,
      statusCode: 500,
      statusText: `Error: ${errorMsg}`,
    };
  }
}

/**
 * Diagnostic test probe for the Laravel ingestion webhook.
 */
export async function testLaravelIngest(
  env: Env
): Promise<{
  configured: boolean;
  url: string | null;
  hasSecret: boolean;
  status: number;
  statusText: string;
  body: unknown;
}> {
  const url = env.LARAVEL_INGEST_URL?.trim();
  if (!url) {
    return {
      configured: false,
      url: null,
      hasSecret: Boolean(env.LARAVEL_INGEST_SECRET),
      status: 0,
      statusText: "LARAVEL_INGEST_URL is not configured",
      body: null,
    };
  }

  const result = await forwardToLaravel(env, {
    retailerSlug: "gomlamarket",
    postId: "test_probe_" + Date.now(),
    postText: "Probe test from Cloudflare Worker",
    imageUrls: ["https://example.com/test.jpg"],
    publishedAt: new Date().toISOString(),
  });

  return {
    configured: true,
    url,
    hasSecret: Boolean(env.LARAVEL_INGEST_SECRET),
    status: result.statusCode,
    statusText: result.statusText,
    body: result.responseBody,
  };
}
