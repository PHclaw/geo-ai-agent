/* 查删除类操作：node scripts/check-audit-delete.mjs */
import { db } from "../db.js";

console.log("=== 所有 DELETE 品牌相关审计 ===");
const rows = db
  .prepare(
    `SELECT created_at, user_name, action, object_type, object_id, detail
     FROM audit_logs WHERE action LIKE '%brand%' OR object_type='brands' ORDER BY created_at DESC LIMIT 20`
  )
  .all();

if (!rows.length) console.log("（无记录）");
for (const r of rows) {
  console.log("  %s  %s  %s  obj=%s/%s  %s", r.created_at, r.user_name || "-", r.action, r.object_type, (r.object_id || "").slice(0, 8), r.detail || "");
}

console.log("\n=== 最近 15 条审计（全部）===");
for (const r of db.prepare("SELECT created_at, user_name, action FROM audit_logs ORDER BY created_at DESC LIMIT 15").all()) {
  console.log("  %s  %s  %s", r.created_at, r.user_name || "-", r.action);
}

console.log("\n=== 当前数据量 ===");
for (const t of ["brands", "facts", "prompts", "probe_results", "contents", "products", "kb_documents"]) {
  console.log("  %s = %s", t, db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c);
}
