/* 列出所有含 brand_id 的表：node scripts/list-brand-tables.mjs */
import { db } from "../db.js";

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
const withBrand = [];
for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info(${t.name})`).all().map((c) => c.name);
  if (cols.includes("brand_id")) {
    const n = db.prepare(`SELECT COUNT(*) c FROM ${t.name}`).get().c;
    withBrand.push(`${t.name}(${n})`);
  }
}
console.log("含 brand_id 的表：", withBrand.join(", "));
