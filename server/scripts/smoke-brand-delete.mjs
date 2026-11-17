/* 品牌删除验证：node scripts/smoke-brand-delete.mjs */
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
    data = { raw: text.slice(0, 160) };
  }
  return { status: res.status, data };
}

const token = (await req("/auth/login", { method: "POST", body: { phone: "13800000000", password: "123456" } })).data.token;

/* 1) 造一个临时品牌 */
const made = await req("/brands", {
  method: "POST",
  token,
  body: { name: "临时测试品牌", city: "南京", industry: "家装", stores: [{ name: "测试店", address: "测试路 1 号" }] },
});
console.log("CREATE  http=%s name=%s", made.status, made.data.name);
const tempId = made.data.id;

/* 2) 上传一份文档，验证级联会清掉 */
const { readFileSync } = await import("node:fs");
const fd = new FormData();
fd.append("file", new Blob([readFileSync("d:/工作/GEO Aiagent/server/scripts/smoke-v3.mjs")]), "temp.md");
const up = await fetch(`${base}/kb/documents?brandId=${tempId}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
console.log("UPLOAD  http=%s %s", up.status, (await up.json()).status);

/* 3) 错误确认名 → 应 400 */
const wrong = await req(`/brands/${tempId}?confirmName=乱写`, { method: "DELETE", token });
console.log("WRONG   http=%s %s", wrong.status, wrong.data.error || "");

/* 4) 正确确认名 → 应 200 且返回各表清理条数 */
const ok = await req(`/brands/${tempId}?confirmName=${encodeURIComponent("临时测试品牌")}`, { method: "DELETE", token });
console.log("DELETE  http=%s name=%s", ok.status, ok.data.name);
if (ok.data.deleted) {
  const entries = Object.entries(ok.data.deleted).filter(([, n]) => n > 0);
  console.log("        清理明细：%s", entries.map(([t, n]) => `${t}=${n}`).join(", ") || "（全部为 0）");
  console.log("        合计 %s 条", Object.values(ok.data.deleted).reduce((a, b) => a + b, 0));
}

/* 5) 再删一次 → 应 404 */
const again = await req(`/brands/${tempId}?confirmName=${encodeURIComponent("临时测试品牌")}`, { method: "DELETE", token });
console.log("AGAIN   http=%s %s", again.status, again.data.error || "");

/* 6) 剩余品牌 */
const left = (await req("/brands", { token })).data;
console.log("LEFT    %s", left.map((b) => b.name).join(" / "));

/* 7) 只剩一个时不能删 */
if (left.length === 1) {
  const last = await req(`/brands/${left[0].id}?confirmName=${encodeURIComponent(left[0].name)}`, { method: "DELETE", token });
  console.log("LAST    http=%s %s", last.status, last.data.error || "");
}
