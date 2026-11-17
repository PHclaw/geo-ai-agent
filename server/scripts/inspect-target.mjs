/* 细看目标站点：node scripts/inspect-target.mjs [url] */
const base = process.argv[2] || "http://159.75.21.251:3000";

async function grab(path, asText = false) {
  try {
    const r = await fetch(base + path, { headers: { "User-Agent": "Mozilla/5.0" } });
    const body = asText ? await r.text() : await r.text();
    return { status: r.status, ct: r.headers.get("content-type"), body };
  } catch (e) {
    return { status: 0, ct: "", body: `ERR ${e.message}` };
  }
}

const idx = await grab("/");
console.log("=== /  (HTTP %s, %s, %s bytes) ===", idx.status, idx.ct, idx.body.length);
console.log(idx.body);

const llms = await grab("/llms.txt");
console.log("\n=== /llms.txt (HTTP %s, %s bytes) ===", llms.status, llms.body.length);
console.log(llms.body.slice(0, 1600));

const sm = await grab("/sitemap.xml");
console.log("\n=== /sitemap.xml (HTTP %s, %s bytes) ===", sm.status, sm.body.length);
console.log(sm.body.slice(0, 600));

const robots = await grab("/robots.txt");
console.log("\n=== /robots.txt (HTTP %s) ===", robots.status);
console.log(robots.body.slice(0, 400));

/* 常见营销路由是否直接可访问（SPA fallback 会返回同一个 index.html） */
for (const p of ["/pricing", "/docs", "/about", "/blog"]) {
  const r = await grab(p);
  const same = r.body.length === idx.body.length && r.body === idx.body;
  console.log("%s  HTTP %s  %s bytes  %s", p, r.status, r.body.length, same ? "→ 返回同一个空壳（SPA fallback）" : "→ 内容不同");
}
