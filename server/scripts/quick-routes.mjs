/* 快速对比各路由返回体：node scripts/quick-routes.mjs [url] */
const base = process.argv[2] || "http://159.75.21.251:3000";
const paths = ["/", "/pricing", "/docs", "/about", "/blog", "/llms.txt", "/robots.txt", "/sitemap.xml"];

const first = await (await fetch(base, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
for (const p of paths) {
  const r = await fetch(base + p, { headers: { "User-Agent": "Mozilla/5.0" } });
  const t = await r.text();
  const tag = t === first ? "同一份 HTML（404→首页回退）" : /<urlset|<sitemapindex/.test(t) ? "sitemap XML" : /^\s*#/.test(t) ? "llms.txt 文本" : /^\s*User-agent/i.test(t) ? "robots 文本" : "其他内容";
  console.log("%-14s %s  %s bytes  %s", p, r.status, t.length, tag);
}
