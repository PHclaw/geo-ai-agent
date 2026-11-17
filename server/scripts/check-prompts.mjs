/* 核对提问矩阵现状：node scripts/check-prompts.mjs */
import { db } from "../db.js";

for (const b of db.prepare("SELECT id, name FROM brands ORDER BY created_at").all()) {
  const rows = db.prepare("SELECT intent, text FROM prompts WHERE brand_id=?").all(b.id);
  const by = {};
  rows.forEach((r) => (by[r.intent] = (by[r.intent] || 0) + 1));
  console.log("%s：%s 条 %j", b.name, rows.length, by);
  const bad = rows.filter((r) => /附近|到店|周边/.test(r.text));
  if (bad.length) {
    console.log("  含本地化问法：%s 条", bad.length);
    bad.slice(0, 4).forEach((r) => console.log("    - %s", r.text));
  }
}
