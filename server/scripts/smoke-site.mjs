/* 站点体检与资产生成验证：node scripts/smoke-site.mjs */
const base = process.env.GEO_BASE || "http://127.0.0.1:8002/api";

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
const brandId = me.brands[0].id;

async function audit(url) {
  const t0 = Date.now();
  const res = await fetch(`${base}/site/audit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ brandId, url }),
  });
  const data = await res.json();
  const ms = Date.now() - t0;
  if (!res.ok) {
    console.log("\n[%s] 失败 %s: %s", url, res.status, data.error);
    return null;
  }
  console.log("\n[%s] %s 分（%s）耗时 %ss", data.url, data.score, data.grade, (ms / 1000).toFixed(1));
  for (const c of data.checks) {
    console.log("   %s  %s — %s", c.level === "pass" ? "PASS" : c.level === "warn" ? "WARN" : "FAIL", c.label, c.detail);
  }
  console.log("   facts: title=%s h1=%s p=%s quotable=%s readable=%s spa=%s llms=%s sitemap=%s jsonld=%j",
    data.facts.title ? data.facts.title.slice(0, 18) : "-", data.facts.h1 ? data.facts.h1.slice(0, 12) : "-",
    data.facts.paragraphs, data.facts.quotable, data.facts.readableChars, data.facts.looksSpa,
    data.facts.llmsTxt, data.facts.sitemapUrls, data.facts.jsonLdTypes);
  return data;
}

await audit("example.com");
await audit("geolook.cc");

/* 资产生成 */
const a = await (
  await fetch(`${base}/site/assets?brandId=${brandId}&url=https%3A%2F%2Fexample.com`, {
    headers: { Authorization: `Bearer ${token}` },
  })
).json();
console.log("\n=== 资产 ===");
console.log("stores=%s faqCount=%s llmsChars=%s", a.storeCount, a.faqCount, (a.llmsTxt || "").length);
console.log("--- llms.txt 前 26 行 ---");
console.log((a.llmsTxt || "").split("\n").slice(0, 26).join("\n"));
console.log("--- JSON-LD business ---");
try {
  const b = JSON.parse(a.jsonLdBusiness);
  console.log("@type=%s name=%s priceRange=%s dept=%s", b["@type"], b.name, b.priceRange, (b.department || []).length);
} catch {
  console.log("解析失败");
}
if (a.jsonLdFaq) {
  const f = JSON.parse(a.jsonLdFaq);
  console.log("FAQPage mainEntity=%s 第一条=%s", f.mainEntity.length, f.mainEntity[0].name);
}
