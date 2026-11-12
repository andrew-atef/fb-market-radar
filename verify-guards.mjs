/**
 * PERMANENT STRUCTURAL DEFENSE — diagnostic verification script.
 *
 * Run on the VPS (or locally with RADAR_DIRECT=1):
 *   node verify-guards.mjs
 *
 * Verifies the structural guards added to radar-scraper.mjs after the
 * 2026-11-12 corrupted-flyer investigation:
 *   GUARD A — purification gate: video/reel poster frames and low-res
 *             previews are discarded; only 2K/1080p master classes pass.
 *   GUARD B — video shield (LIVE): the El Fergany reel post is detected as
 *             VIDEO/REEL and strictly skipped, root-feed blind or not.
 *   GUARD C — regression (LIVE): genuine multi-photo catalogs still yield
 *             their full ground-truth sets (HyperOne = 6, El Fergany = 48).
 *
 * IMPORTANT ORDERING: radar-scraper.mjs captures WORKER_URL/WORKER_KEY at
 * module-load time. The radar.env bootstrap MUST run BEFORE the scraper is
 * imported, hence the dynamic import below (a static import would evaluate
 * first and leave the Graph ground-truth tier blind — that was the cause of
 * the "El Fergany 24 vs 48" harness failure on the VPS).
 *
 * Exit code 0 = ALL GUARDS PASS; 1 = at least one guard FAILED.
 */

