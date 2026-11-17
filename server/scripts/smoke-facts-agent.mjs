/* AI 自动整理事实卡验证：node scripts/smoke-facts-agent.mjs */
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
const brand = (me.brands || []).find((b) => b.name === "AgentFlow");
if (!brand) {
  console.log("没有 AgentFlow 品牌");
  process.exit(1);
}

const before = (await req(`/facts?brandId=${brand.id}`, { token })).data;
console.log("BEFORE  事实卡 %s 条", before.length);

console.log("RUN     调用 AI 整理（可能要 30–60s）…");
const t0 = Date.now();
const r1 = await req("/facts/agent", { method: "POST", token, body: { brandId: brand.id } });
console.log("RESULT  http=%s 耗时 %ss", r1.status, ((Date.now() - t0) / 1000).toFixed(1));
if (r1.status !== 200) {
  console.log("失败：%j", r1.data);
  process.exit(0);
}
const d = r1.data;
console.log("        新增=%s 跳过=%s 冲突=%s 模型给出=%s 文档=%s", d.added, d.skipped, d.conflicts, d.total, d.docCount);
console.log("        明细：");
for (const p of d.preview || []) {
  console.log("          [%s] %s = %s", p.status === "conflict" ? "冲突" : "生效", p.attr, p.value);
}

const after = (await req(`/facts?brandId=${brand.id}`, { token })).data;
console.log("AFTER   事实卡 %s 条", after.length);
console.log("        全部：");
for (const f of after.slice(0, 25)) {
  console.log("          %s ｜ %s = %s  （来源：%s，%s）", f.subject, f.attr, f.value, f.source || "-", f.status);
}

/* 再跑一次，验证去重 */
console.log("\nRUN2    再跑一次验证去重…");
const r2 = await req("/facts/agent", { method: "POST", token, body: { brandId: brand.id } });
if (r2.status === 200) {
  console.log("RESULT2 新增=%s 跳过=%s 冲突=%s", r2.data.added, r2.data.skipped, r2.data.conflicts);
} else {
  console.log("RESULT2 http=%s %s", r2.status, r2.data.error || "");
}
