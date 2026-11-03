/**
 * GitHub Actions API Service.
 *
 * Responsibilities:
 *   Awakens the GitHub Actions `radar.yml` workflow on a strict, sub-second
 *   Cloudflare Cron schedule (every 10 minutes) via the GitHub REST API.
 *
 * Endpoint:
 *   POST https://api.github.com/repos/{owner}/{repo}/actions/workflows/radar.yml/dispatches
 *
 * Expected status:
 *   204 No Content (queued for immediate execution)
 */

import { Env } from "../types";

export interface GitHubDispatchResult {
  success: boolean;
  status: number;
  message: string;
}

/**
 * Triggers the GitHub Actions `radar.yml` workflow via GitHub workflow_dispatch.
 *
 * @param env - Worker environment bindings
 * @returns Result object with status and description
 */
export async function dispatchGitHubRadarWorkflow(
  env: Env
): Promise<GitHubDispatchResult> {
  const token = env.GITHUB_TOKEN?.trim();
  if (!token) {
    const msg =
      "GITHUB_TOKEN is not configured in Worker secrets. Run: npx wrangler secret put GITHUB_TOKEN";
    console.warn(`[github-dispatch] ${msg}`);
    return { success: false, status: 0, message: msg };
  }

  const repo = (env.GITHUB_REPO || "andrew-atef/fb-market-radar").trim();
  const ref = (env.GITHUB_BRANCH || "main").trim();
  const url = `https://api.github.com/repos/${repo}/actions/workflows/radar.yml/dispatches`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Cloudflare-Worker-FB-Radar",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref }),
    });

    if (response.status === 204) {
      const msg = `GitHub Actions radar workflow dispatched successfully (${repo}@${ref})`;
      console.log(`[github-dispatch] ${msg}`);
      return { success: true, status: 204, message: msg };
    }

    const errorBody = await response.text();
    const errMsg = `GitHub dispatch failed with HTTP ${response.status}: ${errorBody}`;
    console.error(`[github-dispatch] ${errMsg}`);
    return { success: false, status: response.status, message: errMsg };
  } catch (err) {
    const errMsg = `GitHub dispatch error: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[github-dispatch] ${errMsg}`);
    return { success: false, status: 500, message: errMsg };
  }
}
