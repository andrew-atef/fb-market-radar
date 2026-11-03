const BASE = "https://facebook-supermarket-monitor.facebook-supermarket-monitor.workers.dev";
const KEY = "123123456";

async function main() {
  const res = await fetch(`${BASE}/api/posts?key=${KEY}`);
  const posts = await res.json();
  let withImages = 0;
  for (const p of posts) {
    let imgs = [];
    try { imgs = JSON.parse(p.images_json || "[]"); } catch {}
    if (imgs.length) withImages++;
    console.log(
      `${String(imgs.length).padStart(2)} imgs | ${p.store_name.padEnd(24)} | ${p.post_id} | ${imgs[0] ? imgs[0].slice(0, 60) + "..." : "-"}`
    );
  }
  console.log(`\nPosts with images: ${withImages}/${posts.length}`);
}

main();
