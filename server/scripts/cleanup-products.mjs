/* 清理测试产品名里的括号说明：node scripts/cleanup-products.mjs */
import { db } from "../db.js";

const rows = db.prepare("SELECT id, name FROM products").all();
let n = 0;
for (const p of rows) {
  const clean = String(p.name).replace(/[（(][^）)]*[）)]/g, "").trim();
  if (clean && clean !== p.name) {
    db.prepare("UPDATE products SET name=?, updated_at=? WHERE id=?").run(clean, new Date().toISOString(), p.id);
    console.log("  %s → %s", p.name, clean);
    n++;
  }
}
console.log("清理 %s 条", n);

for (const p of db.prepare("SELECT name, category, price FROM products ORDER BY created_at").all()) {
  console.log("  %s ｜ %s ｜ %s", p.name, p.category, p.price || "-");
}
