/* 提问矩阵增删改 + 取证进度验证：node scripts/smoke-prompts-edit.mjs */
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

for (const brand of me.brands) {
  const list = (await req(`/prompts?brandId=${brand.id}`, { token })).data;
  const withEv = list.filter((p) => (p.evidenced || 0) > 0);
  console.log("%s：%s 条，有取证记录的 %s 条", brand.name, list.length, withEv.length);
  list.slice(0, 3).forEach((p) => {
    console.log("   [%s] evidenced=%s createdAt=%s  %s", p.intent, p.evidenced, (p.createdAt || "-").slice(0, 19), p.text);
  });
}

/* 用 AgentFlow 做增改删验证 */
const brand = me.brands.find((b) => b.name === "AgentFlow") || me.brands[0];
const before = (await req(`/prompts?brandId=${brand.id}`, { token })).data;
console.log("\n=== 增改删验证（%s，原 %s 条）===", brand.name, before.length);

const a = await req("/prompts", { method: "POST", token, body: { brandId: brand.id, text: "验收用问题甲：部署要准备数据库吗？", intent: "认知", weight: 1 } });
const b = await req("/prompts", { method: "POST", token, body: { brandId: brand.id, text: "验收用问题乙：能装在内网吗？", intent: "认知", weight: 1 } });
console.log("CREATE  http=%s / %s", a.status, b.status);

const patched = await req(`/prompts/${a.data.id}`, { method: "PATCH", token, body: { intent: "决策", weight: 3 } });
console.log("PATCH   http=%s intent=%s weight=%s（期望 决策/3）", patched.status, patched.data.intent, patched.data.weight);

const patched2 = await req(`/prompts/${a.data.id}`, { method: "PATCH", token, body: { intent: "乱写" } });
console.log("PATCH2  非法意图 → http=%s intent=%s（应保持决策）", patched2.status, patched2.data.intent);

const del = await req("/prompts/batch-delete", { method: "POST", token, body: { brandId: brand.id, ids: [a.data.id, b.data.id] } });
console.log("BATCH   http=%s deleted=%s（期望 2）", del.status, del.data.deleted);

const after = (await req(`/prompts?brandId=${brand.id}`, { token })).data;
console.log("AFTER   %s 条（应回到 %s）", after.length, before.length);

const empty = await req("/prompts/batch-delete", { method: "POST", token, body: { brandId: brand.id, ids: [] } });
console.log("GUARD   空数组 → http=%s %s", empty.status, empty.data.error || "");
