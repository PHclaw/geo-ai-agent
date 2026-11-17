/* 三合一验证：合规 / 图库 / 导出 HTML  →  node scripts/smoke-v3.mjs */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { checkCompliance } from "../agent/compliance.js";

const base = process.env.GEO_BASE || "http://127.0.0.1:8002/api";
const here = dirname(fileURLToPath(import.meta.url));
const tmp = join(here, "..", "data", "tmp-kb");
mkdirSync(tmp, { recursive: true });

async function req(path, { method = "GET", token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data, text };
}

/* ---------- 1. 合规词库（单元验证） ---------- */
console.log("=== 1) 合规检查 ===");
const cases = [
  ["我们是最好的装修公司，100% 无风险", "装修"],
  ["南京老房翻新，硬装 980–1350 元/㎡，水电质保 10 年", "装修"],
  ["根治漏水，药到病除", "医疗"],
  ["保过班，升学率 98%", "教育"],
];
for (const [text, industry] of cases) {
  const r = checkCompliance(text, industry);
  console.log("  [%s] block=%s warn=%s → %s", industry, r.blocked.length, r.warnings.length, r.summary);
  if (r.blocked.length) console.log("      命中: %s", r.blocked.map((b) => b.word).join("、"));
}

/* ---------- 2. 图库上传 ---------- */
console.log("\n=== 2) 图库 ===");
const token = (await req("/auth/login", { method: "POST", body: { phone: "13800000000", password: "123456" } })).data.token;
const brandId = (await req("/me", { token })).data.brands[0].id;

const imgPath = join(tmp, "门店实拍-测试.png");
await sharp({
  create: { width: 640, height: 360, channels: 3, background: { r: 0, g: 113, b: 227 } },
})
  .png()
  .toFile(imgPath);

const fd = new FormData();
fd.append("file", new Blob([(await import("node:fs")).readFileSync(imgPath)]), "门店实拍-测试.png");
const up = await fetch(`${base}/kb/documents?brandId=${brandId}`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
  body: fd,
});
const upData = await up.json();
console.log("  UPLOAD http=%s status=%s chunks=%s warning=%s", up.status, upData.status, upData.chunks, upData.warning || "-");

if (upData.id) {
  const r = await fetch(`${base}/kb/files/${upData.id}`);
  console.log("  FILE   %s %s bytes=%s", r.status, r.headers.get("content-type"), (await r.arrayBuffer()).byteLength);
}

/* ---------- 3. 导出 HTML ---------- */
console.log("\n=== 3) 导出图文 HTML ===");
const list = (await req(`/contents?brandId=${brandId}`, { token })).data;
const withFig = list.find((c) => c.id);
if (!withFig) {
  console.log("  没有内容可导出");
} else {
  const r = await fetch(`${base}/contents/${withFig.id}/export.html`, { headers: { Authorization: `Bearer ${token}` } });
  const html = await r.text();
  const count = (re) => (html.match(re) || []).length;
  console.log("  EXPORT http=%s %s bytes=%s", r.status, r.headers.get("content-type"), html.length);
  console.log("  标题   %s", (/<title>([^<]*)<\/title>/.exec(html) || [])[1] || "-");
  console.log("  结构   h=%s p=%s img=%s table=%s li=%s", count(/<h[12] /g), count(/<p style/g), count(/<img /g), count(/<table /g), count(/<li /g));
  console.log("  图片内联 dataURI=%s 处（svg=%s, 图片=%s）", count(/data:image\//g), count(/data:image\/svg/g), count(/data:image\/(png|jpeg|webp|gif)/g));
  console.log("  残留标记 `**`=%s `](`=%s", count(/\*\*/g), count(/\]\(/g));
}

/* ---------- 4. 发布拦截 ---------- */
console.log("\n=== 4) 发布硬拦截 ===");
const dirty = list.find((c) => c.status === "draft");
if (dirty) {
  const r1 = await req(`/contents/${dirty.id}`, { method: "PATCH", token, body: { status: "published" } });
  console.log("  草稿发布 http=%s %s", r1.status, r1.status === 400 ? `被拦截：${r1.data.error}` : "放行（无禁用词）");
  if (r1.status === 200) {
    await req(`/contents/${dirty.id}`, { method: "PATCH", token, body: { status: "draft" } });
    console.log("  （已回退为草稿）");
  }
}
