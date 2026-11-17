/* 重复取证检测验证：node scripts/smoke-dup.mjs */
const base = process.env.GEO_BASE || "http://127.0.0.1:8002/api";

async function req(path, { method = "GET", token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : {} };
}

const token = (await req("/auth/login", { method: "POST", body: { phone: "13800000000", password: "123456" } })).data.token;
const me = (await req("/me", { token })).data;
const brandId = me.brands[0].id;

const ev = (await req(`/evidence?brandId=${brandId}`, { token })).data;
if (!ev.length) {
  console.log("SKIP 台账为空，先造一条再跑本脚本");
  process.exit(0);
}

const first = ev[0];
console.log("BASE  已有样本 prompt=%s platform=%s", first.prompt.slice(0, 18), first.platform);

const r = await req("/evidence", {
  method: "POST",
  token,
  body: { brandId, promptId: first.promptId, platform: first.platform, answer: first.answer, location: "南京" },
});

console.log("DUP    http=%s duplicate=%s (expect >=1)  mention=%s accuracy=%s", r.status, r.data.duplicate, r.data.mention, r.data.accuracy);
console.log("NOTE  指标未重复加分：aviCend=%s cendSamples=%s", r.data.metrics?.aviCend, r.data.metrics?.cendSamples);

/* 撤销刚插入的这条，避免污染 */
const del = await req(`/evidence/${r.data.id}`, { method: "DELETE", token });
console.log("CLEAN  delete http=%s aviCend=%s", del.status, del.data.metrics?.aviCend);
