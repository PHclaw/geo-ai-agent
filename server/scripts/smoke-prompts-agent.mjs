/* AI 生成提问验证：node scripts/smoke-prompts-agent.mjs [品牌名] */
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
const name = process.argv[2] || "AgentFlow";
const brand = me.brands.find((b) => b.name === name) || me.brands[0];

const facts = (await req(`/facts?brandId=${brand.id}`, { token })).data;
const docs = (await req(`/kb/stats?brandId=${brand.id}`, { token })).data;
const before = (await req(`/prompts?brandId=${brand.id}`, { token })).data;

console.log("TARGET %s（事实卡 %s 条 / 文档 %s 份 / 现有提问 %s 条）", brand.name, facts.length, docs.documents, before.length);
console.log("\n=== 现有提问（前 8 条）===");
before.slice(0, 8).forEach((p, i) => console.log("  %s. [%s] %s", i + 1, p.intent, p.text));

console.log("\nRUN   AI 出题中（约 20–40s）…");
const t0 = Date.now();
const r = await req("/prompts/agent", { method: "POST", token, body: { brandId: brand.id } });
console.log("RESULT http=%s 耗时 %ss", r.status, ((Date.now() - t0) / 1000).toFixed(1));
if (r.status !== 200) {
  console.log("失败：%j", r.data);
  process.exit(0);
}
const d = r.data;
console.log("       新增=%s 跳过=%s 模型给出=%s（资料：文档 %s / 事实卡 %s）", d.added, d.skipped, d.total, d.fromDocs, d.fromFacts);
console.log("\n=== 新生成的问题 ===");
for (const p of d.preview || []) {
  console.log("  [%s w%s] %s", p.intent, p.weight, p.text);
}

const after = (await req(`/prompts?brandId=${brand.id}`, { token })).data;
console.log("\n=== 现有提问总数 %s ===", after.length);
const byIntent = {};
for (const p of after) byIntent[p.intent] = (byIntent[p.intent] || 0) + 1;
console.log("意图分布：%j", byIntent);

/* 检查是否还残留不贴合的套壳问题 */
const bad = after.filter((p) => /附近|到店|周边/.test(p.text) && !brand.city);
console.log("\nCHECK  疑似不贴合（本地化问法但品牌无城市）：%s 条", bad.length);
bad.slice(0, 5).forEach((p) => console.log("  - %s", p.text));
