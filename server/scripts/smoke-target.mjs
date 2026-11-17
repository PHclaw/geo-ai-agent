/* 对指定站点做体检并输出诊断依据：node scripts/smoke-target.mjs [url] */
const base = process.env.GEO_BASE || "http://127.0.0.1:8002/api";
const target = process.argv[2] || "http://159.75.21.251:3000";

const token = (
  await (
    await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "13800000000", password: "123456" }),
    })
  ).json()
).token;
const me = await (await fetch(`${base}/me`, { headers: { Authorization: `Bearer ${token}` } })).json();

const t0 = Date.now();
const res = await fetch(`${base}/site/audit`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ brandId: me.brands[0].id, url: target }),
});
const data = await res.json();
console.log("HTTP %s  耗时 %ss", res.status, ((Date.now() - t0) / 1000).toFixed(1));

if (!res.ok) {
  console.log("失败：%s", data.error);
  process.exit(0);
}

console.log("\n=== 体检结论 ===");
console.log("%s  分：%s（%s/%s 项通过）", data.url, data.score, data.passed, data.total);
for (const c of data.checks) {
  console.log("  [%s] %s — %s", c.level.toUpperCase(), c.label, c.detail);
}

console.log("\n=== 技术事实 ===");
const f = data.facts;
console.log("title: %s", f.title || "(空)");
console.log("description: %s", f.desc || "(空)");
console.log("h1: %s | h2 数: %s", f.h1 || "(空)", f.h2Count);
console.log("段落 %s 个，可引用 %s 个 | 可见正文字符 %s | SPA 特征: %s", f.paragraphs, f.quotable, f.readableChars, f.looksSpa);
console.log("JSON-LD 类型: %j", f.jsonLdTypes);
console.log("robots.txt: %s | llms.txt: %s | sitemap URL 数: %s", f.robotsTxt, f.llmsTxt, f.sitemapUrls);
console.log("AI 爬虫探测: %j", f.bots);

/* 额外：看页面实际内容，判断是文档站/应用站/后台 */
try {
  const r = await fetch(target, { headers: { "User-Agent": "Mozilla/5.0" } });
  const html = await r.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  console.log("\n=== 页面正文前 400 字 ===");
  console.log(text.slice(0, 400));
  console.log("\n=== 结构线索 ===");
  console.log("html 长度=%s  script=%s  link=%s  form=%s  iframe=%s", html.length, (html.match(/<script/gi) || []).length, (html.match(/<link/gi) || []).length, (html.match(/<form/gi) || []).length, (html.match(/<iframe/gi) || []).length);
  const ids = [...html.matchAll(/id=["']([^"']+)["']/g)].map((m) => m[1]).slice(0, 12);
  console.log("主要 id: %j", ids);
} catch (e) {
  console.log("页面二次抓取失败: %s", e.message);
}
