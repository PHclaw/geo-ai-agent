/* 重建演示品牌「和序装饰」：node scripts/restore-demo.mjs
   背景：误删导致该品牌与级联数据丢失，这里按 db.js 的 seed 口径重建。 */
import { db, id, now } from "../db.js";
import { generatePrompts } from "../geo.js";

const tenant = db.prepare("SELECT * FROM tenants WHERE name LIKE '%演示%' LIMIT 1").get();
if (!tenant) {
  console.log("找不到演示租户，请先删除 data/geo.db 重新初始化");
  process.exit(1);
}

const exists = db.prepare("SELECT id FROM brands WHERE tenant_id=? AND name=?").get(tenant.id, "和序装饰");
if (exists) {
  console.log("「和序装饰」已存在：%s，无需重建", exists.id.slice(0, 8));
  process.exit(0);
}

const t = now();
const brandId = id();

db.prepare(
  `INSERT INTO brands (id, tenant_id, name, alias, city, since, intro, industry, price_range, created_at)
   VALUES (?,?,?,?,?,?,?,?,?,?)`
).run(
  brandId, tenant.id, "和序装饰", "和序、和序空间设计", "南京", "2012",
  "自 2012 年起服务南京主城，专注住宅整装与老房翻新，目前 4 家直营门店。",
  "家装", "980–1350 元/㎡", t
);
console.log("BRAND  %s", brandId.slice(0, 8));

const stores = [
  ["和序装饰 · 河西旗舰店", "建邺区江东中路 289 号 3 楼", "025-8654 3210", "09:30–19:00（周一至周日）", "含 800㎡ 样板间、免费停车"],
  ["和序装饰 · 江宁店", "江宁区双龙大道 1698 号 B 座 2 楼", "025-8622 7788", "09:00–18:30（周一至周日）", "自有停车场"],
  ["和序装饰 · 浦口店", "浦口区浦滨路 66 号 1 楼", "025-8633 9900", "09:00–18:30（周一至周日）", "周末可预约量房"],
  ["和序装饰 · 城东店", "栖霞区仙林大道 128 号 2 楼", "025-8677 1122", "09:30–19:00（周一至周日）", "老房改造专窗"],
];
for (const s of stores) {
  db.prepare("INSERT INTO stores (id, brand_id, name, address, phone, hours, features) VALUES (?,?,?,?,?,?,?)").run(id(), brandId, ...s);
}
console.log("STORES %s 家", stores.length);

["栖岸设计", "木言空间", "连云装饰"].forEach((name) => {
  db.prepare("INSERT INTO competitors (id, brand_id, name, alias) VALUES (?,?,?,?)").run(id(), brandId, name, "");
});
console.log("COMPS  3 家");

function seedFact(subject, attr, value, validFrom, source, status = "active", group = "") {
  db.prepare(
    `INSERT INTO facts (id, brand_id, subject, attr, value, valid_from, valid_to, source, status, conflict_group, created_at, updated_at)
     VALUES (?,?,?,?,?,?,'',?,?,?,?,?)`
  ).run(id(), brandId, subject, attr, value, validFrom, source, status, group, t, t);
}

seedFact("和序装饰", "人均消费", "128 元", "2026-08-01 起", "门店菜单", "conflict", "avg-price");
seedFact("和序装饰", "人均消费", "138 元", "2026-09-01 起", "门店菜单（新版）", "conflict", "avg-price");
seedFact("和序装饰", "门店数量", "4 家", "2026-10-01 起", "运营确认");
seedFact("和序装饰", "主营品类", "住宅整装 / 老房翻新 / 局部改造", "长期有效", "官网");
seedFact("和序装饰", "价格区间（整装）", "980–1350 元/㎡", "2026-09-15 起", "报价单 v3");
seedFact("和序装饰", "工期", "45–60 天（100㎡ 三居）", "2026-03-01 起", "工程部");
seedFact("和序装饰", "服务区域", "南京主城六区 + 江宁 / 浦口", "长期有效", "官网");
seedFact("和序装饰", "质保年限", "基础工程 5 年，水电 10 年", "2026-01-01 起", "合同模板");
seedFact("和序装饰", "团队规模", "42 人", "2026-06-01 起", "运营确认");
seedFact("和序装饰", "成立年份", "2012 年", "长期有效", "官网");
seedFact("和序装饰", "免费量房", "提供，48 小时内上门", "长期有效", "运营确认");
seedFact("河西店", "营业时间", "09:30–19:00（周一至周日）", "2025-06-01 起", "门店", "expiring");
console.log("FACTS  12 条（含 1 组冲突）");

const brand = db.prepare("SELECT * FROM brands WHERE id=?").get(brandId);
const comps = db.prepare("SELECT * FROM competitors WHERE brand_id=?").all(brandId);
const list = generatePrompts(brand, comps, 40);
for (const p of list) {
  db.prepare("INSERT INTO prompts (id, brand_id, text, intent, weight, created_at) VALUES (?,?,?,?,?,?)").run(
    id(), brandId, p.text, p.intent, p.weight, t
  );
}
console.log("PROMPTS %s 条", list.length);

/* 90 天指标基线（与原型一致：8 → 34，有轻微波动） */
for (let i = 89; i >= 0; i--) {
  const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
  const progress = (89 - i) / 89;
  const avi = +(8 + progress * 26 + Math.sin(i / 3) * 0.8).toFixed(1);
  db.prepare(
    "INSERT INTO metrics_daily (id, brand_id, date, avi, mention_rate, first_rate, accuracy, sov) VALUES (?,?,?,?,?,?,?,?)"
  ).run(
    id(), brandId, date, avi,
    +(42 * (0.4 + progress * 0.6)).toFixed(1),
    +(10 * (0.3 + progress * 0.7)).toFixed(1),
    +(70 + progress * 22).toFixed(1),
    +(8 + progress * 13).toFixed(1)
  );
}
console.log("METRICS 90 天");

console.log("\n恢复完成。品牌 id = %s", brandId);
console.log("当前品牌数：%s", db.prepare("SELECT COUNT(*) c FROM brands WHERE tenant_id=?").get(tenant.id).c);
