/* 诊断：看 FAQ.md 等文档切片的 title_path 与检索打分细节 */
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
const brand = (me.brands || []).find((b) => b.name === "AgentFlow");
if (!brand) {
  console.log("没有 AgentFlow 品牌");
  process.exit(0);
}

const docs = await (await fetch(`${base}/kb/documents?brandId=${brand.id}`, { headers: { Authorization: `Bearer ${token}` } })).json();
console.log("资产接口是否有 docCount：", JSON.stringify(await (await fetch(`${base}/site/assets?brandId=${brand.id}`, { headers: { Authorization: `Bearer ${token}` } })).json()).slice(0, 80));

for (const name of ["FAQ.md", "COMPARISON.md"]) {
  const d = docs.find((x) => x.name === name);
  if (!d) continue;
  const c = await (await fetch(`${base}/kb/documents/${d.id}/chunks?limit=10`, { headers: { Authorization: `Bearer ${token}` } })).json();
  console.log("\n=== %s（%s 片）===", name, c.chunks.length);
  for (const ch of c.chunks.slice(0, 6)) {
    console.log("  title=%j  chars=%s  text=%j", ch.titlePath, ch.chars, (ch.text || "").slice(0, 40));
  }
}

/* 检索细节：分别看命中片属于哪篇 */
const q = "AgentFlow 支持哪些大模型？";
const r = await (
  await fetch(`${base}/kb/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ brandId: brand.id, query: q, topK: 6 }),
  })
).json();

console.log("\n=== 检索「%s」 ===", q);
for (const h of r.hits || []) {
  console.log("  %s | %s | title=%j | %s", h.score, h.docName, h.titlePath, (h.text || "").slice(0, 34));
}