/* ------------------------------------------------------------------ */
/* 1. Env bootstrap FIRST (before the scraper import)                  */
/* ------------------------------------------------------------------ */
if (!process.env.WORKER_URL) {
  try {
    const fs = await import("node:fs");
    const envText = fs.readFileSync("./radar.env", "utf8");
    for (const line of envText.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const key = m[1];
      let value = m[2];
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
    console.log("[verify] Loaded credentials from ./radar.env");
  } catch {
    console.log("[verify] No ./radar.env — Graph ground-truth tier will be limited.");
  }
}

/* ------------------------------------------------------------------ */
/* 2. Scraper import (dynamic — after env bootstrap)                   */
/* ------------------------------------------------------------------ */
const {
  extractPostMetadata,
  purifyImages,
  harvestPostImagesWaterfall,
  fetchUrlViaWarpAuto,
} = await import("./radar-scraper.mjs");

let failures = 0;

const okay = (name, detail) => {
  console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
};
const bad = (name, detail) => {
  failures += 1;
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------------------------ */
/* GUARD A: Synthetic purification gate                                */
/* ------------------------------------------------------------------ */
console.log("\n=== GUARD A: PURIFICATION GATE (synthetic) ===");
{
  const legitMaster =
    "https://scontent.fcai19-2.fna.fbcdn.net/v/t39.99422-6/900353051_1668230521606102_3758397472483641467_n.png?stp=dst-jpg_tt6&cstp=mx2048x2048&ctp=s960x960&_nc_cat=109&oh=00_AAA&oe=6AFAF7DE";
  const legitMaster1080 =
    "https://scontent.fcai19-2.fna.fbcdn.net/v/t39.30808-6/111222333_444555666_777888999_n.jpg?stp=dst-jpg_p1080x1080&_nc_cat=100&oh=00_BBB&oe=6AFAF7DE";
  const raws = [
    // Video / reel poster frames — MUST be discarded
    "https://scontent.fcai19-2.fna.fbcdn.net/m1/v/t6/123456789_987654321_112233445_n.jpg?_nc_cat=1",
    "https://scontent.fcai19-2.fna.fbcdn.net/v/t6/123456789_987654322_112233446_n.jpg?_nc_cat=2",
    "https://scontent.fcai19-2.fna.fbcdn.net/v/t15/123456789_987654323_112233447_n.jpg?_nc_cat=3",
    "https://scontent.fcai19-2.fna.fbcdn.net/v/t42.1790-2/123456789_987654324_112233448_n.jpg?_nc_cat=4",
    "https://scontent.fcai19-2.fna.fbcdn.net/v/t6.27914-2/video_thumb_123456789_987654325_112233449_n.jpg?_nc_cat=5",
    "https://www.facebook.com/emoji.php/v/1/emoji/emoji_one_v3.png",
    // Reel thumbnail family (t15.5256-10): not a photo master family —
    // excluded by the MASTER_CLASS whitelist even though /v/t15/ as a
    // literal token does not match "/v/t15.5256-10/".
    "https://scontent.fcai19-2.fna.fbcdn.net/v/t15.5256-10/902441724_1879070719758452_7575245292490711373_n.avif?stp=dst-jpg_tt6&_nc_cat=12",
    // Low-res previews / grid crops — MUST be discarded
    "https://scontent.fcai19-2.fna.fbcdn.net/v/t39.30808-6/123456789_987654331_112233451_n.jpg?stp=s720x720&_nc_cat=6",
    "https://scontent.fcai19-2.fna.fbcdn.net/v/t39.30808-6/123456789_987654332_112233452_n.jpg?stp=s552x414&_nc_cat=7",
    "https://scontent.fcai19-2.fna.fbcdn.net/v/t39.30808-6/123456789_987654333_112233453_n.jpg?stp=s320x320&_nc_cat=8",
    "https://scontent.fcai19-2.fna.fbcdn.net/v/t39.30808-6/123456789_987654334_112233454_n.jpg?stp=p240x240&_nc_cat=9",
    "https://scontent.fcai19-2.fna.fbcdn.net/v/t39.30808-6/123456789_987654335_112233455_n.jpg?stp=s100x100&_nc_cat=10",
    "https://scontent.fcai19-2.fna.fbcdn.net/t39.30808-1/123456789_987654336_112233456_n.jpg?stp=s150x150&_nc_cat=11",
    // Legit masters — MUST survive
    legitMaster,
    legitMaster1080,
  ];
  const purified = purifyImages(raws);
  const survivedVideo = purified.some((u) =>
    /\/m1\/v\/t6\/|\/v\/t6\/|\/v\/t15\/|t42\.1790-2|t6\.27914|video_thumb|emoji\.php|t15\.5256/.test(u)
  );
  const survivedLowres = purified.some((u) =>
    /s720x720|s552x414|s320x320|p240x240|s100x100|s150x150|s50x50|p50x50/i.test(u)
  );
  const survivedLegit = purified.includes(legitMaster) && purified.includes(legitMaster1080);
  const onlyLegit = purified.length === 2 && survivedLegit;
  if (!survivedVideo) okay("VIDEO_MARKERS rejected (all 8 video/UI assets discarded)");
  else bad("VIDEO_MARKERS rejection", `leaked: ${JSON.stringify(purified)}`);
  if (!survivedLowres) okay("LOWRES_MARKER rejected (all 6 compressed previews discarded)");
  else bad("LOWRES_MARKER rejection", `leaked: ${JSON.stringify(purified)}`);
  if (onlyLegit) okay("MASTER_CLASS whitelist", "exactly the 2 legit 2K/1080p masters survived");
  else bad("MASTER_CLASS whitelist", `survivors: ${JSON.stringify(purified)}`);
}

/* ------------------------------------------------------------------ */
/* GUARD B: Live video/reel rejection — El Fergany reel post            */
/* ------------------------------------------------------------------ */
console.log("\n=== GUARD B: VIDEO/REEL SHIELD (live) ===");
// The production corrupted flyer (2026-11-12): El Fergany's LATEST post on
// the root feed is a reel — post 1551060330389769 (2026-11-11T18:59Z).
// Its own Video node id is 1766217484492277 (its comments link to
// facebook.com/reel/1766217484492277). Note: posts/pfbid02PAccyXGKAjVqFXkhGiQVWmMe5RuCv6t4JMXFH5XpJ7TjAhZve5YmbB8jthAvih5Pl
// canonicalizes to the 48-photo album post 1548563663972769, NOT to the reel.
// Same verified-reel structure: seoudi 1133696949382206 (video 1752063485862706)
// and hyperone 1593417299493252 (video 1172807188640244) — flagged correctly
// in production run 2.
const VIDEO_POST_URL = "https://www.facebook.com/marketelfergany/posts/1551060330389769";
{
  try {
    const html = await fetchUrlViaWarpAuto(VIDEO_POST_URL, { minBytes: 500_000 });
    const meta = extractPostMetadata(html);
    if (meta && meta.isVideo) {
      okay(
        "El Fergany reel post flagged VIDEO/REEL (permalink)",
        `postId=${meta.postId} signals=[${meta.videoSignals.join(", ")}]`
      );
    } else {
      bad(
        "El Fergany reel post flagged VIDEO/REEL (permalink)",
        `isVideo=${meta ? meta.isVideo : "no meta"} signals=${
          meta ? meta.videoSignals.join(", ") : "-"
        }`
      );
    }
    // Full-pipeline check: even when the ROOT FEED missed the video (meta
    // without isVideo), Tier 2 re-checks on the permalink and refuses to
    // extract poster frames.
    const store = { handle: "marketelfergany", slug: "marketelfergany", name: "El Fergany" };
    const blindMeta = { ...meta, isVideo: false, videoSignals: [] };
    const result = await harvestPostImagesWaterfall(store, blindMeta, html);
    if (
      result.tier === "SKIPPED_VIDEO_REEL" &&
      result.images.length === 0
    ) {
      okay(
        "Tier 2 video re-check",
        "waterfall returned SKIPPED_VIDEO_REEL with 0 images even with a blind root-feed meta"
      );
    } else {
      bad(
        "Tier 2 video re-check",
        `tier=${result.tier} images=${result.images.length} detail=${JSON.stringify(result.detail)}`
      );
    }
  } catch (err) {
    bad("El Fergany reel post fetch", err.message);
  }
}

/* ------------------------------------------------------------------ */
/* GUARD C: Live regression — genuine catalogs keep full sets          */
/* ------------------------------------------------------------------ */
console.log("\n=== GUARD C: LIVE REGRESSION (genuine multi-photo catalogs) ===");

async function benchmarkLive(url, handle, expected, label) {
  try {
    const permalinkHtml = await fetchUrlViaWarpAuto(url, { minBytes: 500_000 });
    const meta = extractPostMetadata(permalinkHtml);
    if (!meta || !meta.postId) {
      bad(label, "no post metadata extracted");
      return;
    }
    if (meta.isVideo) {
      bad(label, `unexpectedly flagged as VIDEO [${meta.videoSignals.join(", ")}]`);
      return;
    }
    const store = { handle, slug: handle, name: handle };
    const result = await harvestPostImagesWaterfall(store, meta, permalinkHtml);
    const got = result.images.length;
    if (got === expected) {
      okay(label, `tier=${result.tier} unique masters=${got}`);
    } else {
      bad(label, `expected ${expected}, got ${got} (tier=${result.tier}, detail=${JSON.stringify(result.detail)})`);
    }
  } catch (err) {
    bad(label, err.message);
  }
}

await benchmarkLive(
  "https://www.facebook.com/hyperone.eg/posts/1590420966459552",
  "hyperone.eg",
  6,
  "HyperOne story catalog"
);

if (process.env.WORKER_URL && process.env.WORKER_KEY) {
  await benchmarkLive(
    "https://www.facebook.com/marketelfergany/posts/1548563663972769",
    "marketelfergany",
    48,
    "El Fergany album catalog (Graph ground truth)"
  );
} else {
  console.log("  SKIP  El Fergany album catalog — WORKER_URL/WORKER_KEY not set (Graph tier needs the page token; run.sh loads radar.env on the VPS)");
}

/* ------------------------------------------------------------------ */
console.log("\n=== VERIFY-GUARDS SUMMARY ===");
if (failures === 0) {
  console.log("ALL GUARDS PASS — structural defense verified.");
  process.exit(0);
} else {
  console.log(`${failures} GUARD(S) FAILED — do not deploy.`);
  process.exit(1);
}
