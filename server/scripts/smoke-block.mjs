/* 禁用词发布拦截验证：node scripts/smoke-block.mjs */
import { db, id, now } from "../db.js";

const base = process.env.GEO_BASE || "http://127.0.0.1:8002/api";

const login = await fetch(`${base}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ phone: "13800000000", password: "123456" }),
});
const token = (await login.json()).token;
const me = await (await fetch(`${base}/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
const brandId = me.brands[0].id;

const dirtyId = id();
db.prepare(
  "INSERT INTO contents (id, brand_id, title, genre, body, geos, status, created_at, compliance) VALUES (?,?,?,?,?,?,?,?,?)"
).run(
  dirtyId,
  brandId,
  "【测试】含禁用词的草稿",
  "攻略",
  "我们是最好的装修公司，100% 无风险。",
  50,
  "draft",
  now(),
  JSON.stringify([
    { word: "最好", level: "block", reason: "广告法禁止绝对化用语", context: "我们是最好的装修公司" },
    { word: "100%", level: "block", reason: "广告法禁止绝对化用语", context: "100% 无风险" },
  ])
);

async function patch(status) {
  const res = await fetch(`${base}/contents/${dirtyId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status }),
  });
  const data = await res.json();
  return { status: res.status, data };
}

const toPub = await patch("published");
console.log("BLOCK  发布含禁用词草稿 -> http=%s %s", toPub.status, toPub.data.error || toPub.data.status);
console.log("       blocked=%s", (toPub.data.blocked || []).map((b) => b.word).join("、") || "-");

const toReview = await patch("review");
console.log("ALLOW  改为待审核（非发布） -> http=%s %s", toReview.status, toReview.data.status);

/* 清掉测试数据 */
db.prepare("DELETE FROM contents WHERE id=?").run(dirtyId);
console.log("CLEAN  已删除测试内容");
