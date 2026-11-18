import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword } from "./auth.js";
import { generatePrompts } from "./geo.js";

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(here, "data"), { recursive: true });

// 测试或生产可用 GEO_DB_PATH 指向独立数据库
export const db = new DatabaseSync(process.env.GEO_DB_PATH || join(here, "data", "geo.db"));

export const id = () => randomUUID();
export const now = () => new Date().toISOString();

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'growth',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    name TEXT,
    pass_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS brands (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    alias TEXT DEFAULT '',
    city TEXT DEFAULT '',
    since TEXT DEFAULT '',
    intro TEXT DEFAULT '',
    industry TEXT DEFAULT '',
    price_range TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stores (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    name TEXT NOT NULL,
    address TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    hours TEXT DEFAULT '',
    features TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS competitors (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    name TEXT NOT NULL,
    alias TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS facts (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    attr TEXT NOT NULL,
    value TEXT NOT NULL,
    valid_from TEXT DEFAULT '',
    valid_to TEXT DEFAULT '',
    source TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    conflict_group TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS prompts (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    text TEXT NOT NULL,
    intent TEXT NOT NULL,
    weight INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS probe_runs (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    total INTEGER NOT NULL DEFAULT 0,
    done INTEGER NOT NULL DEFAULT 0,
    mode TEXT NOT NULL DEFAULT 'mock',
    platforms TEXT DEFAULT '',
    started_at TEXT NOT NULL,
    finished_at TEXT,
    error TEXT
  );

  CREATE TABLE IF NOT EXISTS probe_results (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    brand_id TEXT NOT NULL,
    prompt_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    answer TEXT DEFAULT '',
    citations TEXT DEFAULT '[]',
    position INTEGER DEFAULT 0,
    mention INTEGER DEFAULT 0,
    comp_mentions INTEGER DEFAULT 0,
    accuracy REAL DEFAULT 1,
    sentiment TEXT DEFAULT 'neutral',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS contents (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    title TEXT NOT NULL,
    genre TEXT DEFAULT '攻略',
    body TEXT DEFAULT '',
    geos INTEGER DEFAULT 0,
    status TEXT DEFAULT 'draft',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS metrics_daily (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    date TEXT NOT NULL,
    avi REAL NOT NULL DEFAULT 0,
    mention_rate REAL NOT NULL DEFAULT 0,
    first_rate REAL NOT NULL DEFAULT 0,
    accuracy REAL NOT NULL DEFAULT 0,
    sov REAL NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_facts_brand ON facts(brand_id);
  CREATE INDEX IF NOT EXISTS idx_prompts_brand ON prompts(brand_id);
  CREATE INDEX IF NOT EXISTS idx_results_run ON probe_results(run_id);
  CREATE INDEX IF NOT EXISTS idx_results_brand ON probe_results(brand_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_metrics_brand ON metrics_daily(brand_id, date);

  CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    region TEXT DEFAULT '',
    industry TEXT DEFAULT '',
    aiw INTEGER NOT NULL DEFAULT 0,
    cycle TEXT DEFAULT 'T+1',
    price INTEGER NOT NULL DEFAULT 0,
    covered INTEGER DEFAULT 0,
    note TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    objective TEXT DEFAULT '',
    media_ids TEXT DEFAULT '[]',
    total INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS placements (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    media_id TEXT NOT NULL,
    content_title TEXT DEFAULT '',
    url TEXT DEFAULT '',
    state TEXT NOT NULL DEFAULT '待发布',
    published_at TEXT DEFAULT '',
    indexed INTEGER DEFAULT 0,
    cited INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_orders_brand ON orders(brand_id);
  CREATE INDEX IF NOT EXISTS idx_placements_brand ON placements(brand_id);

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT,
    user_name TEXT,
    action TEXT NOT NULL,
    object_type TEXT DEFAULT '',
    object_id TEXT DEFAULT '',
    detail TEXT DEFAULT '',
    ip TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_logs(tenant_id, created_at);

  CREATE TABLE IF NOT EXISTS kb_documents (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    name TEXT NOT NULL,
    ext TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    sha256 TEXT DEFAULT '',
    path TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ready',
    pages INTEGER DEFAULT 0,
    chunks INTEGER DEFAULT 0,
    chars INTEGER DEFAULT 0,
    error TEXT DEFAULT '',
    uploaded_by TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS kb_chunks (
    id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL,
    brand_id TEXT NOT NULL,
    seq INTEGER NOT NULL DEFAULT 0,
    page INTEGER DEFAULT 1,
    title_path TEXT DEFAULT '',
    text TEXT NOT NULL,
    chars INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_kbdoc_brand ON kb_documents(brand_id);
  CREATE INDEX IF NOT EXISTS idx_kbchunk_brand ON kb_chunks(brand_id);
  CREATE INDEX IF NOT EXISTS idx_kbchunk_doc ON kb_chunks(doc_id);

  -- 产品库：SKU 级明细。注意：价格区间仍以事实卡为准，这里只是明细展开。
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT DEFAULT '',
    price TEXT DEFAULT '',
    unit TEXT DEFAULT '',
    specs TEXT DEFAULT '',
    selling_points TEXT DEFAULT '',
    applicable TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand_id);

  /* ---------------- SEO 曝光率（第 19 章之外的增量模块） ---------------- */

  CREATE TABLE IF NOT EXISTS seo_keywords (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    keyword TEXT NOT NULL,
    engine TEXT NOT NULL DEFAULT 'google',
    intent TEXT DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS seo_results (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    keyword_id TEXT NOT NULL,
    date TEXT NOT NULL,
    engine TEXT NOT NULL DEFAULT '',
    position INTEGER,
    exposed INTEGER NOT NULL DEFAULT 0,
    url TEXT DEFAULT '',
    title TEXT DEFAULT '',
    source TEXT NOT NULL DEFAULT 'live',
    error TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS seo_daily (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    date TEXT NOT NULL,
    indexed_pages INTEGER,
    impressions INTEGER,
    clicks INTEGER,
    ctr REAL,
    avg_position REAL,
    exposure_rate REAL,
    keywords_total INTEGER NOT NULL DEFAULT 0,
    keywords_exposed INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'manual',
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS seo_scans (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    url TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    grade TEXT DEFAULT '',
    checks TEXT NOT NULL DEFAULT '[]',
    facts TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_seo_keywords_brand ON seo_keywords(brand_id);
  CREATE INDEX IF NOT EXISTS idx_seo_results_brand ON seo_results(brand_id, date);
  CREATE INDEX IF NOT EXISTS idx_seo_daily_brand ON seo_daily(brand_id, date);
  CREATE INDEX IF NOT EXISTS idx_seo_scans_brand ON seo_scans(brand_id, created_at);

  /* ---------------- 链接资产台账：发布地址 / 官网 / 引用落地页统一登记 ---------------- */

  CREATE TABLE IF NOT EXISTS link_assets (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    url TEXT NOT NULL,
    host TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'article',
    title TEXT DEFAULT '',
    placement_id TEXT DEFAULT '',
    media_id TEXT DEFAULT '',
    content_id TEXT DEFAULT '',
    published_at TEXT DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    status TEXT NOT NULL DEFAULT 'unknown',
    http_status INTEGER,
    indexed INTEGER,
    last_checked_at TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE(brand_id, url)
  );

  CREATE TABLE IF NOT EXISTS link_checks (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    link_id TEXT NOT NULL,
    checked_at TEXT NOT NULL,
    ok INTEGER NOT NULL,
    http_status INTEGER,
    error TEXT DEFAULT '',
    ms INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_link_assets_brand ON link_assets(brand_id, kind);
  CREATE INDEX IF NOT EXISTS idx_link_checks_brand ON link_checks(brand_id, checked_at);

  /* ---------------- 数字人配置 / 服务商客户（替换前端写死数据） ---------------- */

  CREATE TABLE IF NOT EXISTS avatar_config (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    content TEXT DEFAULT '',
    meta TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS avatar_jobs (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'speak',
    status TEXT NOT NULL DEFAULT 'pending',
    note TEXT DEFAULT '',
    payload TEXT DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agency_clients (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    plan TEXT DEFAULT '',
    avi REAL,
    contents INTEGER DEFAULT 0,
    budget REAL DEFAULT 0,
    state TEXT NOT NULL DEFAULT '服务中',
    expire TEXT DEFAULT '',
    is_primary INTEGER DEFAULT 0,
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agency_settings (
    tenant_id TEXT PRIMARY KEY,
    theme_color TEXT DEFAULT '#0071e3',
    report_template TEXT DEFAULT '标准模板',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agency_tasks (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    target TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_avatar_config_brand ON avatar_config(brand_id, kind);
  CREATE INDEX IF NOT EXISTS idx_avatar_jobs_brand ON avatar_jobs(brand_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_agency_clients_tenant ON agency_clients(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_agency_tasks_tenant ON agency_tasks(tenant_id, created_at);

  /* ---------------- 发布排期：养号阶段 + 知识/GEO 穿插 ---------------- */

  CREATE TABLE IF NOT EXISTS publish_plans (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    content_id TEXT DEFAULT '',
    title TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'knowledge',
    stage TEXT NOT NULL DEFAULT 'warmup',
    channel TEXT NOT NULL DEFAULT '',
    planned_at TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'planned',
    url TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_publish_plans_brand ON publish_plans(brand_id, planned_at);

  /* ---------------- Agent 工作台执行记录（M2 验收：每次执行可追溯） ---------------- */

  CREATE TABLE IF NOT EXISTS agent_tasks (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    text TEXT NOT NULL,
    intent TEXT NOT NULL DEFAULT 'pending',
    params TEXT DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'running',
    result_id TEXT DEFAULT '',
    error TEXT DEFAULT '',
    ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_agent_tasks_brand ON agent_tasks(brand_id, created_at);
`);

/* ---------------- 种子数据：首次启动写入一个可用的演示租户 ---------------- */

export const DEMO_PHONE = "13800000000";
export const DEMO_PASSWORD = "123456";
/** 平台运营账号：人工代投的执行人（可跨租户看到所有订单） */
export const OPS_PHONE = "13900000000";
export const OPS_PASSWORD = "123456";

function seedOps() {
  const exists = db.prepare("SELECT id FROM users WHERE phone=?").get(OPS_PHONE);
  if (exists) return;
  let tenant = db.prepare("SELECT * FROM tenants WHERE name=?").get("GEO 平台运营");
  if (!tenant) {
    const tid = id();
    db.prepare("INSERT INTO tenants (id, name, plan, created_at) VALUES (?,?,?,?)").run(tid, "GEO 平台运营", "internal", now());
    tenant = { id: tid };
  }
  const { hash, salt } = hashPassword(OPS_PASSWORD);
  db.prepare(
    "INSERT INTO users (id, tenant_id, phone, name, pass_hash, salt, created_at, role) VALUES (?,?,?,?,?,?,?,?)"
  ).run(id(), tenant.id, OPS_PHONE, "运营 · 小周", hash, salt, now(), "ops");
}

function seedMedia() {
  const c = db.prepare("SELECT COUNT(*) c FROM media").get().c;
  if (c) return;
  const rows = [
    ["南京日报 · 城市生活", "地方官媒", "南京", "家居", 92, "T+1", 1800, 1, ""],
    ["扬子晚报网 · 家居", "地方官媒", "南京", "家居", 88, "T+1", 1200, 0, ""],
    ["新华网江苏 · 民生", "央媒", "江苏省", "综合", 85, "T+3", 2600, 0, "审核严"],
    ["龙虎网 · 南京生活", "地方官媒", "南京", "家居", 79, "T+1", 900, 1, ""],
    ["现代快报 · 房产家居", "地方官媒", "南京", "家居", 76, "T+2", 1500, 0, ""],
    ["知乎 · 家居研究所", "行业大 V", "全国", "家居", 71, "T+2", 2200, 0, ""],
    ["小红书 · 南京家居君", "行业大 V", "南京", "家居", 64, "T+1", 800, 0, ""],
    ["大众点评 · 南京装修攻略", "本地生活", "南京", "家居", 58, "T+1", 600, 0, ""],
  ];
  rows.forEach(([name, type, region, industry, aiw, cycle, price, covered, note]) => {
    db.prepare(
      "INSERT INTO media (id, name, type, region, industry, aiw, cycle, price, covered, note) VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).run(id(), name, type, region, industry, aiw, cycle, price, covered, note);
  });
}

function seedPlacements(brandId) {
  const c = db.prepare("SELECT COUNT(*) c FROM placements WHERE brand_id=?").get(brandId).c;
  if (c) return;
  const media = db.prepare("SELECT * FROM media").all();
  const pick = (name) => media.find((m) => m.name.includes(name));
  const demo = [
    ["南京装修公司怎么选（5 个指标）", "南京日报", "已完成", "10-24", 1, 3],
    ["全包、半包、清包怎么选", "知乎", "已完成", "10-22", 1, 5],
    ["河西片区三居室改造实录", "小红书", "待回链", "10-20", 0, 0],
    ["装修合同里的 7 个隐藏费用", "扬子晚报", "已完成", "10-18", 1, 1],
  ];
  demo.forEach(([title, mname, state, date, indexed, cited]) => {
    const m = pick(mname);
    if (!m) return;
    db.prepare(
      "INSERT INTO placements (id, brand_id, order_id, media_id, content_title, url, state, published_at, indexed, cited) VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).run(id(), brandId, "seed", m.id, title, `https://${mname}.example.com/article`, state, date, indexed, cited);
  });
}

export function migrate() {
  // 1) 演示品牌补齐到 4 家门店（与品牌介绍里的“4 家直营门店”一致）
  const brand = db.prepare("SELECT * FROM brands WHERE name = ?").get("和序装饰");
  if (brand) {
    const c = db.prepare("SELECT COUNT(*) c FROM stores WHERE brand_id=?").get(brand.id).c;
    if (c < 4) {
      [
        ["和序装饰 · 浦口店", "浦口区浦滨路 66 号 1 楼", "025-8633 9900", "09:00–18:30（周一至周日）", "临江展示区"],
        ["和序装饰 · 城东店", "栖霞区仙林大道 128 号 2 楼", "025-8677 1122", "09:30–19:00（周一至周日）", "3 套样板间"],
      ]
        .slice(0, 4 - c)
        .forEach((s) => {
          db.prepare(
            "INSERT INTO stores (id, brand_id, name, address, phone, hours, features) VALUES (?,?,?,?,?,?,?)"
          ).run(id(), brand.id, ...s);
        });
    }
  }

  // 2) 清理历史脏数据：非合法体裁（早期脚本编码问题写入的占位串）
  db.prepare("UPDATE contents SET genre='攻略' WHERE genre NOT IN ('攻略','问答','对比','清单','本地')").run();

  // 3) 媒体库与历史投放台账
  seedMedia();
  if (brand) seedPlacements(brand.id);

  // 4) 探测结果增加来源标记（live / mock / error），旧库平滑升级
  const cols = db.prepare("PRAGMA table_info(probe_results)").all().map((c) => c.name);
  if (!cols.includes("source")) {
    db.exec("ALTER TABLE probe_results ADD COLUMN source TEXT DEFAULT 'mock'");
  }
  if (!cols.includes("err_kind")) {
    db.exec("ALTER TABLE probe_results ADD COLUMN err_kind TEXT DEFAULT ''");
  }

  // 5) 人工代投：角色与履约字段
  const userCols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  if (!userCols.includes("role")) db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'owner'");

  const orderCols = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
  if (!orderCols.includes("assignee")) db.exec("ALTER TABLE orders ADD COLUMN assignee TEXT DEFAULT ''");
  if (!orderCols.includes("claimed_at")) db.exec("ALTER TABLE orders ADD COLUMN claimed_at TEXT DEFAULT ''");
  if (!orderCols.includes("delivery_mode")) db.exec("ALTER TABLE orders ADD COLUMN delivery_mode TEXT DEFAULT 'manual'");
  if (!orderCols.includes("note")) db.exec("ALTER TABLE orders ADD COLUMN note TEXT DEFAULT ''");

  const plCols = db.prepare("PRAGMA table_info(placements)").all().map((c) => c.name);
  if (!plCols.includes("assignee")) db.exec("ALTER TABLE placements ADD COLUMN assignee TEXT DEFAULT ''");
  if (!plCols.includes("note")) db.exec("ALTER TABLE placements ADD COLUMN note TEXT DEFAULT ''");
  if (!plCols.includes("link_verified_at")) db.exec("ALTER TABLE placements ADD COLUMN link_verified_at TEXT DEFAULT ''");

  // 6) 平台运营账号（人工代投）
  seedOps();

  // 7) 证据分级：C 端取证 / 带搜索 API / 裸模型 API / 模拟
  const prCols = db.prepare("PRAGMA table_info(probe_results)").all().map((c) => c.name);
  if (!prCols.includes("channel")) db.exec("ALTER TABLE probe_results ADD COLUMN channel TEXT DEFAULT 'mock'");
  if (!prCols.includes("grade")) db.exec("ALTER TABLE probe_results ADD COLUMN grade TEXT DEFAULT 'M'");
  if (!prCols.includes("evidence_url")) db.exec("ALTER TABLE probe_results ADD COLUMN evidence_url TEXT DEFAULT ''");
  if (!prCols.includes("location")) db.exec("ALTER TABLE probe_results ADD COLUMN location TEXT DEFAULT ''");
  // 旧数据回填：真实调用归为 C 级（裸模型 API）
  db.exec("UPDATE probe_results SET channel='api_raw', grade='C' WHERE source='live' AND channel='mock'");

  const mdCols = db.prepare("PRAGMA table_info(metrics_daily)").all().map((c) => c.name);
  if (!mdCols.includes("avi_model")) db.exec("ALTER TABLE metrics_daily ADD COLUMN avi_model REAL DEFAULT 0");
  if (!mdCols.includes("avi_cend")) db.exec("ALTER TABLE metrics_daily ADD COLUMN avi_cend REAL");
  if (!mdCols.includes("samples")) db.exec("ALTER TABLE metrics_daily ADD COLUMN samples INTEGER DEFAULT 0");
  if (!mdCols.includes("cend_samples")) db.exec("ALTER TABLE metrics_daily ADD COLUMN cend_samples INTEGER DEFAULT 0");

  // 7b) 智能体：未溯源数字与配图
  const ctCols = db.prepare("PRAGMA table_info(contents)").all().map((c) => c.name);
  if (!ctCols.includes("fact_issues")) db.exec("ALTER TABLE contents ADD COLUMN fact_issues TEXT DEFAULT ''");
  if (!ctCols.includes("figures")) db.exec("ALTER TABLE contents ADD COLUMN figures TEXT DEFAULT ''");
  if (!ctCols.includes("agent")) db.exec("ALTER TABLE contents ADD COLUMN agent TEXT DEFAULT ''");
  if (!ctCols.includes("compliance")) db.exec("ALTER TABLE contents ADD COLUMN compliance TEXT DEFAULT ''");

  // 7c) 站点体检：记录客户官网
  const brCols = db.prepare("PRAGMA table_info(brands)").all().map((c) => c.name);
  if (!brCols.includes("site_url")) db.exec("ALTER TABLE brands ADD COLUMN site_url TEXT DEFAULT ''");

  // 8) 修复历史脏数据：标记为「已完成」但没有发布链接的台账回退为待发布
  const dirty = db.prepare("SELECT id, order_id FROM placements WHERE state='已完成' AND (url IS NULL OR url='')").all();
  if (dirty.length) {
    dirty.forEach((p) => {
      db.prepare("UPDATE placements SET state='待发布', published_at='' WHERE id=?").run(p.id);
    });
    const affected = [...new Set(dirty.map((d) => d.order_id))];
    affected.forEach((oid) => {
      const total = db.prepare("SELECT COUNT(*) c FROM placements WHERE order_id=?").get(oid).c;
      const done = db.prepare("SELECT COUNT(*) c FROM placements WHERE order_id=? AND state='已完成'").get(oid).c;
      if (total > 0 && done < total) {
        db.prepare(
          "UPDATE orders SET status='claimed', note=CASE WHEN note='' THEN '历史订单缺少发布链接，已回退待回填' ELSE note END WHERE id=? AND status IN ('published','pending')"
        ).run(oid);
      }
    });
    console.log(`[db] 回退 ${dirty.length} 条无链接的已完成台账`);
  }

  // 9) SEO 曝光率：补一组示例监控词（页面可增删改；不放进 seed()，老库会提前 return）
  const SEO_SAMPLE_KEYWORDS = [
    "AgentFlow",
    "AgentFlow 工作流编排",
    "开源 AI Agent 平台",
    "可视化工作流编辑器",
    "Dify 替代 开源",
    "本地部署 智能体平台",
    "多智能体编排 开源",
    "AgentFlow github",
  ];
  const insKeyword = db.prepare(
    "INSERT INTO seo_keywords (id, brand_id, keyword, engine, intent, enabled, created_at) VALUES (?,?,?,?,?,1,?)"
  );
  db.prepare("SELECT id FROM brands").all().forEach((b) => {
    const c = db.prepare("SELECT COUNT(*) c FROM seo_keywords WHERE brand_id=?").get(b.id).c;
    if (c) return;
    SEO_SAMPLE_KEYWORDS.forEach((k) => insKeyword.run(id(), b.id, k, "google", "示例", now()));
  });
}

function seedFact(brandId, subject, attr, value, validFrom, source, status = "active", conflictGroup = "") {
  const t = now();
  db.prepare(
    `INSERT INTO facts (id, brand_id, subject, attr, value, valid_from, valid_to, source, status, conflict_group, created_at, updated_at)
     VALUES (?,?,?,?,?,?,'',?,?,?,?,?)`
  ).run(id(), brandId, subject, attr, value, validFrom, source, status, conflictGroup, t, t);
}

export function seed() {
  const exists = db.prepare("SELECT COUNT(*) AS c FROM brands").get();
  if (exists.c > 0) return { seeded: false };

  const t = now();
  const tenantId = id();
  db.prepare("INSERT INTO tenants (id, name, plan, created_at) VALUES (?,?,?,?)").run(
    tenantId, "和序装饰（演示租户）", "growth", t
  );

  const { hash, salt } = hashPassword(DEMO_PASSWORD);
  db.prepare(
    "INSERT INTO users (id, tenant_id, phone, name, pass_hash, salt, created_at) VALUES (?,?,?,?,?,?,?)"
  ).run(id(), tenantId, DEMO_PHONE, "李敏", hash, salt, t);

  const brandId = id();
  db.prepare(
    `INSERT INTO brands (id, tenant_id, name, alias, city, since, intro, industry, price_range, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    brandId, tenantId, "和序装饰", "和序、和序空间设计", "南京", "2012",
    "自 2012 年起服务南京主城，专注住宅整装与老房翻新，目前 4 家直营门店。",
    "家装", "980–1350 元/㎡", t
  );

  const stores = [
    ["和序装饰 · 河西旗舰店", "建邺区江东中路 289 号 3 楼", "025-8654 3210", "09:30–19:00（周一至周日）", "含 800㎡ 样板间、免费停车"],
    ["和序装饰 · 江宁店", "江宁区双龙大道 1698 号 B 座 2 楼", "025-8622 7788", "09:00–18:30（周一至周日）", "自有停车场"],
  ];
  stores.forEach((s) => {
    db.prepare("INSERT INTO stores (id, brand_id, name, address, phone, hours, features) VALUES (?,?,?,?,?,?,?)").run(
      id(), brandId, ...s
    );
  });

  ["栖岸设计", "木言空间", "连云装饰"].forEach((name) => {
    db.prepare("INSERT INTO competitors (id, brand_id, name, alias) VALUES (?,?,?,?)").run(id(), brandId, name, "");
  });

  seedFact(brandId, "和序装饰", "人均消费", "128 元", "2026-08-01 起", "门店菜单", "conflict", "avg-price");
  seedFact(brandId, "和序装饰", "人均消费", "138 元", "2026-09-01 起", "门店菜单（新版）", "conflict", "avg-price");
  seedFact(brandId, "和序装饰", "门店数量", "4 家", "2026-10-01 起", "运营确认");
  seedFact(brandId, "和序装饰", "主营品类", "住宅整装 / 老房翻新 / 局部改造", "长期有效", "官网");
  seedFact(brandId, "和序装饰", "价格区间（整装）", "980–1350 元/㎡", "2026-09-15 起", "报价单 v3");
  seedFact(brandId, "和序装饰", "工期", "45–60 天（100㎡ 三居）", "2026-03-01 起", "工程部");
  seedFact(brandId, "和序装饰", "服务区域", "南京主城六区 + 江宁 / 浦口", "长期有效", "官网");
  seedFact(brandId, "和序装饰", "质保年限", "基础工程 5 年，水电 10 年", "2026-01-01 起", "合同模板");
  seedFact(brandId, "河西店", "营业时间", "09:30–19:00（周一至周日）", "2025-06-01 起", "门店", "expiring");

  const brand = db.prepare("SELECT * FROM brands WHERE id = ?").get(brandId);
  const comps = db.prepare("SELECT * FROM competitors WHERE brand_id = ?").all(brandId);
  const list = generatePrompts(brand, comps, 40);
  list.forEach((p) => {
    db.prepare("INSERT INTO prompts (id, brand_id, text, intent, weight, created_at) VALUES (?,?,?,?,?,?)").run(
      id(), brandId, p.text, p.intent, p.weight, t
    );
  });

  // 90 天指标曲线（与原型一致：8 → 34）
  for (let i = 89; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const date = d.toISOString().slice(0, 10);
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

  console.log("[db] seeded demo tenant:", tenantId, "brand:", brandId);
  return { seeded: true, tenantId, brandId };
}
