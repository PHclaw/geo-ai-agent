/* 产品库 AI 自动提取验证：node scripts/smoke-products-agent.mjs */
const base = process.env.GEO_BASE || "http://127.0.0.1:8002/api";

async function req(path, { method = "GET", token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  return { status: res.status, data };
}

const token = (await req("/auth/login", { method: "POST", body: { phone: "13800000000", password: "123456" } })).data.token;
const me = (await req("/me", { token })).data;
console.log("BRANDS %s", me.brands.map((b) => b.name).join(" / "));

const name = process.argv[2] || "AgentFlow";
const brand = me.brands.find((b) => b.name === name) || me.brands[0];
console.log("TARGET %s (%s)", brand.name, brand.id.slice(0, 8));

const facts = (await req(`/facts?brandId=${brand.id}`, { token })).data;
const docsStats = (await req(`/kb/stats?brandId=${brand.id}`, { token })).data;
console.log("DOCS   %s 份 / %s 片", docsStats.documents, docsStats.chunks);
console.log("FACTS  %s 条（价格类：%s）", facts.length, facts.filter((f) => f.attr.includes("价格")).map((f) => `${f.attr}=${f.value}`).join("；") || "无");

const before = (await req(`/products?brandId=${brand.id}`, { token })).data;
console.log("PRODUCTS 现有 %s 个", before.length);

/* 1) 不带 force → 期望 409（已有产品时） */
const r1 = await req("/products/agent", { method: "POST", token, body: { brandId: brand.id } });
console.log("\nGUARD  http=%s %s", r1.status, r1.data.error || "（未被拦截）");

/* 2) 清空该品牌产品（仅供本次验证） */
if (before.length) {
  for (const p of before) await req(`/products/${p.id}`, { method: "DELETE", token });
  console.log("CLEAR  已清空 %s 个旧产品", before.length);
}

/* 3) 正式提取 */
console.log("\nRUN    调用 AI 提取（约 20–40s）…");
const t0 = Date.now();
const r2 = await req("/products/agent", { method: "POST", token, body: { brandId: brand.id, force: true } });
console.log("RESULT http=%s 耗时 %ss", r2.status, ((Date.now() - t0) / 1000).toFixed(1));
if (r2.status !== 200) {
  console.log("失败：%j", r2.data);
  process.exit(0);
}
const d = r2.data;
console.log("       新增=%s 跳过=%s 超区间=%s 模型给出=%s 文档=%s", d.added, d.skipped, d.warned, d.total, d.docCount);
console.log("       预览：");
for (const p of d.preview || []) {
  console.log("         [%s] %s ｜ %s", p.check, p.name, p.price || "(无价格)");
}

const after = (await req(`/products?brandId=${brand.id}`, { token })).data;
console.log("\nAFTER  %s 个产品：", after.length);
for (const p of after) {
  console.log("  %s ｜ %s ｜ %s ｜ %s ｜ 校验=%s", p.name, p.category || "-", p.price || "-", p.applicable || "-", p.priceCheck.level);
}

/* 4) 消费端：llms.txt 是否带上了这些产品 */
const assets = (await req(`/site/assets?brandId=${brand.id}`, { token })).data;
const seg = (assets.llmsTxt || "").includes("## 服务与产品")
  ? assets.llmsTxt.split("## 服务与产品")[1].split("\n## ")[0].trim()
  : "";
console.log("\nLLMS   含服务与产品段落=%s，行数=%s", Boolean(seg), seg ? seg.split("\n").length : 0);
try {
  const b = JSON.parse(assets.jsonLdBusiness);
  console.log("JSONLD hasOfferCatalog=%s 条目=%s", Boolean(b.hasOfferCatalog), b.hasOfferCatalog?.itemListElement?.length ?? 0);
} catch {
  console.log("JSONLD 解析失败");
}
