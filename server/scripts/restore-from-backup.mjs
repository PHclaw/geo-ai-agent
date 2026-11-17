/* ============================================================
   从备份一键恢复品牌：node scripts/restore-from-backup.mjs [参数]
   备份由「删除品牌」自动生成：data/backups/brand-<名称>-<时间>.json（+ -files 附件目录）

   用法：
     node scripts/restore-from-backup.mjs --list                     列出所有备份
     node scripts/restore-from-backup.mjs --name 和序装饰 --dry-run   预演（不写库）
     node scripts/restore-from-backup.mjs --name 和序装饰             恢复最新一份
     node scripts/restore-from-backup.mjs --file data/backups/xx.json  指定文件恢复
     node scripts/restore-from-backup.mjs --name xx --suffix=-恢复    同名时加后缀

   恢复策略：品牌用新 id 重建（避免与现存冲突），子表 brand_id 全部指向新 id；
             知识库文档保留原 id（正文里的 /api/kb/files/<id> 引用才不会断）。
   ============================================================ */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, copyFileSync, unlinkSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db, id, now } from "../db.js";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const BACKUP_DIR = join(ROOT, "data", "backups");
const UPLOAD_DIR = join(ROOT, "data", "uploads");

const args = process.argv.slice(2);
const getArg = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const hasArg = (k) => args.includes(k);

const TABLES = [
  ["stores", "brand_id"],
  ["competitors", "brand_id"],
  ["facts", "brand_id"],
  ["prompts", "brand_id"],
  ["products", "brand_id"],
  ["contents", "brand_id"],
  ["metrics_daily", "brand_id"],
  ["orders", "brand_id"],
  ["placements", "brand_id"],
  ["kb_documents", "brand_id"],
  ["kb_chunks", "brand_id"],
];

if (!existsSync(BACKUP_DIR)) {
  console.log("没有备份目录：%s", BACKUP_DIR);
  process.exit(0);
}

const files = readdirSync(BACKUP_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => {
    const p = join(BACKUP_DIR, f);
    const st = statSync(p);
    let meta = {};
    try {
      const d = JSON.parse(readFileSync(p, "utf8"));
      meta = { name: d.brand?.name || "?", exportedAt: d.exportedAt || "", counts: {
        facts: d.facts?.length || 0, prompts: d.prompts?.length || 0,
        contents: d.contents?.length || 0, docs: d.kb_documents?.length || 0,
      } };
    } catch {
      meta = { name: "（无法解析）" };
    }
    return { file: p, name: f, size: st.size, mtime: st.mtime.toISOString(), ...meta };
  })
  .sort((a, b) => b.mtime.localeCompare(a.mtime));

if (hasArg("--list") || args.length === 0) {
  if (!files.length) {
    console.log("没有任何备份文件（%s）", BACKUP_DIR);
    process.exit(0);
  }
  console.log("共 %s 份备份（按时间倒序）：\n", files.length);
  for (const f of files) {
    console.log("  %s", basename(f.file));
    console.log("    品牌=%s  导出=%s  %sKB  事实卡=%s 提问=%s 内容=%s 文档=%s",
      f.name || "?",
      f.exportedAt || "-",
      (f.size / 1024).toFixed(0),
      f.counts?.facts ?? "-", f.counts?.prompts ?? "-", f.counts?.contents ?? "-", f.counts?.docs ?? "-");
  }
  console.log("\n恢复用法：node scripts/restore-from-backup.mjs --name <品牌名> [--dry-run]");
  process.exit(0);
}

/* ---------- 选定备份 ---------- */
let target = getArg("--file");
if (target && !existsSync(target)) {
  target = join(ROOT, target);
}
if (!target) {
  const name = getArg("--name");
  if (!name) {
    console.log("请指定 --file <路径> 或 --name <品牌名>（--list 可查看）");
    process.exit(1);
  }
  const hit = files.find((f) => {
    try {
      return JSON.parse(readFileSync(f.file, "utf8")).brand?.name === name;
    } catch {
      return false;
    }
  });
  if (!hit) {
    console.log("没找到品牌「%s」的备份，用 --list 看看有哪些", name);
    process.exit(1);
  }
  target = hit.file;
}

const dump = JSON.parse(readFileSync(target, "utf8"));
if (!dump?.brand?.name) {
  console.log("备份文件格式不正确（缺少 brand.name）");
  process.exit(1);
}

const dryRun = hasArg("--dry-run");
const suffix = getArg("--suffix") || "";
const newName = dump.brand.name + suffix;

