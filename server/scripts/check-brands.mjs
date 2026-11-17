/* 检查品牌与租户归属：node scripts/check-brands.mjs */
import { db } from "../db.js";

console.log("=== tenants ===");
for (const t of db.prepare("SELECT id, name FROM tenants").all()) {
  const n = db.prepare("SELECT COUNT(*) c FROM brands WHERE tenant_id=?").get(t.id).c;
  console.log("  %s  %s  品牌数=%s", t.id.slice(0, 8), t.name, n);
}

console.log("=== brands ===");
for (const b of db.prepare("SELECT id, tenant_id, name, created_at FROM brands ORDER BY created_at").all()) {
  console.log("  %s  tenant=%s  %s  %s", b.id.slice(0, 8), b.tenant_id.slice(0, 8), b.name, b.created_at);
}

console.log("=== users ===");
for (const u of db.prepare("SELECT id, tenant_id, phone, role, name FROM users").all()) {
  console.log("  %s  tenant=%s  %s %s (%s)", u.id.slice(0, 8), u.tenant_id.slice(0, 8), u.phone, u.name || "", u.role);
}
