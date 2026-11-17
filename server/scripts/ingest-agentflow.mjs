/* 把 AgentFlow 资料灌进系统，观察各环节表现：node scripts/ingest-agentflow.mjs */
const base = process.env.GEO_BASE || "http://127.0.0.1:8002/api";
const SRC = "d:/工作/agentflow-master/agent";

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

/* ---------- 1) 建品牌 ---------- */
let brands = (await req("/me", { token })).data.brands || [];
let brand = brands.find((b) => b.name === "AgentFlow");
if (!brand) {
  const r = await req("/brands", {
    method: "POST",
    token,
    body: { name: "AgentFlow", city: "", industry: "AI Agent 平台", intro: "开源零代码 AI Agent 平台", siteUrl: "http://159.75.21.251:3000" },
  });
  console.log("BRAND 创建 http=%s %j", r.status, r.data);
  brands = (await req("/me", { token })).data.brands || [];
  brand = brands.find((b) => b.name === "AgentFlow");
} else {
  console.log("BRAND 已存在 %s", brand.id);
}
if (!brand) {
  console.log("建品牌失败，终止");
  process.exit(1);
}
const brandId = brand.id;

/* ---------- 1.5) --reset：先清空该品牌已有文档，确保重跑能测新逻辑 ---------- */
if (process.argv.includes("--reset")) {
  const docs = (await req(`/kb/documents?brandId=${brandId}`, { token })).data;
  for (const d of docs) await req(`/kb/documents/${d.id}`, { method: "DELETE", token });
  console.log("RESET 删除 %s 个旧文档", docs.length);
}

/* ---------- 2) 上传文档 ---------- */
const files = [
  "README.md",
  "docs/FAQ.md",
  "docs/COMPARISON.md",
  "docs/ARCHITECTURE.md",
  "docs/CONFIGURATION.md",
  "docs/DEPLOYMENT.md",
  "docs/API.md",
  "docs/AgentFlow产品介绍.docx",
];

const { readFileSync } = await import("node:fs");
console.log("\n=== 上传 ===");
for (const rel of files) {
  const abs = `${SRC}/${rel}`;
  let buf;
  try {
    buf = readFileSync(abs);
  } catch {
    console.log("  %s → 文件不存在，跳过", rel);
    continue;
  }
  const name = rel.split("/").pop();
  const fd = new FormData();
  fd.append("file", new Blob([buf]), name);
  const t0 = Date.now();
  const res = await fetch(`${base}/kb/documents?brandId=${brandId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const d = await res.json();
  console.log(
    `  ${name.padEnd(22)} http=${res.status} ${d.status || d.error}  pages=${d.pages ?? "-"} chunks=${d.chunks ?? "-"} chars=${d.chars ?? "-"} ${Date.now() - t0}ms ${d.warning || ""}`
  );
}

/* ---------- 3) 检索 ---------- */
const stats = (await req(`/kb/stats?brandId=${brandId}`, { token })).data;
console.log("\nSTATS  docs=%s ready=%s chunks=%s chars=%s", stats.documents, stats.ready, stats.chunks, stats.chars);

console.log("\n=== 检索（AI 用户会问的问题）===");
for (const q of ["AgentFlow 支持哪些大模型？", "怎么部署，需要装 PostgreSQL 吗", "AgentFlow 和 Dify 有什么区别", "知识库 RAG 是怎么工作的"]) {
  const r = (await req("/kb/search", { method: "POST", token, body: { brandId, query: q, topK: 3 } })).data;
  console.log("\n「%s」matched=%s", q, r.matched);
  (r.hits || []).slice(0, 2).forEach((h, i) =>
    console.log("   #%s %s | %s | %s", i + 1, h.score, h.docName, (h.text || "").slice(0, 56).replace(/\n/g, " "))
  );
  if (!r.hits?.length) console.log("   （无命中）");
}

/* ---------- 4) 资产生成（关键：看它能不能只用文档产出） ---------- */
console.log("\n=== 资产（/api/site/assets）===");
const a = (await req(`/site/assets?brandId=${brandId}&url=http%3A%2F%2F159.75.21.251%3A3000`, { token })).data;
console.log("llmsTxt 长度=%s  faqCount=%s  storeCount=%s  docCount=%s", (a.llmsTxt || "").length, a.faqCount, a.storeCount, a.docCount);
console.log("--- 生成的 llms.txt（全文） ---");
console.log(a.llmsTxt || "(空)");
try {
  const b = JSON.parse(a.jsonLdBusiness);
  console.log("--- JSON-LD --- @type=%s name=%s priceRange=%s department=%s", b["@type"], b.name, b.priceRange || "(空)", (b.department || []).length);
} catch {
  console.log("JSON-LD 解析失败");
}

/* ---------- 5) 事实卡现状 ---------- */
const facts = (await req(`/facts?brandId=${brandId}`, { token })).data;
console.log("\nFACTS  %s 条", Array.isArray(facts) ? facts.length : JSON.stringify(facts).slice(0, 80));