console.log("备份文件：%s", basename(target));
console.log("品牌：%s%s → 恢复为：%s", dump.brand.name, suffix ? `（加后缀 ${suffix}）` : "", newName);
console.log("内容：事实卡 %s / 提问 %s / 产品 %s / 内容 %s / 指标 %s / 订单 %s / 文档 %s / 切片 %s",
  dump.facts?.length || 0, dump.prompts?.length || 0, dump.products?.length || 0,
  dump.contents?.length || 0, dump.metrics_daily?.length || 0, dump.orders?.length || 0,
  dump.kb_documents?.length || 0, dump.kb_chunks?.length || 0);

const tenant = db.prepare("SELECT * FROM tenants WHERE id=?").get(dump.brand.tenant_id) || db.prepare("SELECT * FROM tenants LIMIT 1").get();
if (!tenant) {
  console.log("找不到可用的租户，无法恢复");
  process.exit(1);
}

const clash = db.prepare("SELECT id FROM brands WHERE tenant_id=? AND name=?").get(tenant.id, newName);
if (clash) {
  console.log("\n该租户下已存在同名品牌「%s」。请加 --suffix=-恢复 换个名字，或先删掉现有品牌。", newName);
  process.exit(1);
}

if (dryRun) {
  console.log("\n[预演] 目标租户：%s（%s）", tenant.name, tenant.id.slice(0, 8));
  console.log("[预演] 将新建品牌并写入上述数据，未修改数据库。");
  process.exit(0);
}

/* ---------- 执行恢复 ---------- */
const t = now();
const newBrandId = id();
const backupFilesDir = target.replace(/\.json$/, "-files");

function insertRows(table, rows, overrides = {}) {
  if (!rows?.length) return 0;
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  let n = 0;
  for (const r of rows) {
    const row = { ...r, ...overrides };
    const use = cols.filter((c) => row[c] !== undefined);
    if (!use.length) continue;
    try {
      db.prepare(`INSERT INTO ${table} (${use.join(",")}) VALUES (${use.map(() => "?").join(",")})`).run(
        ...use.map((c) => row[c])
      );
      n++;
    } catch (e) {
      console.log("  跳过一行 %s：%s", table, e.message.slice(0, 60));
    }
  }
  return n;
}

/* 附件：从 <backup>-files 复制回 uploads，并改写 path */
const docs = (dump.kb_documents || []).map((d) => ({ ...d }));
if (existsSync(backupFilesDir)) mkdirSync(UPLOAD_DIR, { recursive: true });
for (const d of docs) {
  if (!d.path) continue;
  const src = join(backupFilesDir, basename(d.path));
  if (existsSync(src)) {
    const dest = join(UPLOAD_DIR, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extname(d.path)}`);
    try {
      copyFileSync(src, dest);
      d.path = dest;
    } catch {
      d.path = "";
    }
  } else {
    d.path = "";
  }
}

const counts = {};
db.exec("BEGIN");
try {
  db.prepare(
    `INSERT INTO brands (id, tenant_id, name, alias, city, since, intro, industry, price_range, site_url, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    newBrandId, tenant.id, newName,
    dump.brand.alias || "", dump.brand.city || "", dump.brand.since || "", dump.brand.intro || "",
    dump.brand.industry || "", dump.brand.price_range || "", dump.brand.site_url || "", t
  );

  counts.stores = insertRows("stores", dump.stores, { brand_id: newBrandId });
  counts.competitors = insertRows("competitors", dump.competitors, { brand_id: newBrandId });
  counts.facts = insertRows("facts", dump.facts, { brand_id: newBrandId });
  counts.prompts = insertRows("prompts", dump.prompts, { brand_id: newBrandId });
  counts.products = insertRows("products", dump.products, { brand_id: newBrandId });
  counts.contents = insertRows("contents", dump.contents, { brand_id: newBrandId });
  counts.metrics_daily = insertRows("metrics_daily", dump.metrics_daily, { brand_id: newBrandId });
  counts.orders = insertRows("orders", dump.orders, { brand_id: newBrandId });
  counts.placements = insertRows("placements", dump.placements, { brand_id: newBrandId });
  counts.kb_documents = insertRows("kb_documents", docs, { brand_id: newBrandId });
  counts.kb_chunks = insertRows("kb_chunks", dump.kb_chunks, { brand_id: newBrandId });

  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  console.log("\n恢复失败，已回滚：%s", e.message);
  process.exit(1);
}

console.log("\n恢复完成：");
for (const [k, v] of Object.entries(counts)) console.log("  %s = %s", k, v);
console.log("\n新品牌 id：%s（在左侧「当前品牌」里切过去即可）", newBrandId);
console.log("提示：探测结果与登录态不在备份范围内，如需指标请重跑一次探测。");
