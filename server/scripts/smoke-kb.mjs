/* 知识库上传/切片/检索验证：node scripts/smoke-kb.mjs */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

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
  return { status: res.status, data: text ? JSON.parse(text) : {} };
}

async function upload(token, brandId, filePath, filename) {
  const buf = (await import("node:fs")).readFileSync(filePath);
  const fd = new FormData();
  fd.append("file", new Blob([buf]), filename);
  const res = await fetch(`${base}/kb/documents?brandId=${brandId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : {} };
}

const token = (await req("/auth/login", { method: "POST", body: { phone: "13800000000", password: "123456" } })).data.token;
const brandId = (await req("/me", { token })).data.brands[0].id;

/* 1) 造三个测试文件 */
const md = `# 老房翻新服务说明

## 报价与工期

和序装饰的老房翻新套餐按建筑面积计价，硬装报价 1180 到 1600 元每平方米，100 平方米三居室整体预算通常在 12 到 18 万元。
常规工期为 60 到 75 天，包含拆除清运、水电全改、泥木油漆与主材安装。

## 质保条款

基础工程质保 5 年，水电隐蔽工程质保 10 年，以合同附件为准。
增项超过 500 元需要业主书面确认后才施工。

## 常见问题

问：老房子能不能边住边改？
答：分区域施工可以不大搬家，但卫生间改造期间约 3 到 5 天无法使用。
`;
writeFileSync(join(tmp, "老房翻新说明.md"), md, "utf8");

const csv = `门店名称,详细地址,联系电话,营业时间
和序装饰河西旗舰店,建邺区江东中路289号3楼,025-8654 3210,09:30-19:00
和序装饰江宁店,江宁区双龙大道1698号B座2楼,025-8622 7788,09:00-18:30
`;
writeFileSync(join(tmp, "门店清单.csv"), csv, "utf8");

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([
  ["项目", "单价", "包含内容"],
  ["拆墙清运", "70元/㎡", "拆除、垃圾外运、成品保护"],
  ["水电全改", "150元/㎡", "强弱电、水管更换、点位增加"],
  ["墙面乳胶漆", "45元/㎡", "两遍腻子、两遍乳胶漆"],
]);
XLSX.utils.book_append_sheet(wb, ws, "报价明细");
XLSX.writeFile(wb, join(tmp, "报价单.xlsx"));

/* 2) 逐个上传 */
const files = [
  ["老房翻新说明.md", "老房翻新说明.md"],
  ["门店清单.csv", "门店清单.csv"],
  ["报价单.xlsx", "报价单.xlsx"],
];
for (const [path, name] of files) {
  const r = await upload(token, brandId, join(tmp, path), name);
  console.log("UPLOAD %s -> http %s | %s", name, r.status, JSON.stringify(r.data).slice(0, 160));
}

/* 3) 列表与统计 */
const docs = (await req(`/kb/documents?brandId=${brandId}`, { token })).data;
console.log("\nDOCS   %s 个:", docs.length);
docs.slice(0, 5).forEach((d) => console.log("  - %s [%s] pages=%s chunks=%s chars=%s %s", d.name, d.status, d.pages, d.chunks, d.chars, d.error || ""));

const stats = (await req(`/kb/stats?brandId=${brandId}`, { token })).data;
console.log("STATS  documents=%s ready=%s chunks=%s chars=%s", stats.documents, stats.ready, stats.chunks, stats.chars);

/* 4) 检索 */
for (const q of ["老房翻新要多少钱", "水电质保几年", "河西店电话是多少", "拆墙怎么收费"]) {
  const r = (await req("/kb/search", { method: "POST", token, body: { brandId, query: q, topK: 3 } })).data;
  const top = r.hits?.[0];
  console.log("\nSEARCH 「%s」 matched=%s index=%s", q, r.matched, r.indexSize);
  r.hits?.slice(0, 2).forEach((h, i) =>
    console.log("   #%s score=%s %s | %s | %s", i + 1, h.score, h.docName, h.titlePath || `p${h.page}`, h.text.slice(0, 40).replace(/\n/g, " "))
  );
  if (!top) console.log("   (无命中)");
}

/* 5) 看切片 */
const target = docs.find((d) => d.name.includes("老房"));
if (target) {
  const c = (await req(`/kb/documents/${target.id}/chunks?limit=5`, { token })).data;
  console.log("\nCHUNKS 《%s》共 %s 片（展示前 3）", c.document.name, c.chunks.length);
  c.chunks.slice(0, 3).forEach((x) => console.log("   seq=%s p%s %s chars=%s", x.seq, x.page, x.titlePath, x.chars));
}

/* 6) 权限：只读成员不能上传 */
const viewer = await req("/auth/login", { method: "POST", body: { phone: "13911110002", password: "pass1234" } });
if (viewer.data.token) {
  const r = await upload(viewer.data.token, brandId, join(tmp, "老房翻新说明.md"), "x.md");
  console.log("\nPERM   viewer upload -> http %s (expect 403/409)", r.status);
} else {
  console.log("\nPERM   viewer 账号不存在，跳过");
}
