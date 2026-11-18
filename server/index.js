import express from "express";
import multer from "multer";
import { mkdirSync, existsSync, unlinkSync, writeFileSync, copyFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { db, id, now, seed, migrate, DEMO_PHONE, DEMO_PASSWORD, OPS_PHONE, OPS_PASSWORD } from "./db.js";
import { hashPassword, verifyPassword, signToken, requireAuth, requireOps, requireLevel, isPriceAttr, audit, ROLE_LEVEL, ownedBrand } from "./auth.js";
import { generatePrompts, scoreContent, analyzeAnswer } from "./geo.js";
import { createRun, runSummary, loadContext, mode, PLATFORMS } from "./probe.js";
import { computeBrandMetrics } from "./metrics.js";
import { loadEnv, providerStatus, testProvider } from "./providers.js";
import { extract as extractDocument, isSupported, extOf, SUPPORTED } from "./kb/extract.js";
import { chunkPages } from "./kb/chunk.js";
import * as kbSearch from "./kb/search.js";
import { agentStatus, articleSystemPrompt, buildPrompt, runAgent } from "./agent/piagent.js";
import { checkFacts } from "./agent/factcheck.js";
import { buildFigures, injectFigures } from "./agent/figures.js";
import { checkCompliance } from "./agent/compliance.js";
import { renderHtml, makeImageResolver } from "./agent/md2html.js";
import { auditSite, normalizeUrl } from "./agent/siteaudit.js";
import { buildSiteAssets } from "./agent/siteassets.js";
import { scanTarget, querySerp, queryIndexed, matchPosition, searchConfig, hostOf } from "./seo.js";
import { normalizeLink, extractHosts, checkLink, citationCounts, serpHitCounts } from "./links.js";
import { parseCsvRecords, computeExposure } from "./seo-import.js";
import { renderArticle } from "./content-template.js";
import { buildPlanSlots } from "./plan.js";
import { routeIntent, describeIntent, fieldsFor, needsConfirm, selectAnswerHits, AGENT_PRESETS } from "./agent-router.js";
import {
  keywordPrompt,
  questionPrompt,
  parseJsonLoose,
  auditKeywords,
  auditPrompts,
  isLocalService,
} from "./prompt-gen.js";
import {
  normalizeAnswerQuery,
  buildAnswerWhere,
  parseCitations,
  toAnswerRow,
  toAnswerCsv,
  ANSWER_CSV_LIMIT,
  ANSWER_MAX_PAGE_SIZE,
} from "./answers-query.js";

// 先加载 server/.env，再初始化任何依赖配置的模块
loadEnv();

const PORT = process.env.PORT || 8002;
const app = express();
app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use((req, _res, next) => {
  if (req.path.startsWith("/api")) console.log(`${req.method} ${req.path}`);
  next();
});

/** 审计中间件：所有写请求在成功返回后记录一条（谁、何时、对什么做了什么） */
app.use((req, res, next) => {
  if (!["POST", "PATCH", "DELETE"].includes(req.method)) return next();
  if (!req.path.startsWith("/api/") || req.path.startsWith("/api/auth")) return next();
  if (req.path === "/api/providers/test") return next();
  const original = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode < 400 && req.user && req.tenant) {
      const segs = req.path.split("/").filter(Boolean);
      audit(req, `${req.method} ${req.path}`, segs[1] || "", segs[segs.length - 1] || "", "");
    }
    return original(body);
  };
  next();
});

const wrap = (fn) => (req, res) => {
  try {
    const out = fn(req, res);
    if (out && typeof out.then === "function") {
      out.catch((e) => {
        console.error("[api]", e);
        res.status(500).json({ error: String(e.message || e) });
      });
    }
  } catch (e) {
    console.error("[api]", e);
    res.status(500).json({ error: String(e.message || e) });
  }
};

const mapBrand = (b) => ({
  id: b.id,
  name: b.name,
  alias: b.alias,
  city: b.city,
  since: b.since,
  intro: b.intro,
  industry: b.industry,
  priceRange: b.price_range,
  createdAt: b.created_at,
});

const mapFact = (f) => ({
  id: f.id,
  brandId: f.brand_id,
  subject: f.subject,
  attr: f.attr,
  value: f.value,
  validFrom: f.valid_from,
  validTo: f.valid_to,
  source: f.source,
  status: f.status,
  conflictGroup: f.conflict_group,
  updatedAt: f.updated_at,
});

const mapPrompt = (p) => ({
  id: p.id,
  text: p.text,
  intent: p.intent,
  weight: p.weight,
  createdAt: p.created_at,
  /** 已取证的平台数（去重），用于矩阵里显示采集进度 */
  evidenced: p.evidenced ?? 0,
});

const PROMPT_INTENTS = new Set(["认知", "决策", "口碑", "比较", "本地"]);

const mapResult = (r) => ({
  id: r.id,
  promptId: r.prompt_id,
  platform: r.platform,
  answer: r.answer,
  position: r.position,
  mention: !!r.mention,
  accuracy: r.accuracy,
  compMentions: r.comp_mentions,
  createdAt: r.created_at,
});

/* ---------------- 健康检查 ---------------- */

app.get("/api/health", (_req, res) => {
  const providers = providerStatus();
  res.json({
    ok: true,
    mode: mode(),
    providers: providers.map((p) => ({ key: p.key, name: p.name, live: p.live, model: p.model })),
    platforms: PLATFORMS.map((p) => ({ key: p.key, name: p.name })),
    demo: { phone: DEMO_PHONE, password: DEMO_PASSWORD },
    ops: { phone: OPS_PHONE, password: OPS_PASSWORD },
  });
});

/* ---------------- 模型接入状态 ---------------- */

app.get(
  "/api/providers",
  requireAuth,
  wrap((_req, res) => {
    res.json({ mode: mode(), providers: providerStatus() });
  })
);

/** 连通性自检：不写库，只发一个极小请求 */
app.post(
  "/api/providers/test",
  requireAuth,
  wrap(async (req, res) => {
    const key = String(req.body?.key || "");
    if (!key) return res.status(400).json({ error: "缺少平台 key" });
    const out = await testProvider(key);
    res.json(out);
  })
);

/* ---------------- 认证 ---------------- */

app.post(
  "/api/auth/register",
  wrap((req, res) => {
    const { phone, password, name } = req.body || {};
    if (!/^1\d{10}$/.test(String(phone || ""))) return res.status(400).json({ error: "手机号格式不正确" });
    if (String(password || "").length < 6) return res.status(400).json({ error: "密码至少 6 位" });

    const exists = db.prepare("SELECT id FROM users WHERE phone = ?").get(phone);
    if (exists) return res.status(409).json({ error: "该手机号已注册，请直接登录" });

    const t = now();
    const tenantId = id();
    db.prepare("INSERT INTO tenants (id, name, plan, created_at) VALUES (?,?,?,?)").run(
      tenantId, `${name || phone} 的组织`, "growth", t
    );
    const { hash, salt } = hashPassword(password);
    const userId = id();
    db.prepare(
      "INSERT INTO users (id, tenant_id, phone, name, pass_hash, salt, created_at) VALUES (?,?,?,?,?,?,?)"
    ).run(userId, tenantId, phone, name || "", hash, salt, t);

    res.json({ token: signToken({ uid: userId, tid: tenantId }), user: { id: userId, phone, name } });
  })
);

app.post(
  "/api/auth/login",
  wrap((req, res) => {
    const { phone, password } = req.body || {};
    const user = db.prepare("SELECT * FROM users WHERE phone = ?").get(String(phone || ""));
    if (!user) return res.status(401).json({ error: "账号不存在，请先注册" });
    if (!verifyPassword(String(password || ""), user.pass_hash, user.salt)) {
      return res.status(401).json({ error: "密码不正确" });
    }
    res.json({
      token: signToken({ uid: user.id, tid: user.tenant_id }),
      user: { id: user.id, phone: user.phone, name: user.name },
    });
  })
);

app.get(
  "/api/me",
  requireAuth,
  wrap((req, res) => {
    const brands = db.prepare("SELECT * FROM brands WHERE tenant_id = ? ORDER BY created_at").all(req.tenant.id);
    res.json({
      user: { id: req.user.id, phone: req.user.phone, name: req.user.name, role: req.user.role || "owner" },
      tenant: { id: req.tenant.id, name: req.tenant.name, plan: req.tenant.plan },
      brands: brands.map(mapBrand),
      mode: mode(),
      permissions: {
        write: (ROLE_LEVEL[req.user.role] ?? 1) >= 2,
        manage: req.user.role === "owner",
        ops: req.user.role === "ops",
      },
    });
  })
);

/* ---------------- 成员与权限 ---------------- */

const ASSIGNABLE_ROLES = ["editor", "viewer"];

app.get(
  "/api/members",
  requireAuth,
  wrap((req, res) => {
    const rows = db
      .prepare("SELECT id, phone, name, role, created_at FROM users WHERE tenant_id=? ORDER BY created_at")
      .all(req.tenant.id);
    res.json(
      rows.map((u) => ({
        id: u.id,
        phone: u.phone,
        name: u.name || "",
        role: u.role || "viewer",
        isSelf: u.id === req.user.id,
        createdAt: u.created_at,
      }))
    );
  })
);

app.post(
  "/api/members",
  requireAuth,
  requireLevel("owner"),
  wrap((req, res) => {
    const { phone, name = "", role = "editor", password = "12345678" } = req.body || {};
    if (!/^1\d{10}$/.test(String(phone || ""))) return res.status(400).json({ error: "手机号格式不正确" });
    if (!ASSIGNABLE_ROLES.includes(role)) return res.status(400).json({ error: "只能邀请「编辑」或「只读」成员" });
    if (String(password).length < 6) return res.status(400).json({ error: "初始密码至少 6 位" });

    const exists = db.prepare("SELECT id FROM users WHERE phone=?").get(String(phone));
    if (exists) return res.status(409).json({ error: "该手机号已注册，请直接添加为成员或换号" });

    const { hash, salt } = hashPassword(String(password));
    const uid = id();
    db.prepare(
      "INSERT INTO users (id, tenant_id, phone, name, pass_hash, salt, created_at, role) VALUES (?,?,?,?,?,?,?,?)"
    ).run(uid, req.tenant.id, String(phone), name, hash, salt, now(), role);

    res.status(201).json({
      id: uid,
      phone: String(phone),
      name,
      role,
      initialPassword: password,
    });
  })
);

app.patch(
  "/api/members/:memberId",
  requireAuth,
  requireLevel("owner"),
  wrap((req, res) => {
    const u = db.prepare("SELECT * FROM users WHERE id=? AND tenant_id=?").get(req.params.memberId, req.tenant.id);
    if (!u) return res.status(404).json({ error: "成员不存在" });
    if (u.role === "owner") return res.status(400).json({ error: "不能修改负责人的角色" });
    const role = String(req.body?.role || "");
    if (!ASSIGNABLE_ROLES.includes(role)) return res.status(400).json({ error: "只能设为「编辑」或「只读」" });
    db.prepare("UPDATE users SET role=? WHERE id=?").run(role, u.id);
    res.json({ ok: true, role });
  })
);

app.delete(
  "/api/members/:memberId",
  requireAuth,
  requireLevel("owner"),
  wrap((req, res) => {
    const u = db.prepare("SELECT * FROM users WHERE id=? AND tenant_id=?").get(req.params.memberId, req.tenant.id);
    if (!u) return res.status(404).json({ error: "成员不存在" });
    if (u.id === req.user.id) return res.status(400).json({ error: "不能移除自己" });
    if (u.role === "owner") return res.status(400).json({ error: "不能移除负责人" });
    db.prepare("DELETE FROM users WHERE id=?").run(u.id);
    res.json({ ok: true });
  })
);

app.get(
  "/api/audit-logs",
  requireAuth,
  requireLevel("owner"),
  wrap((req, res) => {
    const rows = db
      .prepare("SELECT * FROM audit_logs WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100")
      .all(req.tenant.id);
    res.json(
      rows.map((l) => ({
        id: l.id,
        action: l.action,
        actionText: labelAction(l.action),
        objectType: l.object_type,
        objectId: l.object_id,
        userName: l.user_name,
        createdAt: l.created_at,
      }))
    );
  })
);

/** 把「PUT /api/xxx」这类原始串翻译成业务可读的中文 */
const ACTION_LABELS = [
  [/^POST \/api\/facts$/, "新增事实卡"],
  [/^POST \/api\/facts\/[^/]+\/resolve$/, "解决口径冲突"],
  [/^PATCH \/api\/facts\/[^/]+$/, "修改事实卡"],
  [/^DELETE \/api\/facts\/[^/]+$/, "删除事实卡"],
  [/^POST \/api\/brands$/, "创建品牌"],
  [/^POST \/api\/prompts\/generate$/, "生成提问矩阵"],
  [/^POST \/api\/prompts$/, "新增提问"],
  [/^DELETE \/api\/prompts\/[^/]+$/, "删除提问"],
  [/^POST \/api\/probes\/run$/, "运行诊断"],
  [/^POST \/api\/contents\/generate$/, "生成内容"],
  [/^PATCH \/api\/contents\/[^/]+$/, "变更内容状态"],
  [/^POST \/api\/orders$/, "提交投放订单"],
  [/^POST \/api\/orders\/[^/]+\/cancel$/, "取消投放订单"],
  [/^PATCH \/api\/orders\/[^/]+$/, "确认订单发布"],
  [/^POST \/api\/members$/, "邀请成员"],
  [/^PATCH \/api\/members\/[^/]+$/, "调整成员角色"],
  [/^DELETE \/api\/members\/[^/]+$/, "移除成员"],
  [/^POST \/api\/ops\/orders\/[^/]+\/claim$/, "运营接单"],
  [/^POST \/api\/ops\/placements\/[^/]+\/publish$/, "回填发布链接"],
  [/^POST \/api\/ops\/placements\/[^/]+\/reject$/, "标记媒体退回"],
];

function labelAction(raw) {
  for (const [re, label] of ACTION_LABELS) if (re.test(String(raw))) return label;
  return String(raw);
}

/* ---------------- 品牌与建档 ---------------- */

app.get(
  "/api/brands",
  requireAuth,
  wrap((req, res) => {
    const rows = db.prepare("SELECT * FROM brands WHERE tenant_id = ? ORDER BY created_at").all(req.tenant.id);
    res.json(rows.map(mapBrand));
  })
);

app.post(
  "/api/brands",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const { name, alias = "", city = "", since = "", intro = "", industry = "", priceRange = "", stores = [], competitors = [] } = req.body || {};
    if (!String(name || "").trim()) return res.status(400).json({ error: "品牌名称必填" });

    const t = now();
    const brandId = id();
    db.prepare(
      `INSERT INTO brands (id, tenant_id, name, alias, city, since, intro, industry, price_range, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(brandId, req.tenant.id, name.trim(), alias, city, since, intro, industry, priceRange, t);

    stores.forEach((s) => {
      if (!s?.name) return;
      db.prepare("INSERT INTO stores (id, brand_id, name, address, phone, hours, features) VALUES (?,?,?,?,?,?,?)").run(
        id(), brandId, s.name, s.address || "", s.phone || "", s.hours || "", s.features || ""
      );
    });

    competitors.forEach((c) => {
      const nm = typeof c === "string" ? c : c?.name;
      if (!nm) return;
      db.prepare("INSERT INTO competitors (id, brand_id, name, alias) VALUES (?,?,?,?)").run(id(), brandId, nm, "");
    });

    // 建档即落基础事实卡，保证后续诊断有口径可用；
    // 没填的项不落库：落成「—」会污染内容生成与站点资产（llms.txt 里出现一堆破折号）。
    const storeCount = stores.filter((s) => s?.name).length;
    const baseFacts = [
      ["主营品类", industry, "建档填写", "active"],
      ["价格区间", priceRange, "建档填写", "active"],
      ["服务区域", city, "建档填写", "active"],
      ["门店数量", storeCount ? `${storeCount} 家` : "", "建档填写", "active"],
    ].filter(([, v]) => {
      const s = String(v ?? "").trim();
      return s && s !== "—" && s !== "-";
    });
    baseFacts.forEach(([attr, value, source, status]) => {
      db.prepare(
        `INSERT INTO facts (id, brand_id, subject, attr, value, valid_from, valid_to, source, status, conflict_group, created_at, updated_at)
         VALUES (?,?,?,?,?,?,'',?,?,'',?,?)`
      ).run(id(), brandId, name.trim(), attr, value, `${t.slice(0, 10)} 起`, source, status, t, t);
    });

    const brand = db.prepare("SELECT * FROM brands WHERE id = ?").get(brandId);
    const comps = db.prepare("SELECT * FROM competitors WHERE brand_id = ?").all(brandId);
    generatePrompts(brand, comps, 40).forEach((p) => {
      db.prepare("INSERT INTO prompts (id, brand_id, text, intent, weight, created_at) VALUES (?,?,?,?,?,?)").run(
        id(), brandId, p.text, p.intent, p.weight, t
      );
    });

    res.status(201).json(mapBrand(brand));
  })
);

/** 删除品牌：级联清理 12 张关联表 + 附件文件；需输入品牌名确认 */
const BRAND_TABLES = [
  "stores", "competitors", "facts", "prompts", "probe_runs", "probe_results",
  "contents", "metrics_daily", "orders", "placements", "kb_documents", "kb_chunks",
  "seo_keywords", "seo_results", "seo_daily", "seo_scans",
  "link_assets", "link_checks", "avatar_config", "avatar_jobs", "publish_plans",
];

app.delete(
  "/api/brands/:brandId",
  requireAuth,
  requireLevel("owner"),
  wrap((req, res) => {
    const b = db.prepare("SELECT * FROM brands WHERE id=? AND tenant_id=?").get(req.params.brandId, req.tenant.id);
    if (!b) return res.status(404).json({ error: "品牌不存在" });

    const total = db.prepare("SELECT COUNT(*) c FROM brands WHERE tenant_id=?").get(req.tenant.id).c;
    if (total <= 1) return res.status(400).json({ error: "至少保留一个品牌，不能删除最后一个" });

    const confirmName = String(req.query.confirmName || "").trim();
    if (confirmName !== b.name) return res.status(400).json({ error: "请输入品牌名称确认删除" });

    const files = db
      .prepare("SELECT path FROM kb_documents WHERE brand_id=?")
      .all(b.id)
      .map((r) => r.path)
      .filter(Boolean);

    // 删前先整包备份：误删不可怕，可怕的是没备份。
    // 备份位于 data/backups/brand-<名称>-<时间>.json + 同名 -files 目录。
    const backupDir = join(here, "data", "backups");
    mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeName = String(b.name).replace(/[\\/:*?"<>|\s]/g, "_");
    const backupFile = join(backupDir, `brand-${safeName}-${stamp}.json`);
    const fileDir = join(backupDir, `brand-${safeName}-${stamp}-files`);

    try {
      const dump = {
        exportedAt: now(),
        brand: b,
        stores: db.prepare("SELECT * FROM stores WHERE brand_id=?").all(b.id),
        competitors: db.prepare("SELECT * FROM competitors WHERE brand_id=?").all(b.id),
        facts: db.prepare("SELECT * FROM facts WHERE brand_id=?").all(b.id),
        prompts: db.prepare("SELECT * FROM prompts WHERE brand_id=?").all(b.id),
        products: db.prepare("SELECT * FROM products WHERE brand_id=?").all(b.id),
        contents: db.prepare("SELECT * FROM contents WHERE brand_id=?").all(b.id),
        metrics_daily: db.prepare("SELECT * FROM metrics_daily WHERE brand_id=?").all(b.id),
        orders: db.prepare("SELECT * FROM orders WHERE brand_id=?").all(b.id),
        placements: db.prepare("SELECT * FROM placements WHERE brand_id=?").all(b.id),
        kb_documents: db.prepare("SELECT * FROM kb_documents WHERE brand_id=?").all(b.id),
        kb_chunks: db.prepare("SELECT * FROM kb_chunks WHERE brand_id=?").all(b.id),
      };
      writeFileSync(backupFile, JSON.stringify(dump, null, 1), "utf8");

      if (files.length) {
        mkdirSync(fileDir, { recursive: true });
        files.forEach((f) => {
          try {
            if (existsSync(f)) copyFileSync(f, join(fileDir, basename(f)));
          } catch {
            /* 单个文件失败不阻断备份 */
          }
        });
      }
    } catch (e) {
      return res.status(500).json({ error: `删除前备份失败，已中止（${e.message}）` });
    }

    const counts = {};
    db.exec("BEGIN");
    try {
      for (const t of BRAND_TABLES) {
        counts[t] = db.prepare(`DELETE FROM ${t} WHERE brand_id=?`).run(b.id).changes;
      }
      db.prepare("DELETE FROM brands WHERE id=?").run(b.id);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      return res.status(500).json({ error: `删除失败：${e.message}` });
    }

    files.forEach((f) => {
      try {
        if (existsSync(f)) unlinkSync(f);
      } catch {
        /* 文件已不在 */
      }
    });
    kbSearch.invalidate(b.id);

    res.json({ ok: true, name: b.name, deleted: counts, backup: backupFile, filesBackedUp: files.length });
  })
);

app.get(
  "/api/brands/:brandId",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    res.json({
      brand: mapBrand(brand),
      stores: db.prepare("SELECT * FROM stores WHERE brand_id = ?").all(brand.id),
      competitors: db.prepare("SELECT * FROM competitors WHERE brand_id = ?").all(brand.id),
      counts: {
        facts: db.prepare("SELECT COUNT(*) c FROM facts WHERE brand_id=?").get(brand.id).c,
        prompts: db.prepare("SELECT COUNT(*) c FROM prompts WHERE brand_id=?").get(brand.id).c,
        contents: db.prepare("SELECT COUNT(*) c FROM contents WHERE brand_id=?").get(brand.id).c,
      },
    });
  })
);

/* ---------------- 事实卡 ---------------- */

app.get(
  "/api/facts",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const rows = db.prepare("SELECT * FROM facts WHERE brand_id = ? ORDER BY created_at DESC").all(brand.id);
    res.json(rows.map(mapFact));
  })
);

app.post(
  "/api/facts",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const { brandId, subject, attr, value, validFrom = "", source = "" } = req.body || {};
    const brand = ownedBrand(req, brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    if (!subject || !attr || !value) return res.status(400).json({ error: "主体、属性、值必填" });
    if (isPriceAttr(attr, value) && req.user.role !== "owner") {
      return res.status(403).json({ error: "价格类事实卡仅负责人可新增（避免口径被随意改动）" });
    }

    const t = now();
    const dupe = db
      .prepare("SELECT * FROM facts WHERE brand_id=? AND subject=? AND attr=? AND value=?")
      .get(brand.id, subject, attr, value);
    if (dupe) return res.status(409).json({ error: "该事实已存在" });

    const sameAttr = db
      .prepare("SELECT * FROM facts WHERE brand_id=? AND subject=? AND attr=? AND status!='archived'")
      .all(brand.id, subject, attr);

    const conflictGroup = sameAttr.length ? sameAttr[0].conflict_group || `cg-${id().slice(0, 8)}` : "";
    if (conflictGroup && sameAttr.length) {
      db.prepare("UPDATE facts SET status='conflict', conflict_group=? WHERE brand_id=? AND subject=? AND attr=? AND status='active'")
        .run(conflictGroup, brand.id, subject, attr);
    }

    const newId = id();
    db.prepare(
      `INSERT INTO facts (id, brand_id, subject, attr, value, valid_from, valid_to, source, status, conflict_group, created_at, updated_at)
       VALUES (?,?,?,?,?,?,'',?,?,?,?,?)`
    ).run(newId, brand.id, subject, attr, value, validFrom, source, sameAttr.length ? "conflict" : "active", conflictGroup, t, t);

    res.status(201).json(mapFact(db.prepare("SELECT * FROM facts WHERE id=?").get(newId)));
  })
);

app.patch(
  "/api/facts/:factId",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const fact = db.prepare("SELECT * FROM facts WHERE id = ?").get(req.params.factId);
    if (!fact) return res.status(404).json({ error: "事实卡不存在" });
    const brand = ownedBrand(req, fact.brand_id);
    if (!brand) return res.status(403).json({ error: "无权操作" });
    if (isPriceAttr(fact.attr, req.body?.value ?? fact.value) && req.user.role !== "owner") {
      return res.status(403).json({ error: "价格类事实卡仅负责人可修改" });
    }

    const { value, validFrom, source } = req.body || {};
    db.prepare("UPDATE facts SET value=?, valid_from=?, source=?, updated_at=? WHERE id=?").run(
      value ?? fact.value,
      validFrom ?? fact.valid_from,
      source ?? fact.source,
      now(),
      fact.id
    );
    res.json(mapFact(db.prepare("SELECT * FROM facts WHERE id=?").get(fact.id)));
  })
);

/** 解决口径冲突：保留 keepId，另一条归档 */
app.post(
  "/api/facts/:factId/resolve",
  requireAuth,
  wrap((req, res) => {
    const fact = db.prepare("SELECT * FROM facts WHERE id = ?").get(req.params.factId);
    if (!fact) return res.status(404).json({ error: "事实卡不存在" });
    const brand = ownedBrand(req, fact.brand_id);
    if (!brand) return res.status(403).json({ error: "无权操作" });
    if (!fact.conflict_group) return res.status(400).json({ error: "该事实不存在冲突" });

    const group = db.prepare("SELECT * FROM facts WHERE brand_id=? AND conflict_group=?").all(brand.id, fact.conflict_group);
    const keepId = req.body?.keepId || fact.id;
    if (!group.some((g) => g.id === keepId)) return res.status(400).json({ error: "保留项不在冲突组内" });

    db.prepare("UPDATE facts SET status='archived', conflict_group='', updated_at=? WHERE brand_id=? AND conflict_group=? AND id!=?")
      .run(now(), brand.id, fact.conflict_group, keepId);
    db.prepare("UPDATE facts SET status='active', conflict_group='', updated_at=? WHERE id=?").run(now(), keepId);

    res.json({ ok: true, keptId: keepId, archived: group.length - 1 });
  })
);

app.delete(
  "/api/facts/:factId",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const fact = db.prepare("SELECT * FROM facts WHERE id = ?").get(req.params.factId);
    if (!fact) return res.status(404).json({ error: "事实卡不存在" });
    if (!ownedBrand(req, fact.brand_id)) return res.status(403).json({ error: "无权操作" });
    db.prepare("DELETE FROM facts WHERE id=?").run(fact.id);
    res.json({ ok: true });
  })
);

/* ---------------- 提问矩阵 ---------------- */

app.get(
  "/api/prompts",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const rows = db
      .prepare(
        `SELECT p.*,
           (SELECT COUNT(DISTINCT r.platform) FROM probe_results r
             WHERE r.prompt_id = p.id AND r.channel = 'cend') AS evidenced
         FROM prompts p
         WHERE p.brand_id = ?
         ORDER BY p.weight DESC, p.created_at`
      )
      .all(brand.id);
    res.json(rows.map(mapPrompt));
  })
);

app.post(
  "/api/prompts/generate",
  requireAuth,
  wrap((req, res) => {
    const { brandId, count = 40 } = req.body || {};
    const brand = ownedBrand(req, brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });

    const comps = db.prepare("SELECT * FROM competitors WHERE brand_id = ?").all(brand.id);
    const existing = new Set(db.prepare("SELECT text FROM prompts WHERE brand_id=?").all(brand.id).map((r) => r.text));
    const list = generatePrompts(brand, comps, Number(count) || 40).filter((p) => !existing.has(p.text));

    const t = now();
    list.forEach((p) => {
      db.prepare("INSERT INTO prompts (id, brand_id, text, intent, weight, created_at) VALUES (?,?,?,?,?,?)").run(
        id(), brand.id, p.text, p.intent, p.weight, t
      );
    });
    res.json({ added: list.length, total: existing.size + list.length });
  })
);

app.post(
  "/api/prompts",
  requireAuth,
  wrap((req, res) => {
    const { brandId, text, intent = "决策", weight = 3 } = req.body || {};
    const brand = ownedBrand(req, brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    if (!String(text || "").trim()) return res.status(400).json({ error: "问题不能为空" });
    const pid = id();
    db.prepare("INSERT INTO prompts (id, brand_id, text, intent, weight, created_at) VALUES (?,?,?,?,?,?)").run(
      pid, brand.id, text.trim(), intent, weight, now()
    );
    res.status(201).json(mapPrompt(db.prepare("SELECT * FROM prompts WHERE id=?").get(pid)));
  })
);

/** 批量删除提问（不删已取证记录，与单条删除保持一致） */
app.post(
  "/api/prompts/batch-delete",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const { brandId, ids } = req.body || {};
    const brand = ownedBrand(req, brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: "没有选中任何问题" });

    const del = db.prepare("DELETE FROM prompts WHERE id=? AND brand_id=?");
    let deleted = 0;
    db.exec("BEGIN");
    try {
      for (const pid of ids.slice(0, 500)) deleted += del.run(String(pid), brand.id).changes;
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      return res.status(500).json({ error: `批量删除失败：${e.message}` });
    }
    res.json({ ok: true, deleted });
  })
);

/** 修改提问：文本 / 意图 / 权重 */
app.patch(
  "/api/prompts/:promptId",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const p = db.prepare("SELECT * FROM prompts WHERE id=?").get(req.params.promptId);
    if (!p) return res.status(404).json({ error: "问题不存在" });
    if (!ownedBrand(req, p.brand_id)) return res.status(403).json({ error: "无权操作" });

    const f = req.body || {};
    const text = String(f.text ?? p.text).trim().slice(0, 120);
    if (text.length < 6) return res.status(400).json({ error: "问题太短，至少 6 个字" });
    const intent = PROMPT_INTENTS.has(String(f.intent)) ? String(f.intent) : p.intent;
    const weight = Math.min(3, Math.max(1, Number(f.weight ?? p.weight) || p.weight));

    db.prepare("UPDATE prompts SET text=?, intent=?, weight=? WHERE id=?").run(text, intent, weight, p.id);
    res.json(mapPrompt(db.prepare("SELECT * FROM prompts WHERE id=?").get(p.id)));
  })
);

app.delete(
  "/api/prompts/:promptId",
  requireAuth,
  wrap((req, res) => {
    const p = db.prepare("SELECT * FROM prompts WHERE id=?").get(req.params.promptId);
    if (!p) return res.status(404).json({ error: "问题不存在" });
    if (!ownedBrand(req, p.brand_id)) return res.status(403).json({ error: "无权操作" });
    db.prepare("DELETE FROM prompts WHERE id=?").run(p.id);
    res.json({ ok: true });
  })
);

/* ---------------- 探测 ---------------- */

app.post(
  "/api/probes/run",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const { brandId, platforms, sample = 1 } = req.body || {};
    const brand = ownedBrand(req, brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });

    const promptCount = db.prepare("SELECT COUNT(*) c FROM prompts WHERE brand_id=?").get(brand.id).c;
    if (!promptCount) return res.status(400).json({ error: "请先生成提问矩阵" });

    const out = createRun({ brandId: brand.id, platforms, sample });
    res.status(202).json({ ...out, mode: mode() });
  })
);

app.get(
  "/api/probes/:runId([0-9a-fA-F-]+)",
  requireAuth,
  wrap((req, res) => {
    const data = runSummary(req.params.runId);
    if (!data) return res.status(404).json({ error: "任务不存在" });
    if (!ownedBrand(req, data.run.brand_id)) return res.status(403).json({ error: "无权访问" });
    res.json({
      run: {
        id: data.run.id,
        status: data.run.status,
        total: data.run.total,
        done: data.run.done,
        mode: data.run.mode,
        error: data.run.error,
        startedAt: data.run.started_at,
        finishedAt: data.run.finished_at,
      },
      summary: data.summary,
    });
  })
);

app.get(
  "/api/probes/latest",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const run = db.prepare("SELECT * FROM probe_runs WHERE brand_id=? ORDER BY started_at DESC LIMIT 1").get(brand.id);
    if (!run) return res.json({ run: null, summary: null, results: [] });

    const data = runSummary(run.id);
    const prompts = db.prepare("SELECT * FROM prompts WHERE brand_id=?").all(brand.id);
    const promptMap = new Map(prompts.map((p) => [p.id, p]));
    const rows = db.prepare("SELECT * FROM probe_results WHERE run_id=?").all(run.id);

    // 每条 prompt 聚合出一个代表结果（便于前端列表展示）
    const grouped = new Map();
    rows.forEach((r) => {
      const cur = grouped.get(r.prompt_id);
      if (!cur || (r.mention && !cur.mention) || (r.mention && r.position < (cur.position || 99))) {
        grouped.set(r.prompt_id, r);
      }
    });

    res.json({
      run: { id: run.id, status: run.status, total: run.total, done: run.done, mode: run.mode, finishedAt: run.finished_at },
      summary: data.summary,
      results: [...grouped.values()].slice(0, 40).map((r) => ({
        ...mapResult(r),
        prompt: promptMap.get(r.prompt_id) ? mapPrompt(promptMap.get(r.prompt_id)) : null,
        platforms: rows.filter((x) => x.prompt_id === r.prompt_id).map((x) => x.platform),
      })),
    });
  })
);

/* ---------------- 采集结果浏览（M3）：原文、筛选、引用、导出 ---------------- */

const latestProbeRunId = (brandId) =>
  db.prepare("SELECT id FROM probe_runs WHERE brand_id=? ORDER BY started_at DESC LIMIT 1").get(brandId)?.id || "";

/** 导出当前筛选结果为 CSV；必须注册在 /api/answers/:id 之前 */
app.get(
  "/api/answers/export.csv",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const q = normalizeAnswerQuery({ ...req.query, page: 1, size: ANSWER_MAX_PAGE_SIZE });
    const { sql, params } = buildAnswerWhere(q, brand.id, latestProbeRunId(brand.id));
    const rows = db
      .prepare(
        `SELECT r.*, p.text AS prompt_text, p.intent AS intent
         FROM probe_results r LEFT JOIN prompts p ON p.id = r.prompt_id
         WHERE ${sql}
         ORDER BY r.created_at DESC, r.platform ASC
         LIMIT ?`
      )
      .all(...params, ANSWER_CSV_LIMIT);
    const csv = toAnswerCsv(
      rows.map((x) => ({
        createdAt: x.created_at,
        platform: x.platform,
        promptText: x.prompt_text || "",
        intent: x.intent || "",
        mention: x.mention,
        citations: x.citations,
        answer: x.answer,
      }))
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="geo-answers.csv"');
    res.send(`\uFEFF${csv}`);
  })
);

/** 答案列表：分页 + 平台 / 关键词 / 日期 / 是否被引用 */
app.get(
  "/api/answers",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const q = normalizeAnswerQuery(req.query);
    const { sql, params, runId } = buildAnswerWhere(q, brand.id, latestProbeRunId(brand.id));
    const base = `FROM probe_results r LEFT JOIN prompts p ON p.id = r.prompt_id WHERE ${sql}`;

    const total = db.prepare(`SELECT COUNT(*) c ${base}`).get(...params).c;
    const rows = db
      .prepare(
        `SELECT r.*, p.text AS prompt_text, p.intent AS intent ${base}
         ORDER BY r.created_at DESC, r.platform ASC, r.position ASC
         LIMIT ? OFFSET ?`
      )
      .all(...params, q.size, (q.page - 1) * q.size);

    const scopeRun = q.runId === "all" ? "" : q.runId || latestProbeRunId(brand.id);
    const platformRows = scopeRun
      ? db
          .prepare("SELECT platform, COUNT(*) c FROM probe_results WHERE brand_id=? AND run_id=? GROUP BY platform ORDER BY platform")
          .all(brand.id, scopeRun)
      : db.prepare("SELECT platform, COUNT(*) c FROM probe_results WHERE brand_id=? GROUP BY platform ORDER BY platform").all(brand.id);

    const sourceRows = db.prepare(`SELECT r.source, COUNT(*) c ${base} GROUP BY r.source`).all(...params);
    const sources = Object.fromEntries(sourceRows.map((x) => [x.source || "mock", x.c]));

    res.json({
      items: rows.map((r) => toAnswerRow(r)),
      total,
      sources,
      page: q.page,
      size: q.size,
      pages: Math.max(1, Math.ceil(total / q.size)),
      runId: scopeRun,
      facets: { platforms: platformRows.map((x) => ({ platform: x.platform, count: x.c })) },
      runs: db
        .prepare("SELECT id, started_at, total, mode, status FROM probe_runs WHERE brand_id=? ORDER BY started_at DESC LIMIT 10")
        .all(brand.id)
        .map((r) => ({ id: r.id, startedAt: r.started_at, total: r.total, mode: r.mode, status: r.status })),
    });
  })
);

/** 答案详情：全文 + 每条引用在台账里的登记与巡检状态 */
app.get(
  "/api/answers/:id",
  requireAuth,
  wrap((req, res) => {
    const r = db
      .prepare(
        `SELECT r.*, p.text AS prompt_text, p.intent AS intent
         FROM probe_results r LEFT JOIN prompts p ON p.id = r.prompt_id WHERE r.id = ?`
      )
      .get(req.params.id);
    if (!r) return res.status(404).json({ error: "采集记录不存在" });
    const brand = ownedBrand(req, r.brand_id);
    if (!brand) return res.status(403).json({ error: "无权访问该记录" });

    const citations = parseCitations(r.citations).map((host) => {
      const asset = db.prepare("SELECT * FROM link_assets WHERE brand_id=? AND host=?").get(brand.id, host);
      const check = asset
        ? db.prepare("SELECT * FROM link_checks WHERE link_id=? ORDER BY checked_at DESC LIMIT 1").get(asset.id)
        : null;
      return {
        host,
        inLedger: Boolean(asset),
        url: asset?.url || "",
        status: check ? (check.ok ? "active" : "broken") : asset ? "unknown" : "not-in-ledger",
        httpStatus: check?.http_status ?? null,
        checkedAt: check?.checked_at || "",
      };
    });

    res.json({
      ...toAnswerRow(r, 100000),
      answer: String(r.answer || ""),
      citations,
      mode: db.prepare("SELECT mode FROM probe_runs WHERE id=?").get(r.run_id)?.mode || "mock",
    });
  })
);

app.get(
  "/api/results/:resultId",
  requireAuth,
  wrap((req, res) => {
    const r = db.prepare("SELECT * FROM probe_results WHERE id=?").get(req.params.resultId);
    if (!r) return res.status(404).json({ error: "结果不存在" });
    const brand = ownedBrand(req, r.brand_id);
    if (!brand) return res.status(403).json({ error: "无权访问" });
    const samePrompt = db.prepare("SELECT * FROM probe_results WHERE brand_id=? AND prompt_id=?").all(brand.id, r.prompt_id);
    res.json({ result: mapResult(r), variants: samePrompt.map(mapResult) });
  })
);

/* ---------------- C 端取证（A 级证据） ---------------- */

/** A 级口径校对：品牌被提及但关键数字与生效事实不符时降分 */
function checkCendAccuracy(answer, facts, storeCount) {
  const text = String(answer || "");
  const priceFacts = facts.filter((f) => f.status === "active" && /价格|人均|报价/.test(f.attr));
  const talksMoney = /\u94b1|元|价/.test(text) && /\d/.test(text);

  if (priceFacts.length && talksMoney) {
    const nums = priceFacts.flatMap((f) => String(f.value).match(/\d{2,5}/g) || []);
    if (nums.length && !nums.some((n) => text.includes(n))) return 0.7;
  }
  const storeMatch = text.match(/(\d+)\s*家/);
  if (storeMatch && storeCount && Number(storeMatch[1]) !== storeCount) return 0.7;
  return 1;
}

app.get(
  "/api/evidence",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const rows = db
      .prepare(
        `SELECT r.*, p.text AS prompt_text, p.intent, p.weight
         FROM probe_results r LEFT JOIN prompts p ON p.id = r.prompt_id
         WHERE r.brand_id=? AND r.channel='cend' ORDER BY r.created_at DESC LIMIT 500`
      )
      .all(brand.id);
    res.json(
      rows.map((r) => ({
        id: r.id,
        promptId: r.prompt_id,
        prompt: r.prompt_text || "（提问已删除）",
        intent: r.intent,
        platform: r.platform,
        position: r.position,
        mention: !!r.mention,
        accuracy: r.accuracy,
        answer: r.answer,
        screenshotUrl: r.evidence_url || "",
        location: r.location || "",
        createdAt: r.created_at,
      }))
    );
  })
);

/** 待取证队列：按平台返回未取证问题，供「一键跳转取证」使用 */
app.get(
  "/api/evidence/queue",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });

    const prompts = db
      .prepare("SELECT id, text, intent, weight FROM prompts WHERE brand_id=? ORDER BY weight DESC, created_at")
      .all(brand.id);
    const doneRows = db
      .prepare("SELECT prompt_id, platform FROM probe_results WHERE brand_id=? AND channel='cend'")
      .all(brand.id);

    const doneSet = new Set(doneRows.map((r) => `${r.prompt_id}|${r.platform}`));
    const doneByPlatform = {};
    doneRows.forEach((r) => {
      doneByPlatform[r.platform] = (doneByPlatform[r.platform] || 0) + 1;
    });

    const limit = Math.min(50, Math.max(3, Number(req.query.limit) || 12));
    const platforms = providerStatus().map((p) => {
      const pending = prompts
        .filter((x) => !doneSet.has(`${x.id}|${p.key}`))
        .slice(0, limit)
        .map((x) => ({ id: x.id, text: x.text, intent: x.intent, weight: x.weight }));
      return {
        key: p.key,
        name: p.name,
        web: p.web,
        total: prompts.length,
        done: doneByPlatform[p.key] || 0,
        pending,
      };
    });

    const totalSamples = prompts.length * platforms.length;
    const doneSamples = doneSet.size;
    res.json({
      platforms,
      summary: {
        totalPrompts: prompts.length,
        platformCount: platforms.length,
        totalSamples,
        doneSamples,
        coverage: totalSamples ? Math.round((doneSamples / totalSamples) * 1000) / 10 : 0,
      },
    });
  })
);

app.post(
  "/api/evidence",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const { brandId, promptId, platform, answer, screenshotUrl = "", location = "" } = req.body || {};
    const brand = ownedBrand(req, brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });

    const p = db.prepare("SELECT * FROM prompts WHERE id=? AND brand_id=?").get(promptId, brand.id);
    if (!p) return res.status(400).json({ error: "请先选择一条已存在的提问" });
    if (!String(answer || "").trim()) return res.status(400).json({ error: "请粘贴完整的回答文本" });
    const pf = PLATFORMS.find((x) => x.key === platform);
    if (!pf) return res.status(400).json({ error: "平台不合法" });
    if (screenshotUrl && !/^https?:\/\//i.test(String(screenshotUrl))) {
      return res.status(400).json({ error: "存证链接需以 http(s):// 开头，或留空" });
    }

    const competitors = db.prepare("SELECT * FROM competitors WHERE brand_id=?").all(brand.id);
    const facts = db.prepare("SELECT * FROM facts WHERE brand_id=?").all(brand.id);
    const storeCount = db.prepare("SELECT COUNT(*) c FROM stores WHERE brand_id=?").get(brand.id).c;

    const text = String(answer);
    const parsed = analyzeAnswer(text, brand, competitors);
    const accuracy = parsed.mentioned ? checkCendAccuracy(text, facts, storeCount) : 0;

    const rid = id();
    const t = now();
    db.prepare(
      `INSERT INTO probe_results
        (id, run_id, brand_id, prompt_id, platform, answer, citations, position, mention, comp_mentions,
         accuracy, sentiment, created_at, source, err_kind, channel, grade, evidence_url, location)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      rid, "manual", brand.id, p.id, pf.key, text, JSON.stringify(extractHosts(text)), parsed.position,
      parsed.mentioned ? 1 : 0, parsed.compMentioned, accuracy, "neutral", t, "cend", "",
      "cend", "A", String(screenshotUrl), String(location)
    );

    const metrics = computeBrandMetrics(brand.id);
    const duplicate = db
      .prepare("SELECT COUNT(*) c FROM probe_results WHERE brand_id=? AND prompt_id=? AND platform=? AND channel='cend' AND id!=?")
      .get(brand.id, p.id, pf.key, rid).c;

    res.status(201).json({
      id: rid,
      platform: pf.key,
      platformName: pf.name,
      mention: parsed.mentioned,
      position: parsed.position,
      accuracy,
      duplicate,
      note: parsed.mentioned ? "已识别为提及" : "答案中未出现品牌名，记为未提及",
      metrics: {
        aviModel: metrics.aviModel,
        aviCend: metrics.aviCend,
        quadrant: metrics.quadrant,
        cendSamples: metrics.cendSamples,
      },
    });
  })
);

app.delete(
  "/api/evidence/:evidenceId",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const r = db.prepare("SELECT * FROM probe_results WHERE id=? AND channel='cend'").get(req.params.evidenceId);
    if (!r) return res.status(404).json({ error: "取证记录不存在" });
    if (!ownedBrand(req, r.brand_id)) return res.status(403).json({ error: "无权操作" });
    db.prepare("DELETE FROM probe_results WHERE id=?").run(r.id);
    const metrics = computeBrandMetrics(r.brand_id);
    res.json({ ok: true, metrics: { aviModel: metrics.aviModel, aviCend: metrics.aviCend, quadrant: metrics.quadrant } });
  })
);

/* ---------------- 指标与总览 ---------------- */

app.get(
  "/api/metrics",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const days = Math.min(365, Number(req.query.days) || 90);
    const rows = db
      .prepare("SELECT * FROM metrics_daily WHERE brand_id=? ORDER BY date DESC LIMIT ?")
      .all(brand.id, days);
    res.json(
      rows
        .map((r) => ({ date: r.date, avi: r.avi, mentionRate: r.mention_rate, firstRate: r.first_rate, accuracy: r.accuracy, sov: r.sov }))
        .reverse()
    );
  })
);

app.get(
  "/api/overview",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });

    const metrics = db.prepare("SELECT * FROM metrics_daily WHERE brand_id=? ORDER BY date DESC LIMIT 2").all(brand.id);
    const latest = metrics[0] || { avi: 0, mention_rate: 0, first_rate: 0, accuracy: 0, sov: 0 };
    const prev = metrics[1] || latest;

    // 按冲突组计数（一个属性可能有多条冲突值，界面上算“处”）
    const conflicts = db
      .prepare(
        "SELECT COUNT(DISTINCT COALESCE(NULLIF(conflict_group,''), id)) c FROM facts WHERE brand_id=? AND status='conflict'"
      )
      .get(brand.id).c;
    const facts = db.prepare("SELECT COUNT(*) c FROM facts WHERE brand_id=?").get(brand.id).c;
    const prompts = db.prepare("SELECT COUNT(*) c FROM prompts WHERE brand_id=?").get(brand.id).c;
    const contents = db.prepare("SELECT COUNT(*) c FROM contents WHERE brand_id=? AND status='draft'").get(brand.id).c;

    const run = db.prepare("SELECT * FROM probe_runs WHERE brand_id=? ORDER BY started_at DESC LIMIT 1").get(brand.id);
    const data = run ? runSummary(run.id) : { summary: null };

    const trendRows = db
      .prepare("SELECT date, avi, avi_model, avi_cend FROM metrics_daily WHERE brand_id=? ORDER BY date DESC LIMIT 90")
      .all(brand.id);

    const todos = [
      { tag: "库", title: `${conflicts} 处口径冲突待确认`, sub: "冲突未解决时禁止生成内容" },
      { tag: "题", title: `${prompts} 条提问已就绪`, sub: facts ? "可直接运行诊断" : "建议先补事实卡" },
      { tag: "内", title: `${contents} 篇草稿待审`, sub: "发布前需过 GEOS 与合规" },
    ];

    // 双轨指标：模型倾向与 C 端可见度分开算、分开说
    const live = computeBrandMetrics(brand.id);

    res.json({
      brand: mapBrand(brand),
      kpi: {
        avi: live.avi,
        aviModel: live.aviModel,
        aviCend: live.aviCend,
        aviDelta: +(latest.avi - prev.avi).toFixed(1),
        accuracy: latest.accuracy,
        sov: latest.sov,
        mentionRate: latest.mention_rate,
        firstRate: latest.first_rate,
        facts,
        prompts,
        samples: live.samples,
        cendSamples: live.cendSamples,
      },
      quadrant: live.quadrant,
      trend: trendRows
        .map((r) => ({ date: r.date, avi: r.avi, aviModel: r.avi_model, aviCend: r.avi_cend }))
        .reverse(),
      byPlatform: data.summary?.byPlatform || [],
      byIntent: data.summary?.byIntent || [],
      lastRun: run
        ? { id: run.id, status: run.status, mode: run.mode, finishedAt: run.finished_at, total: run.total }
        : null,
      todos,
    });
  })
);

/* ---------------- 媒体与投放 ---------------- */

app.get(
  "/api/media",
  requireAuth,
  wrap((_req, res) => {
    const rows = db.prepare("SELECT * FROM media ORDER BY aiw DESC").all();
    res.json(
      rows.map((m) => ({
        id: m.id,
        name: m.name,
        type: m.type,
        region: m.region,
        industry: m.industry,
        aiw: m.aiw,
        cycle: m.cycle,
        price: m.price,
        covered: !!m.covered,
        note: m.note,
      }))
    );
  })
);

app.get(
  "/api/orders",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const rows = db.prepare("SELECT * FROM orders WHERE brand_id=? ORDER BY created_at DESC").all(brand.id);
    res.json(
      rows.map((o) => ({
        id: o.id,
        objective: o.objective,
        total: o.total,
        status: o.status,
        createdAt: o.created_at,
        assignee: o.assignee || "",
        claimedAt: o.claimed_at || "",
        deliveryMode: o.delivery_mode || "manual",
        media: JSON.parse(o.media_ids || "[]")
          .map((mid) => {
            const m = db.prepare("SELECT * FROM media WHERE id=?").get(mid);
            return m ? { id: m.id, name: m.name, aiw: m.aiw, price: m.price } : null;
          })
          .filter(Boolean),
        placements: db
          .prepare("SELECT * FROM placements WHERE order_id=? ORDER BY rowid")
          .all(o.id)
          .map((p) => {
            const m = db.prepare("SELECT name FROM media WHERE id=?").get(p.media_id);
            return {
              id: p.id,
              media: m ? m.name : "—",
              content: p.content_title || "（待分配内容）",
              url: p.url || "",
              state: p.state,
              publishedAt: p.published_at || "",
              note: p.note || "",
            };
          }),
      }))
    );
  })
);

/** 客户侧取消订单（仅待接单状态可取消） */
app.post(
  "/api/orders/:orderId/cancel",
  requireAuth,
  wrap((req, res) => {
    const o = db.prepare("SELECT * FROM orders WHERE id=?").get(req.params.orderId);
    if (!o) return res.status(404).json({ error: "订单不存在" });
    if (!ownedBrand(req, o.brand_id)) return res.status(403).json({ error: "无权操作" });
    if (o.status !== "pending") return res.status(400).json({ error: "已接单的订单请联系运营取消" });
    db.prepare("UPDATE orders SET status='cancelled', note=? WHERE id=?").run("客户取消", o.id);
    db.prepare("DELETE FROM placements WHERE order_id=? AND state='待发布'").run(o.id);
    res.json({ ok: true, status: "cancelled" });
  })
);

app.post(
  "/api/orders",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const { brandId, mediaIds, objective = "提升可见度" } = req.body || {};
    const brand = ownedBrand(req, brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    if (!Array.isArray(mediaIds) || !mediaIds.length) return res.status(400).json({ error: "请至少选择一家媒体" });

    const items = mediaIds.map((mid) => db.prepare("SELECT * FROM media WHERE id=?").get(mid)).filter(Boolean);
    if (!items.length) return res.status(400).json({ error: "所选媒体不存在" });

    const total = items.reduce((a, m) => a + m.price, 0);
    const oid = id();
    const t = now();
    db.prepare(
      "INSERT INTO orders (id, brand_id, objective, media_ids, total, status, created_at) VALUES (?,?,?,?,?,?,?)"
    ).run(oid, brand.id, objective, JSON.stringify(items.map((m) => m.id)), total, "pending", t);

    items.forEach((m) => {
      db.prepare(
        "INSERT INTO placements (id, brand_id, order_id, media_id, content_title, url, state, published_at, indexed, cited) VALUES (?,?,?,?,?,?,?,?,?,?)"
      ).run(id(), brand.id, oid, m.id, "（待分配内容）", "", "待发布", "", 0, 0);
    });

    res.status(201).json({
      id: oid,
      total,
      count: items.length,
      status: "pending",
      avgAiw: Math.round(items.reduce((a, m) => a + m.aiw, 0) / items.length),
    });
  })
);

app.patch(
  "/api/orders/:orderId",
  requireAuth,
  wrap((req, res) => {
    const o = db.prepare("SELECT * FROM orders WHERE id=?").get(req.params.orderId);
    if (!o) return res.status(404).json({ error: "订单不存在" });
    if (!ownedBrand(req, o.brand_id)) return res.status(403).json({ error: "无权操作" });

    // 硬约束：只有每条台账都回填了真实链接，订单才能确认发布
    const total = db.prepare("SELECT COUNT(*) c FROM placements WHERE order_id=?").get(o.id).c;
    if (!total) return res.status(400).json({ error: "该订单没有发布台账" });
    const linked = db
      .prepare("SELECT COUNT(*) c FROM placements WHERE order_id=? AND state='已完成' AND url!=''")
      .get(o.id).c;
    if (linked < total) {
      return res.status(400).json({ error: `还有 ${total - linked} 条未回填发布链接，需等运营完成后再确认` });
    }

    db.prepare("UPDATE orders SET status='published' WHERE id=?").run(o.id);
    res.json({ ok: true, status: "published" });
  })
);

app.get(
  "/api/placements",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const rows = db
      .prepare(
        `SELECT p.*, m.name AS media_name, m.aiw AS media_aiw FROM placements p
         LEFT JOIN media m ON m.id = p.media_id
         WHERE p.brand_id=? ORDER BY p.published_at DESC, p.rowid DESC LIMIT 100`
      )
      .all(brand.id);

    // 收录/引用不再用 placements 里的写死值，改由链接台账 + 真实探测结果回填
    const linkMap = new Map(
      db.prepare("SELECT url, status, indexed FROM link_assets WHERE brand_id=?").all(brand.id).map((l) => [l.url, l])
    );
    const cites = citationCounts(db, brand.id);
    const serp = serpHitCounts(db, brand.id);

    res.json(
      rows.map((p) => {
        // 中文域名在台账里已按 URL 规范转成 punycode，回填时要用同样的规范化结果匹配
        const l = linkMap.get(normalizeLink(p.url));
        const h = hostOf(p.url);
        return {
          id: p.id,
          orderId: p.order_id,
          content: p.content_title,
          media: p.media_name || "—",
          mediaAiw: p.media_aiw || 0,
          state: p.state,
          url: p.url,
          publishedAt: p.published_at,
          indexed: l ? l.indexed === 1 : false,
          cited: l ? (cites.real.get(h) || 0) + (serp.get(h) || 0) : 0,
          linkStatus: l ? l.status : "untracked",
        };
      })
    );
  })
);

/* ---------------- 运营工作台（人工代投） ---------------- */

const ORDER_STATE = { pending: "待接单", claimed: "进行中", published: "已发布", cancelled: "已取消" };

function mapOpsOrder(o) {
  const media = JSON.parse(o.media_ids || "[]")
    .map((mid) => db.prepare("SELECT * FROM media WHERE id=?").get(mid))
    .filter(Boolean)
    .map((m) => ({ id: m.id, name: m.name, aiw: m.aiw, price: m.price, cycle: m.cycle }));

  const placements = db
    .prepare("SELECT * FROM placements WHERE order_id=? ORDER BY rowid")
    .all(o.id)
    .map((p) => {
      const m = db.prepare("SELECT name FROM media WHERE id=?").get(p.media_id);
      return {
        id: p.id,
        media: m ? m.name : "—",
        content: p.content_title || "（待分配内容）",
        url: p.url || "",
        state: p.state,
        publishedAt: p.published_at || "",
        note: p.note || "",
        assignee: p.assignee || "",
      };
    });

  return {
    id: o.id,
    status: o.status,
    statusText: ORDER_STATE[o.status] || o.status,
    total: o.total,
    objective: o.objective,
    createdAt: o.created_at,
    assignee: o.assignee || "",
    claimedAt: o.claimed_at || "",
    note: o.note || "",
    brand: { id: o.brand_id, name: o.brand_name, city: o.city },
    ownerPhone: o.owner_phone || "",
    media,
    placements,
    doneCount: placements.filter((p) => p.state === "已完成").length,
    totalCount: placements.length,
  };
}

function opsQuery(where, args) {
  return db
    .prepare(
      `SELECT o.*, b.name AS brand_name, b.city,
              (SELECT phone FROM users WHERE tenant_id = b.tenant_id LIMIT 1) AS owner_phone
       FROM orders o JOIN brands b ON b.id = o.brand_id
       ${where} ORDER BY o.created_at DESC LIMIT 200`
    )
    .all(...args);
}

app.get(
  "/api/ops/orders",
  requireAuth,
  requireOps,
  wrap((req, res) => {
    const status = String(req.query.status || "all");
    const rows = status === "all" ? opsQuery("", []) : opsQuery("WHERE o.status=?", [status]);
    res.json(rows.map(mapOpsOrder));
  })
);

app.get(
  "/api/ops/stats",
  requireAuth,
  requireOps,
  wrap((_req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    res.json({
      pending: db.prepare("SELECT COUNT(*) c FROM orders WHERE status='pending'").get().c,
      claimed: db.prepare("SELECT COUNT(*) c FROM orders WHERE status='claimed'").get().c,
      publishedToday: db
        .prepare("SELECT COUNT(*) c FROM placements WHERE state='已完成' AND published_at=?")
        .get(today).c,
      amount: db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE status!='cancelled'").get().s,
      clients: db.prepare("SELECT COUNT(DISTINCT tenant_id) c FROM brands").get().c,
    });
  })
);

app.post(
  "/api/ops/orders/:orderId/claim",
  requireAuth,
  requireOps,
  wrap((req, res) => {
    const o = db.prepare("SELECT * FROM orders WHERE id=?").get(req.params.orderId);
    if (!o) return res.status(404).json({ error: "订单不存在" });
    if (o.status !== "pending") return res.status(400).json({ error: `该订单当前为「${ORDER_STATE[o.status] || o.status}」，无法接单` });
    const who = req.user.name || req.user.phone;
    db.prepare("UPDATE orders SET status='claimed', assignee=?, claimed_at=? WHERE id=?").run(who, now(), o.id);
    db.prepare("UPDATE placements SET assignee=? WHERE order_id=? AND assignee=''").run(who, o.id);
    res.json({ ok: true, status: "claimed", assignee: who });
  })
);

/** 回填发布链接：逐条完成后订单自动转为已发布 */
app.post(
  "/api/ops/placements/:placementId/publish",
  requireAuth,
  requireOps,
  wrap((req, res) => {
    const p = db.prepare("SELECT * FROM placements WHERE id=?").get(req.params.placementId);
    if (!p) return res.status(404).json({ error: "台账项不存在" });
    const { url, publishedAt = "", contentTitle = "" } = req.body || {};
    if (!url || !/^https?:\/\//i.test(String(url))) {
      return res.status(400).json({ error: "请填写合法的发布链接（需以 http:// 或 https:// 开头）" });
    }

    const o = db.prepare("SELECT * FROM orders WHERE id=?").get(p.order_id);
    if (!o) return res.status(404).json({ error: "订单不存在" });
    if (o.status === "cancelled") return res.status(400).json({ error: "订单已取消，不能回填" });

    const t = now();
    db.prepare(
      `UPDATE placements
       SET url=?, state='已完成', published_at=?, content_title=COALESCE(NULLIF(?,''), content_title),
           assignee=?, link_verified_at=?
       WHERE id=?`
    ).run(String(url), publishedAt || t.slice(0, 10), String(contentTitle), req.user.name || req.user.phone, t, p.id);

    const remaining = db.prepare("SELECT COUNT(*) c FROM placements WHERE order_id=? AND state!='已完成'").get(o.id).c;
    if (remaining === 0) db.prepare("UPDATE orders SET status='published' WHERE id=?").run(o.id);
    else if (o.status === "pending") db.prepare("UPDATE orders SET status='claimed', assignee=? WHERE id=?").run(req.user.name || req.user.phone, o.id);

    res.json({ ok: true, remaining, orderStatus: remaining === 0 ? "published" : "claimed" });
  })
);

app.post(
  "/api/ops/placements/:placementId/reject",
  requireAuth,
  requireOps,
  wrap((req, res) => {
    const p = db.prepare("SELECT * FROM placements WHERE id=?").get(req.params.placementId);
    if (!p) return res.status(404).json({ error: "台账项不存在" });
    const note = String(req.body?.note || "媒体退回，待重新安排");
    db.prepare("UPDATE placements SET state='被退回', note=?, assignee=? WHERE id=?").run(
      note, req.user.name || req.user.phone, p.id
    );
    db.prepare("UPDATE orders SET note=? WHERE id=? AND status='pending'").run(note, p.order_id);
    res.json({ ok: true, state: "被退回", note });
  })
);

/**
 * AI 生成提问（两段式）：
 * ① 先从品牌资料里选关键词 → ② 再基于关键词造问题 → ③ 确定性质检，不合格剔除并重试一次
 * 关键词与质检结果一并返回，便于人工复核「问题是不是问在点上」。
 */
app.post(
  "/api/prompts/agent",
  requireAuth,
  requireLevel("editor"),
  async (req, res) => {
    try {
      const brand = ownedBrand(req, req.body?.brandId);
      if (!brand) return res.status(404).json({ error: "品牌不存在" });

      const st = agentStatus();
      if (!st.available) return res.status(503).json({ error: st.hint });

      const docs = kbDocsOf(brand.id);
      const facts = db.prepare("SELECT * FROM facts WHERE brand_id=? AND status='active'").all(brand.id);
      if (!docs.length && !facts.length) {
        return res.status(400).json({ error: "既没有知识库文档也没有事实卡，先补资料再生成提问" });
      }

      const competitors = db.prepare("SELECT * FROM competitors WHERE brand_id=?").all(brand.id);
      const localService = isLocalService(brand, facts);
      const corpus = docs
        .map((d) => `### ${d.name}\n${d.text.slice(0, 2500)}`)
        .join("\n\n")
        .slice(0, 10000);

      /* ① 选关键词 */
      const kwOut = await runAgent({
        brandId: brand.id,
        prompt: keywordPrompt({ brand, facts, corpus, competitors }),
        timeoutMs: 120000,
        system: "你是 GEO 关键词分析助手。只输出 JSON，不要解释，不要 markdown 代码块。",
      });
      if (!kwOut.ok) return res.status(422).json({ error: kwOut.error || "关键词生成失败" });

      const kwJson = parseJsonLoose(kwOut.text);
      const kwAudit = auditKeywords(kwJson?.keywords, { brandName: brand.name });
      if (!kwAudit.accepted.length) {
        return res.status(422).json({
          error: "模型没有产出可用的关键词",
          raw: String(kwOut.text || "").slice(0, 300),
        });
      }

      /* ② 基于关键词造问题 */
      const perKeyword = Math.min(3, Math.max(1, Number(req.body?.perKeyword) || 2));
      const basePrompt = questionPrompt({ brand, keywords: kwAudit.accepted, perKeyword, local: localService });
      const existing = db
        .prepare("SELECT text FROM prompts WHERE brand_id=?")
        .all(brand.id)
        .map((r) => r.text);

      let qOut = await runAgent({
        brandId: brand.id,
        prompt: basePrompt,
        timeoutMs: 180000,
        system: "你是 GEO 提问设计助手。只输出 JSON 数组，不要解释，不要 markdown 代码块。",
      });
      if (!qOut.ok) return res.status(422).json({ error: qOut.error || "提问生成失败" });

      let items = parseJsonLoose(qOut.text);
      let audit = auditPrompts(items, {
        brandName: brand.name,
        localService,
        existing,
        limit: 40,
      });

      /* ③ 通过率过低时，带着拒绝原因重试一次 */
      const retried = audit.stats.accepted < Math.min(16, Math.round((audit.stats.total || 0) * 0.6));
      if (retried && audit.rejected.length) {
        const retryPrompt = `${basePrompt}\n\n上一轮以下问题不合格，请避免同类问题：\n${audit.rejected
          .slice(0, 8)
          .map((r) => `- ${r.text || "（空）"}（${r.reason}）`)
          .join("\n")}`;
        const qOut2 = await runAgent({
          brandId: brand.id,
          prompt: retryPrompt,
          timeoutMs: 180000,
          system: "你是 GEO 提问设计助手。只输出 JSON 数组，不要解释，不要 markdown 代码块。",
        });
        if (qOut2.ok) {
          const items2 = parseJsonLoose(qOut2.text);
          const audit2 = auditPrompts(items2, {
            brandName: brand.name,
            localService,
            existing: [...existing, ...audit.accepted.map((x) => x.text)],
            limit: 40 - audit.accepted.length,
          });
          audit = {
            accepted: [...audit.accepted, ...audit2.accepted],
            rejected: [...audit.rejected, ...audit2.rejected],
            stats: {
              ...audit.stats,
              accepted: audit.accepted.length + audit2.accepted.length,
              rejected: audit.rejected.length + audit2.rejected.length,
              total: (audit.stats.total || 0) + (audit2.stats.total || 0),
            },
          };
        }
      }

      if (!audit.accepted.length) {
        return res.status(422).json({
          error: "生成的问题全部未通过质检",
          keywords: kwAudit.accepted,
          rejected: audit.rejected.slice(0, 10),
        });
      }

      /* ④ 落库（replace=true 时清空该品牌旧提问与旧探测） */
      const replace = Boolean(req.body?.replace);
      const t = now();
      db.exec("BEGIN");
      try {
        if (replace) {
          db.prepare("DELETE FROM probe_results WHERE brand_id=?").run(brand.id);
          db.prepare("DELETE FROM probe_runs WHERE brand_id=?").run(brand.id);
          db.prepare("DELETE FROM prompts WHERE brand_id=?").run(brand.id);
        }
        const ins = db.prepare(
          "INSERT INTO prompts (id, brand_id, text, intent, weight, created_at) VALUES (?,?,?,?,?,?)"
        );
        for (const p of audit.accepted) ins.run(id(), brand.id, p.text, p.intent, p.weight, t);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }

      const intentCount = {};
      for (const p of audit.accepted) intentCount[p.intent] = (intentCount[p.intent] || 0) + 1;

      res.json({
        ok: true,
        added: audit.accepted.length,
        replaced: replace,
        keywords: kwAudit.accepted,
        keywordRejected: kwAudit.rejected.slice(0, 5),
        stats: { ...audit.stats, intents: intentCount },
        rejected: audit.rejected.slice(0, 10),
        retried,
        localService,
        fromDocs: docs.length,
        fromFacts: facts.length,
        preview: audit.accepted.slice(0, 10),
      });
    } catch (e) {
      console.error("[prompts/agent]", e);
      res.status(500).json({ error: String(e.message || e) });
    }
  }
);

/* ---------------- 产品库（SKU 明细） ---------------- */

const mapProduct = (p) => ({
  id: p.id,
  name: p.name,
  category: p.category,
  price: p.price,
  unit: p.unit,
  specs: p.specs,
  sellingPoints: p.selling_points,
  applicable: p.applicable,
  status: p.status,
  createdAt: p.created_at,
});

/** SKU 价格与事实卡价格区间比对：产品库只是明细展开，口径仍以事实卡为准
 *  注意：价格类事实卡可能有多条（如 Pro/Team 两个档位），必须合并所有数字取整体区间，
 *  否则只取第一条会把其他档位误判为超区间。 */
function checkPriceAgainstFacts(productPrice, facts) {
  const priceFacts = (facts || []).filter((f) => f.status === "active" && f.attr.includes("价格"));
  if (!priceFacts.length) return { level: "unknown", note: "事实卡里还没有价格区间，无法校验" };

  const factNums = priceFacts.flatMap((f) => (String(f.value).match(/\d+(?:\.\d+)?/g) || []).map(Number));
  const nums = (String(productPrice || "").match(/\d+(?:\.\d+)?/g) || []).map(Number);
  if (!nums.length || !factNums.length) return { level: "unknown", note: "" };

  const lo = Math.min(...factNums);
  const hi = Math.max(...factNums);
  const out = nums.filter((n) => n < lo || n > hi);
  if (out.length) {
    return { level: "warn", note: `价格 ${out.join("/")} 超出事实卡区间 ${lo}–${hi}` };
  }
  return { level: "ok", note: "" };
}

app.get(
  "/api/products",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });

    const rows = db.prepare("SELECT * FROM products WHERE brand_id=? ORDER BY created_at").all(brand.id);
    const facts = db.prepare("SELECT * FROM facts WHERE brand_id=?").all(brand.id);
    res.json(rows.map((p) => ({ ...mapProduct(p), priceCheck: checkPriceAgainstFacts(p.price, facts) })));
  })
);

app.post(
  "/api/products",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const { brandId, name, category = "", price = "", unit = "", specs = "", sellingPoints = "", applicable = "" } = req.body || {};
    const brand = ownedBrand(req, brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    if (!String(name || "").trim()) return res.status(400).json({ error: "产品名称必填" });

    const dupe = db.prepare("SELECT id FROM products WHERE brand_id=? AND name=?").get(brand.id, String(name).trim());
    if (dupe) return res.status(409).json({ error: "同名产品已存在" });

    const t = now();
    const pid = id();
    db.prepare(
      `INSERT INTO products (id, brand_id, name, category, price, unit, specs, selling_points, applicable, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,'active',?,?)`
    ).run(pid, brand.id, String(name).trim(), category, price, unit, specs, sellingPoints, applicable, t, t);

    const p = db.prepare("SELECT * FROM products WHERE id=?").get(pid);
    const facts = db.prepare("SELECT * FROM facts WHERE brand_id=?").all(brand.id);
    res.status(201).json({ ...mapProduct(p), priceCheck: checkPriceAgainstFacts(p.price, facts) });
  })
);

app.patch(
  "/api/products/:productId",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const p = db.prepare("SELECT * FROM products WHERE id=?").get(req.params.productId);
    if (!p) return res.status(404).json({ error: "产品不存在" });
    if (!ownedBrand(req, p.brand_id)) return res.status(403).json({ error: "无权操作" });

    const f = req.body || {};
    db.prepare(
      `UPDATE products SET name=?, category=?, price=?, unit=?, specs=?, selling_points=?, applicable=?, status=?, updated_at=? WHERE id=?`
    ).run(
      String(f.name ?? p.name).trim(),
      f.category ?? p.category,
      f.price ?? p.price,
      f.unit ?? p.unit,
      f.specs ?? p.specs,
      f.sellingPoints ?? p.selling_points,
      f.applicable ?? p.applicable,
      f.status ?? p.status,
      now(),
      p.id
    );

    const updated = db.prepare("SELECT * FROM products WHERE id=?").get(p.id);
    const facts = db.prepare("SELECT * FROM facts WHERE brand_id=?").all(p.brand_id);
    res.json({ ...mapProduct(updated), priceCheck: checkPriceAgainstFacts(updated.price, facts) });
  })
);

app.delete(
  "/api/products/:productId",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const p = db.prepare("SELECT * FROM products WHERE id=?").get(req.params.productId);
    if (!p) return res.status(404).json({ error: "产品不存在" });
    if (!ownedBrand(req, p.brand_id)) return res.status(403).json({ error: "无权操作" });
    db.prepare("DELETE FROM products WHERE id=?").run(p.id);
    res.json({ ok: true });
  })
);

/* ---------------- 产品库：AI 自动提取（读知识库文档 → 抽产品/套餐） ---------------- */

app.post(
  "/api/products/agent",
  requireAuth,
  requireLevel("editor"),
  async (req, res) => {
    try {
      const brand = ownedBrand(req, req.body?.brandId);
      if (!brand) return res.status(404).json({ error: "品牌不存在" });

      const st = agentStatus();
      if (!st.available) return res.status(503).json({ error: st.hint });

      const docs = kbDocsOf(brand.id);
      if (!docs.length) return res.status(400).json({ error: "知识库里还没有文档，先上传资料再自动提取" });

      const existCount = db.prepare("SELECT COUNT(*) c FROM products WHERE brand_id=? AND status!='hidden'").get(brand.id).c;
      if (existCount > 0 && !req.body?.force) {
        return res.status(409).json({
          error: `该品牌已有 ${existCount} 个产品。AI 提取适合初次建库，重复执行会产生同义条目。`,
          existing: existCount,
          needForce: true,
        });
      }

      const corpus = docs
        .map((d) => `### ${d.name}\n${d.text.slice(0, 3500)}`)
        .join("\n\n")
        .slice(0, 12000);

      const prompt = `你是产品资料整理助手。下面是企业提供的资料原文，请抽取“可售卖的产品 / 服务 / 套餐”，输出 JSON 数组。

每条字段：
- name：产品名称（必填，用原文的叫法）
- category：类目（如 整装 / 翻新 / 局改 / 单项 / 订阅套餐；没写就留空）
- price：价格原文（保留区间与单位，如 "980–1350 元/㎡"、"¥29/月"；资料里没有价格就留空字符串）
- applicable：适用场景 / 面积 / 对象（没写就留空）
- sellingPoints：一句卖点（只能来自原文，没写就留空）
- specs：包含项，用 "\\n" 分隔的字符串（没写就留空）

铁律：
1. 只抽资料里明确存在的产品，禁止编造、合并或猜测。
2. 价格必须照抄原文，不得换算、不得估算、不得相加。
3. 报价单里的单项（如“拆墙清运 70元/㎡”）也算产品，category 填“单项”。
4. **不要把品牌本身、公司介绍或产品定位当成产品条目**（例如“XX 零代码平台”是公司，不是可售 SKU）。
5. 同一名称只输出一条。
6. 最多 15 条，按重要性排序。
7. 只输出 JSON 数组，不要 markdown 代码块，不要任何解释文字。

格式示例：
[{"name":"老房翻新全包","category":"翻新","price":"1180–1350 元/㎡","applicable":"房龄 15 年以上","sellingPoints":"增项 500 元以上需书面确认","specs":"拆改加固\\n水电全改"}]

资料开始
${corpus}
资料结束`;

      const out = await runAgent({ brandId: brand.id, prompt, timeoutMs: 180000 });
      if (!out.ok) return res.status(422).json({ error: out.error || "AI 提取失败" });

      const raw = String(out.text || "")
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();

      let items = null;
      try {
        items = JSON.parse(raw);
      } catch {
        const m = raw.match(/\[[\s\S]*\]/);
        if (m) {
          try {
            items = JSON.parse(m[0]);
          } catch {
            items = null;
          }
        }
      }
      if (!Array.isArray(items)) {
        return res.status(422).json({ error: "模型没有返回合法 JSON，请重试", raw: raw.slice(0, 300) });
      }

      const facts = db.prepare("SELECT * FROM facts WHERE brand_id=?").all(brand.id);
      const t = now();
      let added = 0;
      let skipped = 0;
      let warned = 0;
      const preview = [];

      for (const it of items.slice(0, 20)) {
        const name = String(it?.name || "").trim().slice(0, 60);
        if (!name) {
          skipped++;
          continue;
        }
        const dupe = db.prepare("SELECT id FROM products WHERE brand_id=? AND name=?").get(brand.id, name);
        if (dupe) {
          skipped++;
          continue;
        }

        const price = String(it?.price || "").trim().slice(0, 80);
        const check = checkPriceAgainstFacts(price, facts);
        if (check.level === "warn") warned++;

        const pid = id();
        db.prepare(
          `INSERT INTO products (id, brand_id, name, category, price, unit, specs, selling_points, applicable, status, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,'active',?,?)`
        ).run(
          pid, brand.id, name,
          String(it?.category || "").trim().slice(0, 30),
          price, "",
          String(it?.specs || "").trim().slice(0, 600),
          String(it?.sellingPoints || "").trim().slice(0, 300),
          String(it?.applicable || "").trim().slice(0, 120),
          t, t
        );
        added++;
        preview.push({ name, price, check: check.level });
      }

      res.json({
        ok: true,
        added,
        skipped,
        warned,
        total: items.length,
        docCount: docs.length,
        preview: preview.slice(0, 10),
      });
    } catch (e) {
      console.error("[products/agent]", e);
      res.status(500).json({ error: String(e.message || e) });
    }
  }
);

/* ---------------- 知识库：文档上传与检索 ---------------- */

const here = dirname(fileURLToPath(import.meta.url));
const uploadDir = join(here, "data", "uploads");
mkdirSync(uploadDir, { recursive: true });

/** multer 的 originalname 常为 latin1，中文会乱码，先尝试修正 */
function decodeName(name) {
  try {
    const fixed = Buffer.from(name, "latin1").toString("utf8");
    return fixed.includes("\ufffd") ? name : fixed;
  } catch {
    return name;
  }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extname(decodeName(file.originalname))}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const nm = decodeName(file.originalname);
    if (!isSupported(nm)) {
      return cb(new Error(`不支持的文件类型（支持 ${SUPPORTED.join(" / ")}）`));
    }
    cb(null, true);
  },
});

const mapDoc = (d) => ({
  id: d.id,
  name: d.name,
  ext: d.ext,
  size: d.size,
  status: d.status,
  pages: d.pages,
  chunks: d.chunks,
  chars: d.chars,
  error: d.error,
  createdAt: d.created_at,
});

app.get(
  "/api/kb/documents",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const rows = db.prepare("SELECT * FROM kb_documents WHERE brand_id=? ORDER BY created_at DESC").all(brand.id);
    res.json(rows.map(mapDoc));
  })
);

app.post(
  "/api/kb/documents",
  requireAuth,
  requireLevel("editor"),
  upload.single("file"),
  wrap(async (req, res) => {
    const brand = ownedBrand(req, req.query.brandId || req.body.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    if (!req.file) return res.status(400).json({ error: "请选择要上传的文件" });

    const name = decodeName(req.file.originalname);
    const ext = extOf(name);
    const buf = await readFile(req.file.path);
    const sha = createHash("sha256").update(buf).digest("hex");

    const dup = db
      .prepare("SELECT id, name FROM kb_documents WHERE brand_id=? AND sha256=? AND status='ready'")
      .get(brand.id, sha);
    if (dup) return res.status(409).json({ error: `该文件已上传过：《${dup.name}》` });

    const docId = id();
    const t = now();
    db.prepare(
      `INSERT INTO kb_documents (id, brand_id, name, ext, size, sha256, path, status, uploaded_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(docId, brand.id, name, ext, req.file.size, sha, req.file.path, "processing", req.user.name || req.user.phone, t);

    try {
      const out = await extractDocument(req.file.path, name);
      const chunks = chunkPages(out.pages);
      const ins = db.prepare(
        `INSERT INTO kb_chunks (id, doc_id, brand_id, seq, page, title_path, text, chars, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      );
      chunks.forEach((c) => ins.run(id(), docId, brand.id, c.seq, c.page, c.titlePath, c.text, c.chars, t));

      const status = out.meta.image ? "image" : chunks.length ? "ready" : "empty";
      db.prepare("UPDATE kb_documents SET status=?, pages=?, chunks=?, chars=?, error=? WHERE id=?").run(
        status, out.meta.pages, chunks.length, out.meta.chars, out.meta.warning || "", docId
      );
      kbSearch.invalidate(brand.id);

      res.status(201).json({
        id: docId,
        name,
        ext,
        status,
        pages: out.meta.pages,
        chunks: chunks.length,
        chars: out.meta.chars,
        ms: out.meta.ms,
        warning: out.meta.warning,
      });
    } catch (e) {
      db.prepare("UPDATE kb_documents SET status='failed', error=? WHERE id=?").run(
        String(e.message || e).slice(0, 300), docId
      );
      res.status(422).json({ error: `解析失败：${e.message}`, id: docId });
    }
  })
);

/** 图库文件读取（文件名不可猜，公开可读以便正文 <img> 加载） */
app.get("/api/kb/files/:docId", (req, res) => {
  const d = db.prepare("SELECT * FROM kb_documents WHERE id=?").get(req.params.docId);
  if (!d || !d.path || !existsSync(d.path)) return res.status(404).end();
  const types = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
  const ct = types[d.ext];
  if (!ct) return res.status(400).end();
  res.setHeader("Content-Type", ct);
  res.setHeader("Cache-Control", "public, max-age=604800");
  res.sendFile(d.path);
});

app.get(
  "/api/kb/documents/:docId/chunks",
  requireAuth,
  wrap((req, res) => {
    const d = db.prepare("SELECT * FROM kb_documents WHERE id=?").get(req.params.docId);
    if (!d) return res.status(404).json({ error: "文档不存在" });
    if (!ownedBrand(req, d.brand_id)) return res.status(403).json({ error: "无权访问" });
    const limit = Math.min(500, Number(req.query.limit) || 100);
    const rows = db.prepare("SELECT * FROM kb_chunks WHERE doc_id=? ORDER BY seq LIMIT ?").all(d.id, limit);
    res.json({
      document: mapDoc(d),
      chunks: rows.map((c) => ({ id: c.id, seq: c.seq, page: c.page, titlePath: c.title_path, chars: c.chars, text: c.text })),
    });
  })
);

app.delete(
  "/api/kb/documents/:docId",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const d = db.prepare("SELECT * FROM kb_documents WHERE id=?").get(req.params.docId);
    if (!d) return res.status(404).json({ error: "文档不存在" });
    if (!ownedBrand(req, d.brand_id)) return res.status(403).json({ error: "无权操作" });

    db.prepare("DELETE FROM kb_chunks WHERE doc_id=?").run(d.id);
    db.prepare("DELETE FROM kb_documents WHERE id=?").run(d.id);
    if (d.path && existsSync(d.path)) {
      try {
        unlinkSync(d.path);
      } catch {
        /* 文件已不在，忽略 */
      }
    }
    kbSearch.invalidate(d.brand_id);
    res.json({ ok: true });
  })
);

/** 检索调试：返回原文片段与打分，用于判断切片质量 */
app.post(
  "/api/kb/search",
  requireAuth,
  wrap((req, res) => {
    const { brandId, query, topK = 8 } = req.body || {};
    const brand = ownedBrand(req, brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    if (!String(query || "").trim()) return res.status(400).json({ error: "请输入检索内容" });

    const out = kbSearch.search(brand.id, String(query), { topK: Math.min(20, Number(topK) || 8) });
    const names = new Map();
    const hits = out.hits.map((h) => {
      if (!names.has(h.docId)) {
        const r = db.prepare("SELECT name FROM kb_documents WHERE id=?").get(h.docId);
        names.set(h.docId, r ? r.name : "—");
      }
      return { ...h, docName: names.get(h.docId) };
    });
    res.json({ hits, matched: out.total, indexSize: out.indexSize });
  })
);

app.get(
  "/api/kb/stats",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const d = db
      .prepare(
        "SELECT COUNT(*) n, SUM(CASE WHEN status='ready' THEN 1 ELSE 0 END) ready, COALESCE(SUM(chars),0) chars FROM kb_documents WHERE brand_id=?"
      )
      .get(brand.id);
    const c = db.prepare("SELECT COUNT(*) n FROM kb_chunks WHERE brand_id=?").get(brand.id);
    res.json({ documents: d.n, ready: d.ready || 0, chars: d.chars, chunks: c.n });
  })
);

/* ---------------- 内容（模板生成，可接 LLM） ---------------- */

app.get(
  "/api/contents",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const rows = db.prepare("SELECT * FROM contents WHERE brand_id=? ORDER BY created_at DESC").all(brand.id);
    res.json(
      rows.map((c) => ({
        id: c.id, title: c.title, genre: c.genre, geos: c.geos, status: c.status, body: c.body, createdAt: c.created_at,
      }))
    );
  })
);

function buildContent(brand, ctx, prompt, genre) {
  // 模板通道也用企业自己上传的资料要点，而不是纯填空
  let snippets = [];
  try {
    const hits = kbSearch.buildContext(brand.id, prompt?.text || `${brand.name} ${brand.intro || ""}`, 4).hits || [];
    snippets = hits.map((h) => ({ text: h.text, docName: h.docName || "" }));
  } catch {
    snippets = [];
  }
  const { title, body } = renderArticle({ brand, ctx, prompt, genre, snippets });
  const hasConflict = ctx.facts.some((f) => f.status === "conflict");
  const { geos, dims } = scoreContent(body, hasConflict ? 6 : 10);
  const fc = checkFacts(body, { facts: ctx.facts, storeCount: ctx.storeCount });
  const cp = checkCompliance(body, brand.industry || "");
  const compliance = [...cp.blocked, ...cp.warnings];
  const cid = id();
  const t = now();
  db.prepare(
    `INSERT INTO contents (id, brand_id, title, genre, body, geos, status, created_at, fact_issues, compliance)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    cid, brand.id, title, genre, body, geos, "draft", t,
    JSON.stringify(fc.issues), JSON.stringify(compliance)
  );
  return {
    id: cid, title, genre, geos, dims, status: "draft", body, createdAt: t,
    factIssues: fc.issues, compliance,
  };
}

app.post(
  "/api/contents/generate",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const { brandId, promptId, promptIds, genre = "攻略", count = 1 } = req.body || {};
    const brand = ownedBrand(req, brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });

    const ctx = loadContext(brand.id);
    const pickPrompt = (pid) => db.prepare("SELECT * FROM prompts WHERE id=? AND brand_id=?").get(pid, brand.id);

    let targets = [];
    if (Array.isArray(promptIds) && promptIds.length) {
      targets = promptIds.map(pickPrompt).filter(Boolean);
    } else if (promptId) {
      const p = pickPrompt(promptId);
      if (p) targets = [p];
    } else {
      const all = db.prepare("SELECT * FROM prompts WHERE brand_id=? ORDER BY weight DESC, created_at").all(brand.id);
      const n = Math.max(1, Math.min(10, Number(count) || 1));
      const usedTitles = db.prepare("SELECT title FROM contents WHERE brand_id=?").all(brand.id).map((r) => r.title);
      const fresh = all.filter(
        (p) => !usedTitles.some((t) => t.includes(p.text.replace(/[？?]$/, "").slice(0, 10)))
      );
      targets = (fresh.length ? fresh : all).slice(0, n);
    }

    if (!targets.length) return res.status(400).json({ error: "没有可用的问题，请先生成提问矩阵" });
    const items = targets.map((p) => buildContent(brand, ctx, p, genre));
    res.status(201).json({ items, count: items.length });
  })
);

app.get(
  "/api/contents/:contentId",
  requireAuth,
  wrap((req, res) => {
    const c = db.prepare("SELECT * FROM contents WHERE id=?").get(req.params.contentId);
    if (!c) return res.status(404).json({ error: "内容不存在" });
    if (!ownedBrand(req, c.brand_id)) return res.status(403).json({ error: "无权访问" });
    // 详情重算，保证「六维之和 = 总分」；口径一致按是否仍有冲突降分
    const facts = db.prepare("SELECT status FROM facts WHERE brand_id=?").all(c.brand_id);
    const hasConflict = facts.some((f) => f.status === "conflict");
    const { geos, dims } = scoreContent(c.body, hasConflict ? 6 : 10);
    if (geos !== c.geos) db.prepare("UPDATE contents SET geos=? WHERE id=?").run(geos, c.id);
    res.json({
      id: c.id,
      title: c.title,
      genre: c.genre,
      geos,
      status: c.status,
      body: c.body,
      createdAt: c.created_at,
      dims,
    });
  })
);

app.patch(
  "/api/contents/:contentId",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const c = db.prepare("SELECT * FROM contents WHERE id=?").get(req.params.contentId);
    if (!c) return res.status(404).json({ error: "内容不存在" });
    if (!ownedBrand(req, c.brand_id)) return res.status(403).json({ error: "无权操作" });
    const status = req.body?.status || c.status;

    // 发布硬拦截：存在禁用词时不允许发布
    if (status === "published") {
      let hits = [];
      try {
        hits = JSON.parse(c.compliance || "[]");
      } catch {
        hits = [];
      }
      const blocked = hits.filter((h) => h.level === "block");
      if (blocked.length) {
        return res.status(400).json({
          error: `还有 ${blocked.length} 处禁用词未修改（如「${blocked[0].word}」），改完才能发布`,
          blocked: blocked.slice(0, 8),
        });
      }
    }

    db.prepare("UPDATE contents SET status=? WHERE id=?").run(status, c.id);
    res.json({ ok: true, status });
  })
);

/* ---------------- 内容：智能体生成（SSE 流式） ---------------- */

app.get("/api/agent/status", requireAuth, (_req, res) => {
  res.json(agentStatus());
});

/** 配图：文件名即可寻址（内容不可猜，公开可读以便 <img> 加载） */
app.get("/api/figures/:name", (req, res) => {
  const name = String(req.params.name || "");
  if (!/^[a-f0-9]{24}\.svg$/.test(name)) return res.status(400).end();
  const file = join(here, "data", "figures", name);
  if (!existsSync(file)) return res.status(404).end();
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.sendFile(file);
});

app.post(
  "/api/contents/agent",
  requireAuth,
  requireLevel("editor"),
  async (req, res) => {
    const { brandId, promptId, genre = "攻略" } = req.body || {};
    try {
      const brand = ownedBrand(req, brandId);
      if (!brand) return res.status(404).json({ error: "品牌不存在" });

      const st = agentStatus();
      if (!st.available) return res.status(503).json({ error: st.hint });

      // SSE
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const send = (ev) => {
        try {
          res.write(`data: ${JSON.stringify(ev)}\n\n`);
        } catch {
          /* 客户端已断开 */
        }
      };

      const ctx = loadContext(brand.id);
      const facts = ctx.facts.filter((f) => f.status === "active");
      const p = promptId
        ? db.prepare("SELECT * FROM prompts WHERE id=? AND brand_id=?").get(promptId, brand.id)
        : null;

      let snippets = [];
      try {
        const ctxHits = kbSearch.buildContext(brand.id, p ? p.text : `${brand.name} ${brand.intro || ""}`, 4);
        snippets = ctxHits.hits || [];
      } catch {
        snippets = [];
      }

      send({ type: "stage", content: `已就绪：事实卡 ${facts.length} 条 · 参考原文 ${snippets.length} 段` });
      if (!facts.length) send({ type: "warn", content: "没有生效事实卡，正文中不会出现价格等具体数字" });

      // 企业自有图库（可被智能体在正文引用）
      const images = db
        .prepare("SELECT id, name FROM kb_documents WHERE brand_id=? AND status='image' ORDER BY created_at DESC LIMIT 20")
        .all(brand.id)
        .map((i) => ({ name: i.name, url: `/api/kb/files/${i.id}` }));
      if (images.length) send({ type: "stage", content: `图库可用：${images.length} 张自有图片` });

      const promptText = buildPrompt({
        brand,
        facts,
        snippets,
        images,
        promptText: p ? p.text : "",
        genre,
        storeCount: ctx.storeCount,
        intent: p?.intent || "",
      });

      const out = await runAgent({
        brandId: brand.id,
        prompt: promptText,
        timeoutMs: 180000,
        system: articleSystemPrompt(),
        onEvent: (e) => send(e),
      });

      if (out.ok) {
        const hasConflict = ctx.facts.some((f) => f.status === "conflict");

        // ① 事实回比：抽出没有出处的数字（不阻断，但必须让人看见）
        const fc = checkFacts(out.text, { facts: ctx.facts, storeCount: ctx.storeCount });
        if (fc.issues.length) {
          send({ type: "facts", issues: fc.issues.slice(0, 8), checked: fc.checked });
        }

        // ② 数据图：把事实画出来，插到对应小节
        const competitors = db.prepare("SELECT * FROM competitors WHERE brand_id=?").all(brand.id);
        const figs = buildFigures({ brand, facts: ctx.facts, competitors });
        const injected = injectFigures(out.text, figs);
        if (figs.length) {
          send({ type: "figures", count: figs.length, inserted: injected.inserted.length });
        }

        const { geos, dims } = scoreContent(injected.body, hasConflict ? 6 : 10);

        // ③ 合规：绝对化用语与行业禁用语（block 会阻断发布）
        const cp = checkCompliance(injected.body, brand.industry || "");
        if (cp.total) {
          send({ type: "compliance", blocked: cp.blocked.slice(0, 8), warnings: cp.warnings.slice(0, 8), summary: cp.summary });
        }

        const firstLine = injected.body.split("\n").find((l) => l.trim()) || "未命名内容";
        const title = firstLine.replace(/^#+\s*/, "").trim().slice(0, 80);
        const cid = id();
        const t = now();
        db.prepare(
          `INSERT INTO contents (id, brand_id, title, genre, body, geos, status, created_at, fact_issues, figures, agent, compliance)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
        ).run(
          cid, brand.id, title, genre, injected.body, geos, "draft", t,
          JSON.stringify(fc.issues), JSON.stringify(figs.map((f) => ({ type: f.type, url: f.url }))), "pi",
          JSON.stringify([...cp.blocked, ...cp.warnings])
        );

        send({
          type: "saved",
          contentId: cid,
          title,
          geos,
          dims,
          chars: injected.body.length,
          body: injected.body,
          usage: out.usage,
          factIssues: fc.issues.length,
          figures: figs.length,
          complianceBlocked: cp.blocked.length,
          complianceWarnings: cp.warnings.length,
        });
      }

      res.end();
    } catch (e) {
      console.error("[agent]", e);
      if (res.headersSent) {
        try {
          res.write(`data: ${JSON.stringify({ type: "error", content: String(e.message || e) })}\n\n`);
          res.end();
        } catch {
          /* ignore */
        }
      } else {
        res.status(500).json({ error: String(e.message || e) });
      }
    }
  }
);

/** 导出图文 HTML（单文件，图片内联，可直接粘到公众号/门户） */
app.get(
  "/api/contents/:contentId/export.html",
  requireAuth,
  wrap(async (req, res) => {
    const c = db.prepare("SELECT * FROM contents WHERE id=?").get(req.params.contentId);
    if (!c) return res.status(404).json({ error: "内容不存在" });
    if (!ownedBrand(req, c.brand_id)) return res.status(403).json({ error: "无权操作" });

    const brand = db.prepare("SELECT * FROM brands WHERE id=?").get(c.brand_id);
    let comp = [];
    try {
      comp = JSON.parse(c.compliance || "[]");
    } catch {
      comp = [];
    }

    const wantPng = String(req.query.format || "").toLowerCase() === "png";
    const html = await renderHtml({
      title: c.title,
      brandName: brand ? brand.name : "",
      body: c.body || "",
      resolveImage: makeImageResolver({
        figuresDir: join(here, "data", "figures"),
        kbLookup: (id) => db.prepare("SELECT * FROM kb_documents WHERE id=?").get(id),
        png: wantPng,
      }),
      flags: { complianceBlocked: comp.filter((h) => h.level === "block").length },
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  })
);

/* ---------------- 监测复盘 ---------------- */

app.get(
  "/api/monitor",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const days = Math.min(180, Math.max(7, Number(req.query.days) || 30));
    const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    const rows = db
      .prepare("SELECT * FROM metrics_daily WHERE brand_id=? AND date>=? ORDER BY date")
      .all(brand.id, from);

    const trend = rows.map((m) => ({
      date: m.date,
      avi: m.avi,
      // 样本为 0 的字段一律给 null，避免图上画出“假的 0”
      aviModel: (m.samples ?? 0) > 0 ? m.avi_model : null,
      aviCend: (m.cend_samples ?? 0) > 0 ? m.avi_cend : null,
      samples: m.samples ?? 0,
      cendSamples: m.cend_samples ?? 0,
    }));

    // “有数据”的判定：有样本，或至少有非零主口径值（历史基线没有 samples 字段）
    const withData = trend.filter((t) => t.samples > 0 || t.cendSamples > 0 || t.avi > 0);
    const latest = withData[withData.length - 1] || null;
    const prev = withData[withData.length - 2] || null;

    // 主口径来源：cend / model / baseline / none
    const srcOf = (p) =>
      !p ? "none" : p.aviCend !== null && p.aviCend !== undefined ? "cend" : p.aviModel !== null && p.aviModel !== undefined ? "model" : p.avi > 0 ? "baseline" : "none";
    const latestSource = srcOf(latest);
    const prevSource = srcOf(prev);
    // 口径切换时不可比：否则会把“从基线切到 C 端”当成真实增长
    const deltaComparable = Boolean(latest && prev && latestSource === prevSource);

    const runs = db
      .prepare("SELECT id, mode, total, status, started_at, finished_at FROM probe_runs WHERE brand_id=? ORDER BY started_at DESC LIMIT 8")
      .all(brand.id);

    const lastRun = db
      .prepare("SELECT * FROM probe_runs WHERE brand_id=? AND status='done' ORDER BY finished_at DESC LIMIT 1")
      .get(brand.id);

    let platforms = [];
    let intents = [];
    if (lastRun) {
      platforms = db
        .prepare(
          `SELECT platform, COUNT(*) samples, COALESCE(SUM(mention),0) mention, ROUND(AVG(NULLIF(position,0)),1) avgPosition
           FROM probe_results WHERE run_id=? AND channel!='cend' GROUP BY platform ORDER BY samples DESC`
        )
        .all(lastRun.id);
      intents = db
        .prepare(
          `SELECT p.intent, COUNT(*) samples, COALESCE(SUM(r.mention),0) mention
           FROM probe_results r JOIN prompts p ON p.id=r.prompt_id
           WHERE r.run_id=? AND r.channel!='cend' GROUP BY p.intent ORDER BY samples DESC`
        )
        .all(lastRun.id);
    }

    const cendTotal = db.prepare("SELECT COUNT(*) c FROM probe_results WHERE brand_id=? AND channel='cend'").get(brand.id).c;
    const cendByPlatform = db
      .prepare("SELECT platform, COUNT(*) c, COALESCE(SUM(mention),0) m FROM probe_results WHERE brand_id=? AND channel='cend' GROUP BY platform")
      .all(brand.id);
    const cendRecent = db
      .prepare(
        `SELECT r.id, r.platform, r.position, r.mention, r.accuracy, r.created_at, p.text AS prompt
         FROM probe_results r LEFT JOIN prompts p ON p.id=r.prompt_id
         WHERE r.brand_id=? AND r.channel='cend' ORDER BY r.created_at DESC LIMIT 6`
      )
      .all(brand.id);

    const promptsCount = db.prepare("SELECT COUNT(*) c FROM prompts WHERE brand_id=?").get(brand.id).c;
    const productsCount = db.prepare("SELECT COUNT(*) c FROM products WHERE brand_id=?").get(brand.id).c;
    const kbCount = db.prepare("SELECT COUNT(*) c FROM kb_documents WHERE brand_id=? AND status IN ('ready','image')").get(brand.id).c;

    const gaps = [];
    if (!kbCount) gaps.push({ key: "kb", label: "知识库里没有可用资料", action: "上传产品资料 / 报价单", to: "/kb" });
    if (!promptsCount) gaps.push({ key: "prompts", label: "还没有提问矩阵", action: "生成或手写问题", to: "/prompts" });
    if (!runs.length) gaps.push({ key: "runs", label: "没有跑过模型探测，模型倾向无数据", action: "去诊断页跑一轮", to: "/diagnosis" });
    if (!cendTotal) gaps.push({ key: "cend", label: "没有 C 端取证，四象限无法判定", action: "去取证工作台采集", to: "/evidence" });
    if (!productsCount) gaps.push({ key: "products", label: "产品库为空，llms.txt 少了服务清单", action: "AI 提取或手动新建", to: "/products" });

    res.json({
      range: { days, from },
      summary: {
        avi: latest?.avi ?? null,
        aviModel: latest?.aviModel ?? null,
        aviCend: latest?.aviCend ?? null,
        delta: deltaComparable ? +(latest.avi - prev.avi).toFixed(1) : null,
        deltaComparable,
        points: withData.length,
        lastDate: latest?.date ?? null,
        /** 主口径的真实来源：cend=有 A 级证据；model=有模型样本；baseline=仅有历史基线；none=无数据 */
        source: latestSource,
        prevSource,
      },
      trend,
      runs: runs.map((r) => ({ id: r.id, mode: r.mode, total: r.total, status: r.status, finishedAt: r.finished_at })),
      lastRun: lastRun ? { id: lastRun.id, mode: lastRun.mode, total: lastRun.total, finishedAt: lastRun.finished_at } : null,
      platforms: platforms.map((p) => ({
        platform: p.platform,
        samples: p.samples,
        mention: p.mention,
        rate: p.samples ? Math.round((p.mention / p.samples) * 1000) / 10 : 0,
        avgPosition: p.avgPosition,
      })),
      intents: intents.map((i) => ({
        intent: i.intent || "未分类",
        samples: i.samples,
        mention: i.mention,
        rate: i.samples ? Math.round((i.mention / i.samples) * 1000) / 10 : 0,
      })),
      cend: {
        total: cendTotal,
        byPlatform: cendByPlatform.map((x) => ({
          platform: x.platform,
          count: x.c,
          mention: x.m,
          rate: x.c ? Math.round((x.m / x.c) * 1000) / 10 : 0,
        })),
        recent: cendRecent.map((r) => ({
          id: r.id,
          platform: r.platform,
          prompt: r.prompt || "（提问已删除）",
          position: r.position,
          mention: !!r.mention,
          accuracy: r.accuracy,
          createdAt: r.created_at,
        })),
      },
      gaps,
    });
  })
);

/* ---------------- 官网：体检与 GEO 资产 ---------------- */

/** 把知识库切片拼成可提炼的原文（保留小标题，供资产内生成使用） */
function kbDocsOf(brandId) {
  return db
    .prepare("SELECT id, name FROM kb_documents WHERE brand_id=? AND status='ready' ORDER BY created_at")
    .all(brandId)
    .map((d) => ({
      name: d.name,
      text: db
        .prepare("SELECT title_path, text FROM kb_chunks WHERE doc_id=? ORDER BY seq")
        .all(d.id)
        .map((c) => (c.title_path ? `### ${c.title_path}\n${c.text}` : c.text))
        .join("\n\n"),
    }));
}

/* ---------------- 事实卡：AI 自动整理（读知识库文档 → 抽可核对事实） ---------------- */

app.post(
  "/api/facts/agent",
  requireAuth,
  requireLevel("editor"),
  async (req, res) => {
    try {
      const brand = ownedBrand(req, req.body?.brandId);
      if (!brand) return res.status(404).json({ error: "品牌不存在" });

      const st = agentStatus();
      if (!st.available) return res.status(503).json({ error: st.hint });

      const docs = kbDocsOf(brand.id);
      if (!docs.length) return res.status(400).json({ error: "知识库里还没有文档，先上传资料再自动整理" });

      // AI 每次生成的属性名与措辞都会变，靠去重追不上。
      // 所以明确：这是“初次建档”工具；库里已有事实卡时必须显式 force 才能追加。
      const factCount = db.prepare("SELECT COUNT(*) c FROM facts WHERE brand_id=? AND status!='archived'").get(brand.id).c;
      if (factCount > 0 && !req.body?.force) {
        return res.status(409).json({
          error: `该品牌已有 ${factCount} 条事实卡。AI 整理适合初次建档，重复执行会产生措辞重复的条目。`,
          existing: factCount,
          needForce: true,
        });
      }

      const corpus = docs
        .map((d) => `### ${d.name}\n${d.text.slice(0, 3500)}`)
        .join("\n\n")
        .slice(0, 12000);

      const prompt = `你是知识库整理助手。下面是企业资料原文，请抽取“可核对的事实口径”，输出 JSON 数组。

抽取范围（只抽这类）：
- 开源协议 / 许可证、版本号、技术栈与依赖
- 默认配置（如默认数据库、默认端口）、部署方式与环境要求
- 支持的能力数量、支持的模型/平台清单、限制条件
- 关键参数（数量、期限、时长、价格区间）

铁律：
1. value 必须能在原文里直接找到，不得改写数字、不得相加或外推、不得编造。
2. 不抽营销形容词、不抽意见/建议、不抽“我们可以提供”这类承诺。
3. subject 统一用品牌名“${brand.name}”；source 写该事实所在的文档名。
4. 同一属性只能输出一条；如果原文里存在两种不同说法，两条都输出（系统会自己标冲突）。
5. 最多 20 条，按重要性排序。
6. 只输出 JSON 数组，不要 markdown 代码块，不要任何解释文字。

格式示例：
[{"subject":"${brand.name}","attr":"开源协议","value":"GPL-2.0","source":"LICENSE"}]

资料开始
${corpus}
资料结束`;

      const out = await runAgent({ brandId: brand.id, prompt, timeoutMs: 180000 });
      if (!out.ok) return res.status(422).json({ error: out.error || "AI 整理失败" });

      const raw = String(out.text || "")
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();

      let items = null;
      try {
        items = JSON.parse(raw);
      } catch {
        const m = raw.match(/\[[\s\S]*\]/);
        if (m) {
          try {
            items = JSON.parse(m[0]);
          } catch {
            items = null;
          }
        }
      }
      if (!Array.isArray(items)) {
        return res.status(422).json({ error: "模型没有返回合法 JSON，请重试", raw: raw.slice(0, 300) });
      }

      const t = now();
      let added = 0;
      let skipped = 0;
      let conflicts = 0;
      const preview = [];

      for (const it of items.slice(0, 30)) {
        const attr = String(it?.attr || "").trim().slice(0, 40);
        const value = String(it?.value || "").trim().slice(0, 160);
        if (!attr || !value || value === "—") {
          skipped++;
          continue;
        }
        const subject = String(it?.subject || brand.name).trim().slice(0, 60);
        const source = String(it?.source || "AI 整理").trim().slice(0, 80);

        // 去重不能做精确比较：AI 每次措辞会轻微变化（多一个括号、少一个空格），
        // 精确比较会让重复事实越堆越多。归一化后只比“同属性且同值/互相包含”。
        const norm = (s) =>
          String(s || "")
            .toLowerCase()
            .replace(/[\s\p{P}\p{S}]/gu, "");
        // 属性名归一：去掉括号说明与“数量/个数”后缀，避免同一口径因叫法不同而重复
        const nAttr = (s) =>
          String(s || "")
            .replace(/[（(][^）)]*[）)]/g, "")
            .replace(/(数量|个数|数目)$/, "")
            .trim();
        const existing = db
          .prepare("SELECT attr, value FROM facts WHERE brand_id=? AND subject=? AND status!='archived'")
          .all(brand.id, subject);
        const nv = norm(value);
        const near = existing.find(
          (f) =>
            nAttr(f.attr) === nAttr(attr) &&
            (norm(f.value) === nv || norm(f.value).includes(nv) || nv.includes(norm(f.value)))
        );
        if (near) {
          skipped++;
          continue;
        }

        // 同主体同属性不同值 → 打同一个冲突组，交给人工裁决（口径矛盾不能静默覆盖）
        const sameAttr = db
          .prepare("SELECT * FROM facts WHERE brand_id=? AND subject=? AND attr=? AND status!='archived'")
          .all(brand.id, subject, attr);
        let cg = "";
        let status = "active";
        if (sameAttr.length) {
          cg = sameAttr[0].conflict_group || `cg-${id().slice(0, 8)}`;
          db.prepare(
            "UPDATE facts SET status='conflict', conflict_group=?, updated_at=? WHERE brand_id=? AND subject=? AND attr=? AND status='active'"
          ).run(cg, t, brand.id, subject, attr);
          status = "conflict";
          conflicts++;
        }

        db.prepare(
          `INSERT INTO facts (id, brand_id, subject, attr, value, valid_from, valid_to, source, status, conflict_group, created_at, updated_at)
           VALUES (?,?,?,?,?,?,'',?,?,?,?,?)`
        ).run(id(), brand.id, subject, attr, value, `${t.slice(0, 10)} 起`, source, status, cg, t, t);

        added++;
        preview.push({ attr, value, status });
      }

      res.json({
        ok: true,
        added,
        skipped,
        conflicts,
        total: items.length,
        docCount: docs.length,
        preview: preview.slice(0, 10),
        ms: out.usage ? undefined : undefined,
      });
    } catch (e) {
      console.error("[facts/agent]", e);
      res.status(500).json({ error: String(e.message || e) });
    }
  }
);

/** 站点体检：真抓真判，返回 8 项检查与评分 */
app.post(
  "/api/site/audit",
  requireAuth,
  requireLevel("editor"),
  wrap(async (req, res) => {
    const { brandId, url } = req.body || {};
    const brand = ownedBrand(req, brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });

    const target = normalizeUrl(url || brand.site_url || "");
    if (!target) return res.status(400).json({ error: "请填写官网地址，例如 example.com" });

    try {
      const result = await auditSite(target);
      db.prepare("UPDATE brands SET site_url=? WHERE id=?").run(target, brand.id);
      res.json(result);
    } catch (e) {
      res.status(422).json({ error: String(e.message || e) });
    }
  })
);

/** 从事实卡与门店生成 llms.txt / JSON-LD */
app.get(
  "/api/site/assets",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });

    const ctx = loadContext(brand.id);
    const stores = db.prepare("SELECT * FROM stores WHERE brand_id=?").all(brand.id);
    const baseUrl = normalizeUrl(req.query.url || brand.site_url || "");

    const docs = kbDocsOf(brand.id);
    const out = buildSiteAssets({
      brand,
      facts: ctx.facts,
      stores,
      prompts: db.prepare("SELECT * FROM prompts WHERE brand_id=? ORDER BY weight DESC").all(brand.id),
      baseUrl,
      docs,
      products: db.prepare("SELECT * FROM products WHERE brand_id=? AND status='active' ORDER BY created_at").all(brand.id),
    });
    res.json({ ...out, baseUrl, storeCount: stores.length, docCount: docs.length });
  })
);

/** llms.txt 直接下载 */
app.get(
  "/api/site/llms.txt",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const ctx = loadContext(brand.id);
    const stores = db.prepare("SELECT * FROM stores WHERE brand_id=?").all(brand.id);
    const out = buildSiteAssets({
      brand,
      facts: ctx.facts,
      stores,
      prompts: db.prepare("SELECT * FROM prompts WHERE brand_id=? ORDER BY weight DESC").all(brand.id),
      baseUrl: normalizeUrl(req.query.url || brand.site_url || ""),
      docs: kbDocsOf(brand.id),
      products: db.prepare("SELECT * FROM products WHERE brand_id=? AND status='active' ORDER BY created_at").all(brand.id),
    });
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="llms.txt"`);
    res.send(out.llmsTxt);
  })
);

/* ---------------- SEO 曝光率：站点可索引性 / 关键词排名 / 站长数据导入 ---------------- */

const SEO_TOP_N = 20;
const seoDate = () => new Date().toISOString().slice(0, 10);
const nullable = (v) =>
  v === undefined || v === null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;

/** 按天 UPSERT：同日多轮只留一个点；没数据的字段保持 null，不写假 0 */
function saveSeoDaily(brandId, v) {
  const date = String(v.date || seoDate()).slice(0, 10);
  const impressions = nullable(v.impressions);
  const clicks = nullable(v.clicks);
  const ctr =
    v.ctr !== undefined
      ? nullable(v.ctr)
      : impressions !== null && impressions > 0 && clicks !== null
        ? clicks / impressions
        : null;
  const vals = [
    nullable(v.indexedPages), impressions, clicks, ctr,
    nullable(v.avgPosition), nullable(v.exposureRate),
    Number(v.keywordsTotal) || 0, Number(v.keywordsExposed) || 0,
    v.source || "manual", String(v.note || ""),
  ];
  const old = db.prepare("SELECT id FROM seo_daily WHERE brand_id=? AND date=?").get(brandId, date);
  if (old) {
    db.prepare(
      `UPDATE seo_daily SET indexed_pages=?, impressions=?, clicks=?, ctr=?, avg_position=?,
       exposure_rate=?, keywords_total=?, keywords_exposed=?, source=?, note=? WHERE id=?`
    ).run(...vals, old.id);
    return old.id;
  }
  const rid = id();
  db.prepare(
    `INSERT INTO seo_daily
     (id, brand_id, date, indexed_pages, impressions, clicks, ctr, avg_position, exposure_rate,
      keywords_total, keywords_exposed, source, note, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(rid, brandId, date, ...vals, now());
  return rid;
}

const mapSeoKeyword = (k) => ({
  id: k.id,
  keyword: k.keyword,
  engine: k.engine,
  intent: k.intent || "",
  enabled: Boolean(k.enabled),
  createdAt: k.created_at,
});

/** 看板聚合：KPI + 趋势 + 关键词 + 站点体检 + 缺口清单 + 数据源状态 */
app.get(
  "/api/seo/overview",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });

    const days = Math.min(180, Math.max(7, Number(req.query.days) || 30));
    const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const daily = db.prepare("SELECT * FROM seo_daily WHERE brand_id=? AND date>=? ORDER BY date").all(brand.id, from);
    const keywords = db
      .prepare(
        `SELECT k.*, r.position AS last_position, r.exposed AS last_exposed, r.source AS last_source,
                r.error AS last_error, r.date AS last_date, r.url AS last_url, r.title AS last_title
         FROM seo_keywords k
         LEFT JOIN seo_results r ON r.id = (
           SELECT id FROM seo_results WHERE keyword_id = k.id ORDER BY date DESC, created_at DESC LIMIT 1
         )
         WHERE k.brand_id=? ORDER BY k.created_at`
      )
      .all(brand.id);
    const lastScan = db.prepare("SELECT * FROM seo_scans WHERE brand_id=? ORDER BY created_at DESC LIMIT 1").get(brand.id);
    const scans = db
      .prepare("SELECT id, url, score, grade, created_at FROM seo_scans WHERE brand_id=? ORDER BY created_at DESC LIMIT 8")
      .all(brand.id);
    const allRecords = db
      .prepare("SELECT * FROM seo_daily WHERE brand_id=? ORDER BY date DESC LIMIT 180")
      .all(brand.id);

    const trend = daily.map((d) => ({
      date: d.date,
      exposureRate: d.exposure_rate ?? null,
      avgPosition: d.avg_position ?? null,
      impressions: d.impressions ?? null,
      source: d.source,
    }));
    const withRate = daily.filter((d) => d.exposure_rate !== null);
    const latest = withRate[withRate.length - 1] || null;
    const prev = withRate.length > 1 ? withRate[withRate.length - 2] : null;
    const comparable = Boolean(latest && prev && latest.source === prev.source);
    const last = daily[daily.length - 1] || null;
    const idxRow = [...daily].reverse().find((d) => d.indexed_pages !== null) || null;

    const cfg = searchConfig();
    const gaps = [];
    if (!cfg.live && !daily.some((d) => d.source === "manual")) {
      gaps.push({
        key: "source", label: "尚未接入搜索数据源",
        action: "在 server/.env 配置 GEO_SEO_SEARCH_KEY / _BASE，或手工录入站长平台的真实数据", to: "",
      });
    }
    if (!keywords.length) {
      gaps.push({ key: "keywords", label: "还没有监控关键词", action: "在下方关键词表添加要监测的搜索词", to: "" });
    }
    if (!lastScan) {
      gaps.push({ key: "scan", label: "尚未扫描目标站点", action: "填写目标网址后点「开始扫描」", to: "" });
    } else if (lastScan.score < 60) {
      gaps.push({
        key: "indexability", label: `站点可索引性仅 ${lastScan.score} 分`,
        action: "优先修 robots/sitemap 假 200 与 SPA 空白页，再去「官网」生成 GEO 资产", to: "/site",
      });
    }
    if (!latest) {
      gaps.push({ key: "exposure", label: "暂无曝光率数据", action: "接入搜索 API 跑一轮扫描，或手工录入站长平台导出值", to: "" });
    }

    res.json({
      range: { days, from },
      target: { url: lastScan?.url || brand.site_url || "", lastScanAt: lastScan?.created_at || null },
      sources: {
        serp: { live: cfg.live, provider: cfg.provider, engine: cfg.engine, base: cfg.base || "" },
        site: { available: true, label: "实时抓取目标站，无需 Key" },
        manual: { records: daily.filter((d) => d.source === "manual").length },
      },
      summary: {
        exposureRate: latest?.exposure_rate ?? null,
        exposureSource: latest?.source || "none",
        indexedPages: idxRow?.indexed_pages ?? null,
        indexedSource: idxRow?.source || "none",
        impressions: last?.impressions ?? null,
        clicks: last?.clicks ?? null,
        ctr: last?.ctr ?? null,
        avgPosition: last?.avg_position ?? null,
        keywordsTotal: keywords.filter((k) => k.enabled).length,
        keywordsExposed: last?.keywords_exposed ?? 0,
        delta: comparable ? Number((latest.exposure_rate - prev.exposure_rate).toFixed(1)) : null,
        deltaComparable: comparable,
        asOf: last?.date || null,
        note: last?.note || "",
      },
      trend,
      keywords: keywords.map((k) => ({
        ...mapSeoKeyword(k),
        position: k.last_position ?? null,
        exposed: Boolean(k.last_exposed),
        source: k.last_source || "none",
        error: k.last_error || "",
        checkedAt: k.last_date || null,
        url: k.last_url || "",
        title: k.last_title || "",
      })),
      scan: lastScan
        ? { ...lastScan, checks: JSON.parse(lastScan.checks || "[]"), facts: JSON.parse(lastScan.facts || "{}"), createdAt: lastScan.created_at }
        : null,
      scans: scans.map((s) => ({ id: s.id, url: s.url, score: s.score, grade: s.grade, createdAt: s.created_at })),
      records: allRecords.map(mapSeoDaily),
      gaps,
      schedule: seoScheduleState(),
    });
  })
);

app.get(
  "/api/seo/keywords",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const rows = db.prepare("SELECT * FROM seo_keywords WHERE brand_id=? ORDER BY created_at").all(brand.id);
    res.json(rows.map(mapSeoKeyword));
  })
);

app.post(
  "/api/seo/keywords",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const { brandId, keyword, engine = "google", intent = "" } = req.body || {};
    const brand = ownedBrand(req, brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const kw = String(keyword || "").trim().slice(0, 80);
    if (!kw) return res.status(400).json({ error: "关键词不能为空" });
    const dup = db.prepare("SELECT id FROM seo_keywords WHERE brand_id=? AND keyword=? AND engine=?").get(brand.id, kw, String(engine));
    if (dup) return res.status(400).json({ error: "该关键词已存在" });
    const row = { id: id(), brand_id: brand.id, keyword: kw, engine: String(engine), intent: String(intent), enabled: 1, created_at: now() };
    db.prepare(
      "INSERT INTO seo_keywords (id, brand_id, keyword, engine, intent, enabled, created_at) VALUES (?,?,?,?,?,?,?)"
    ).run(row.id, row.brand_id, row.keyword, row.engine, row.intent, row.enabled, row.created_at);
    res.json(mapSeoKeyword(row));
  })
);

app.delete(
  "/api/seo/keywords/:id",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const out = db.prepare("DELETE FROM seo_keywords WHERE id=? AND brand_id=?").run(req.params.id, brand.id);
    if (!out.changes) return res.status(404).json({ error: "关键词不存在" });
    res.json({ ok: true });
  })
);

/** 扫描核心：HTTP 路由与定时任务共用；真抓站点，有 Key 才查排名 */
async function performSeoScan(brand, target) {
  const scan = await scanTarget(target);
  const scanId = id();
  const at = now();
  db.prepare(
    "INSERT INTO seo_scans (id, brand_id, url, score, grade, checks, facts, created_at) VALUES (?,?,?,?,?,?,?,?)"
  ).run(scanId, brand.id, scan.url, scan.score, scan.grade, JSON.stringify(scan.checks), JSON.stringify(scan.facts), at);

  const cfg = searchConfig();
  const kws = db.prepare("SELECT * FROM seo_keywords WHERE brand_id=? AND enabled=1").all(brand.id);
  let checked = 0;
  let errors = 0;

  if (cfg.live) {
    const runs = await Promise.all(kws.map(async (k) => ({ k, r: await querySerp(k.keyword, k.engine) })));
    const date = seoDate();
    const del = db.prepare("DELETE FROM seo_results WHERE brand_id=? AND keyword_id=? AND date=?");
    const ins = db.prepare(
      `INSERT INTO seo_results (id, brand_id, keyword_id, date, engine, position, exposed, url, title, source, error, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,'live',?,?)`
    );
    for (const { k, r } of runs) {
      del.run(brand.id, k.id, date);
      if (r.error) {
        errors += 1;
        ins.run(id(), brand.id, k.id, date, r.engine || k.engine, null, 0, "", "", r.error, now());
        continue;
      }
      const pos = matchPosition(r.items, target);
      const hit = pos > 0 && pos <= SEO_TOP_N ? r.items[pos - 1] : null;
      ins.run(id(), brand.id, k.id, date, r.engine || k.engine, pos || null, hit ? 1 : 0, hit?.url || "", hit?.title || "", "", now());
      checked += 1;
    }
    const idx = await queryIndexed(target);
    const exposed = db
      .prepare("SELECT COUNT(*) c FROM seo_results WHERE brand_id=? AND date=? AND exposed=1")
      .get(brand.id, date).c;
    // 失败样本不计入分母，避免把「接口报错」算成「没曝光」
    if (checked > 0) {
      saveSeoDaily(brand.id, {
        date, indexedPages: idx.count, exposureRate: Number(((exposed / checked) * 100).toFixed(1)),
        keywordsTotal: checked, keywordsExposed: exposed, source: "live",
        note: `搜索 API 实测 ${checked} 个关键词，${errors} 个失败`,
      });
    }
  }

  return {
    scan: { ...scan, id: scanId, createdAt: at },
    mode: cfg.live ? "live" : "site-only",
    checked, errors, keywords: kws.length,
    hint: cfg.live ? "" : "仅完成站点可索引性扫描；未配置搜索 API，关键词排名不编造数据",
  };
}

app.post(
  "/api/seo/scan",
  requireAuth,
  requireLevel("editor"),
  wrap(async (req, res) => {
    const { brandId, url } = req.body || {};
    const brand = ownedBrand(req, brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const target = normalizeUrl(url || brand.site_url || "");
    if (!target) return res.status(400).json({ error: "请填写目标网址" });
    try {
      res.json(await performSeoScan(brand, target));
    } catch (e) {
      return res.status(422).json({ error: String(e.message || e) });
    }
  })
);

/** 手工录入：GSC / 百度站长平台等真实导出数据 */
app.post(
  "/api/seo/records",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const b = req.body || {};
    const brand = ownedBrand(req, b.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const has = ["indexedPages", "impressions", "clicks", "avgPosition", "exposureRate"].some(
      (k) => b[k] !== undefined && b[k] !== null && b[k] !== ""
    );
    if (!has) return res.status(400).json({ error: "请至少填写一项真实数据" });
    const total = db.prepare("SELECT COUNT(*) c FROM seo_keywords WHERE brand_id=? AND enabled=1").get(brand.id).c;
    const date = String(b.date || seoDate()).slice(0, 10);
    saveSeoDaily(brand.id, {
      date,
      indexedPages: b.indexedPages,
      impressions: b.impressions,
      clicks: b.clicks,
      avgPosition: b.avgPosition,
      exposureRate: b.exposureRate,
      keywordsTotal: total,
      keywordsExposed: b.keywordsExposed,
      source: "manual",
      note: b.note || "手工录入（站长平台导出）",
    });
    res.json({ ok: true, date });
  })
);

const mapSeoDaily = (d) => ({
  date: d.date,
  indexedPages: d.indexed_pages,
  impressions: d.impressions,
  clicks: d.clicks,
  ctr: d.ctr,
  avgPosition: d.avg_position,
  exposureRate: d.exposure_rate,
  keywordsTotal: d.keywords_total,
  keywordsExposed: d.keywords_exposed,
  source: d.source,
  note: d.note,
});

/** 关键词启停：关掉的词不进扫描分母，也不算进曝光率 */
app.patch(
  "/api/seo/keywords/:id",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const b = req.body || {};
    const brand = ownedBrand(req, b.brandId || req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const enabled = b.enabled === false || b.enabled === 0 ? 0 : 1;
    const out = db
      .prepare("UPDATE seo_keywords SET enabled=? WHERE id=? AND brand_id=?")
      .run(enabled, req.params.id, brand.id);
    if (!out.changes) return res.status(404).json({ error: "关键词不存在" });
    res.json({ ok: true, enabled: Boolean(enabled) });
  })
);

/** 单个关键词的位次历史（日粒度） */
app.get(
  "/api/seo/keywords/:id/history",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const kw = db.prepare("SELECT id, keyword FROM seo_keywords WHERE id=? AND brand_id=?").get(req.params.id, brand.id);
    if (!kw) return res.status(404).json({ error: "关键词不存在" });
    const rows = db
      .prepare("SELECT date, position, exposed, source, error, url, title FROM seo_results WHERE keyword_id=? ORDER BY date")
      .all(kw.id);
    res.json({
      keyword: kw.keyword,
      points: rows.map((r) => ({
        date: r.date, position: r.position ?? null, exposed: Boolean(r.exposed),
        source: r.source, error: r.error || "", url: r.url || "", title: r.title || "",
      })),
    });
  })
);

app.get(
  "/api/seo/records",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const rows = db.prepare("SELECT * FROM seo_daily WHERE brand_id=? ORDER BY date DESC LIMIT 180").all(brand.id);
    res.json(rows.map(mapSeoDaily));
  })
);

app.patch(
  "/api/seo/records/:date",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const b = req.body || {};
    const brand = ownedBrand(req, b.brandId || req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const date = String(req.params.date || "").slice(0, 10);
    const old = db.prepare("SELECT * FROM seo_daily WHERE brand_id=? AND date=?").get(brand.id, date);
    if (!old) return res.status(404).json({ error: "该日期没有记录" });
    const pick = (key, col) => (b[key] !== undefined ? b[key] : old[col]);
    saveSeoDaily(brand.id, {
      date,
      indexedPages: pick("indexedPages", "indexed_pages"),
      impressions: pick("impressions", "impressions"),
      clicks: pick("clicks", "clicks"),
      avgPosition: pick("avgPosition", "avg_position"),
      exposureRate: pick("exposureRate", "exposure_rate"),
      keywordsTotal: pick("keywordsTotal", "keywords_total"),
      keywordsExposed: pick("keywordsExposed", "keywords_exposed"),
      source: old.source,
      note: b.note !== undefined ? b.note : old.note,
    });
    res.json({ ok: true, date });
  })
);

app.delete(
  "/api/seo/records/:date",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const out = db
      .prepare("DELETE FROM seo_daily WHERE brand_id=? AND date=?")
      .run(brand.id, String(req.params.date || "").slice(0, 10));
    if (!out.changes) return res.status(404).json({ error: "该日期没有记录" });
    res.json({ ok: true });
  })
);

/* ---------------- 半自动数据通道：人工位次 / 站长平台 CSV ---------------- */

/** 合并写入当天快照：只覆盖传入字段，避免位次录入与 CSV 导入互相清空对方的数据 */
function mergeSeoDaily(brandId, date, patch) {
  const old = db.prepare("SELECT * FROM seo_daily WHERE brand_id=? AND date=?").get(brandId, date) || {};
  const pick = (k, col) => (patch[k] !== undefined ? patch[k] : old[col] ?? null);
  saveSeoDaily(brandId, {
    date,
    indexedPages: pick("indexedPages", "indexed_pages"),
    impressions: pick("impressions", "impressions"),
    clicks: pick("clicks", "clicks"),
    avgPosition: pick("avgPosition", "avg_position"),
    exposureRate: pick("exposureRate", "exposure_rate"),
    keywordsTotal: pick("keywordsTotal", "keywords_total"),
    keywordsExposed: pick("keywordsExposed", "keywords_exposed"),
    source: patch.source || old.source || "manual",
    note: patch.note !== undefined ? patch.note : old.note || "",
  });
}

/** 回显某天各关键词已录入的位次，供人工录入表单预填 */
app.get(
  "/api/seo/positions",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const date = String(req.query.date || seoDate()).slice(0, 10);
    const rows = db
      .prepare(
        `SELECT k.id, k.keyword, r.position, r.source FROM seo_keywords k
         LEFT JOIN seo_results r ON r.id = (
           SELECT id FROM seo_results WHERE keyword_id=k.id AND date=? ORDER BY created_at DESC LIMIT 1
         )
         WHERE k.brand_id=? AND k.enabled=1 ORDER BY k.created_at`
      )
      .all(date, brand.id);
    res.json({
      date,
      topN: SEO_TOP_N,
      items: rows.map((r) => ({
        keywordId: r.id,
        keyword: r.keyword,
        position: r.position ?? null,
        source: r.source || "none",
      })),
    });
  })
);

/** 人工录入逐词位次：写 seo_results(manual)，并按当天有效样本重算曝光率 */
app.post(
  "/api/seo/positions",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const b = req.body || {};
    const brand = ownedBrand(req, b.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const date = String(b.date || seoDate()).slice(0, 10);
    const items = Array.isArray(b.positions) ? b.positions.slice(0, 100) : [];
    if (!items.length) return res.status(400).json({ error: "没有提交任何位次" });

    const valid = new Set(
      db.prepare("SELECT id FROM seo_keywords WHERE brand_id=? AND enabled=1").all(brand.id).map((k) => k.id)
    );
    const del = db.prepare("DELETE FROM seo_results WHERE brand_id=? AND keyword_id=? AND date=? AND source='manual'");
    const ins = db.prepare(
      `INSERT INTO seo_results
       (id, brand_id, keyword_id, date, engine, position, exposed, url, title, source, error, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,'manual','',?)`
    );
    const values = [];
    let written = 0;

    db.exec("BEGIN");
    try {
      for (const it of items) {
        const kid = String(it?.keywordId || "");
        if (!valid.has(kid)) continue;
        del.run(brand.id, kid, date);
        const raw = it?.position;
        if (raw === null || raw === undefined || String(raw).trim() === "") continue; // 留空 = 未检测，清掉旧值
        const pos = Number(raw);
        if (!Number.isFinite(pos)) continue;
        const p = Math.max(0, Math.min(100, Math.round(pos)));
        const hit = p > 0 && p <= SEO_TOP_N;
        ins.run(id(), brand.id, kid, date, "", p, hit ? 1 : 0, "", "", now());
        values.push(p);
        written += 1;
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      return res.status(500).json({ error: `位次保存失败：${e.message}` });
    }

    const stat = computeExposure(values, SEO_TOP_N);
    mergeSeoDaily(brand.id, date, {
      exposureRate: stat.rate,
      keywordsTotal: stat.samples,
      keywordsExposed: stat.exposed,
      source: "manual",
      note: `人工录入位次 ${written} 个关键词`,
    });
    res.json({ ok: true, date, written, samples: stat.samples, exposed: stat.exposed, exposureRate: stat.rate });
  })
);

/** GSC / 百度站长平台 CSV 批量导入：按天合并，不覆盖已录入的位次与曝光率 */
app.post(
  "/api/seo/records/import",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const b = req.body || {};
    const brand = ownedBrand(req, b.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const { records, errors } = parseCsvRecords(b.csv);
    if (!records.length) {
      return res.status(400).json({ error: "没有可导入的数据行", errors: errors.slice(0, 10) });
    }
    const batch = records.slice(0, 500);
    db.exec("BEGIN");
    try {
      for (const r of batch) {
        mergeSeoDaily(brand.id, r.date, { ...r, source: "manual", note: r.note || "CSV 批量导入（站长平台）" });
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      return res.status(500).json({ error: `导入失败：${e.message}` });
    }
    res.json({ ok: true, imported: batch.length, skipped: errors.length, errors: errors.slice(0, 10) });
  })
);

/* ---------------- 链接资产台账：发布地址 / 官网 / 引用落地页 ---------------- */

const LINK_KINDS = ["article", "official", "landing", "citation", "competitor", "reprint", "other"];

function linkStats(brandId) {
  return { cites: citationCounts(db, brandId), serp: serpHitCounts(db, brandId) };
}

/** 被引用次数只算真实探测 / C 端取证 / SERP 命中；模拟样本单列，不计入效果 */
function mapLink(l, stats) {
  const citedByAi = stats.cites.real.get(l.host) || 0;
  const citedBySerp = stats.serp.get(l.host) || 0;
  return {
    id: l.id,
    url: l.url,
    host: l.host,
    kind: l.kind,
    title: l.title || "",
    placementId: l.placement_id || "",
    mediaId: l.media_id || "",
    contentId: l.content_id || "",
    publishedAt: l.published_at || "",
    source: l.source,
    status: l.status,
    httpStatus: l.http_status ?? null,
    indexed: l.indexed ?? null,
    lastCheckedAt: l.last_checked_at || "",
    note: l.note || "",
    createdAt: l.created_at,
    citedByAi,
    citedBySerp,
    citedMock: stats.cites.mock.get(l.host) || 0,
    citedCount: citedByAi + citedBySerp,
  };
}

app.get(
  "/api/links",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const stats = linkStats(brand.id);
    const all = db
      .prepare("SELECT * FROM link_assets WHERE brand_id=? ORDER BY created_at DESC")
      .all(brand.id)
      .map((l) => mapLink(l, stats));
    const kind = String(req.query.kind || "");
    const status = String(req.query.status || "");
    const items = all.filter((l) => (!kind || l.kind === kind) && (!status || l.status === status));
    const byKind = {};
    for (const l of all) byKind[l.kind] = (byKind[l.kind] || 0) + 1;
    res.json({
      items,
      kinds: LINK_KINDS,
      summary: {
        total: all.length,
        byKind,
        active: all.filter((l) => l.status === "active").length,
        broken: all.filter((l) => l.status === "broken").length,
        unknown: all.filter((l) => l.status === "unknown").length,
        indexed: all.filter((l) => l.indexed === 1).length,
        citedTotal: all.reduce((s, l) => s + l.citedCount, 0),
        citedMock: all.reduce((s, l) => s + l.citedMock, 0),
        lastCheckedAt: all.map((l) => l.lastCheckedAt).filter(Boolean).sort().pop() || null,
      },
    });
  })
);

app.get(
  "/api/links/checks",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const rows = db
      .prepare(
        `SELECT c.*, l.url FROM link_checks c LEFT JOIN link_assets l ON l.id=c.link_id
         WHERE c.brand_id=? ORDER BY c.checked_at DESC LIMIT 50`
      )
      .all(brand.id);
    res.json(
      rows.map((r) => ({
        id: r.id,
        linkId: r.link_id,
        url: r.url || "",
        checkedAt: r.checked_at,
        ok: Boolean(r.ok),
        httpStatus: r.http_status,
        error: r.error || "",
        ms: r.ms || 0,
      }))
    );
  })
);

/** 从分散的 4 处 URL 一键去重同步进台账 */
app.post(
  "/api/links/sync",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const brand = ownedBrand(req, req.body?.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });

    const found = new Map();
    const add = (raw, kind, title, extra = {}, from = "") => {
      const url = normalizeLink(raw);
      if (!url || found.has(url)) return;
      found.set(url, { url, kind, title, ...extra, from });
    };

    for (const p of db.prepare("SELECT * FROM placements WHERE brand_id=? AND url!=''").all(brand.id)) {
      add(p.url, "article", p.content_title, {
        placementId: p.id, mediaId: p.media_id, publishedAt: p.published_at,
      }, "placements");
    }
    const br = db.prepare("SELECT site_url FROM brands WHERE id=?").get(brand.id);
    if (br?.site_url) add(br.site_url, "official", "品牌官网", {}, "brands");
    for (const r of db.prepare("SELECT DISTINCT url, title FROM seo_results WHERE brand_id=? AND url!=''").all(brand.id)) {
      add(r.url, "landing", r.title || "搜索结果落地页", {}, "seo_results");
    }
    for (const r of db.prepare("SELECT DISTINCT evidence_url FROM probe_results WHERE brand_id=? AND evidence_url!=''").all(brand.id)) {
      add(r.evidence_url, "citation", "C 端取证存证", {}, "probe_results");
    }

    const ins = db.prepare(
      `INSERT OR IGNORE INTO link_assets
       (id, brand_id, url, host, kind, title, placement_id, media_id, content_id, published_at, source, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,'sync','unknown',?)`
    );
    let added = 0;
    const byFrom = {};
    db.exec("BEGIN");
    try {
      for (const l of found.values()) {
        const out = ins.run(
          id(), brand.id, l.url, hostOf(l.url), l.kind, l.title || "",
          l.placementId || "", l.mediaId || "", l.contentId || "", l.publishedAt || "", now()
        );
        if (out.changes) {
          added += 1;
          byFrom[l.from] = (byFrom[l.from] || 0) + 1;
        }
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      return res.status(500).json({ error: `同步失败：${e.message}` });
    }
    res.json({ ok: true, found: found.size, added, skipped: found.size - added, byFrom });
  })
);

/** 批量存活巡检：真发 HTTP，结果写入台账与巡检历史 */
app.post(
  "/api/links/check",
  requireAuth,
  requireLevel("editor"),
  wrap(async (req, res) => {
    const b = req.body || {};
    const brand = ownedBrand(req, b.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const ids = Array.isArray(b.ids) ? b.ids.filter((x) => typeof x === "string").slice(0, 100) : [];
    const rows = ids.length
      ? db.prepare(`SELECT * FROM link_assets WHERE brand_id=? AND id IN (${ids.map(() => "?").join(",")})`).all(brand.id, ...ids)
      : db.prepare("SELECT * FROM link_assets WHERE brand_id=?").all(brand.id);

    const ins = db.prepare(
      "INSERT INTO link_checks (id, brand_id, link_id, checked_at, ok, http_status, error, ms) VALUES (?,?,?,?,?,?,?,?)"
    );
    const upd = db.prepare("UPDATE link_assets SET status=?, http_status=?, last_checked_at=? WHERE id=?");
    let ok = 0, broken = 0, networkErrors = 0;

    for (let i = 0; i < rows.length; i += 5) {
      const batch = rows.slice(i, i + 5);
      const results = await Promise.all(batch.map(async (l) => ({ l, r: await checkLink(l.url) })));
      for (const { l, r } of results) {
        const at = now();
        upd.run(r.ok ? "active" : "broken", r.status, at, l.id);
        ins.run(id(), brand.id, l.id, at, r.ok ? 1 : 0, r.status, r.error, r.ms);
        if (r.ok) ok += 1;
        else {
          broken += 1;
          if (r.status === 0) networkErrors += 1;
        }
      }
    }
    res.json({ ok: true, checked: rows.length, active: ok, broken, networkErrors, at: now() });
  })
);

app.post(
  "/api/links",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const b = req.body || {};
    const brand = ownedBrand(req, b.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const url = normalizeLink(b.url);
    if (!url) return res.status(400).json({ error: "网址不合法，请填写完整 http(s) 地址" });
    const kind = LINK_KINDS.includes(String(b.kind)) ? String(b.kind) : "article";
    const rid = id();
    const out = db
      .prepare(
        `INSERT OR IGNORE INTO link_assets
         (id, brand_id, url, host, kind, title, published_at, source, status, note, created_at)
         VALUES (?,?,?,?,?,?,?,'manual','unknown',?,?)`
      )
      .run(rid, brand.id, url, hostOf(url), kind, String(b.title || ""), String(b.publishedAt || ""), String(b.note || ""), now());
    if (!out.changes) return res.status(400).json({ error: "该网址已在台账中" });
    const row = db.prepare("SELECT * FROM link_assets WHERE id=?").get(rid);
    res.json(mapLink(row, linkStats(brand.id)));
  })
);

app.patch(
  "/api/links/:id",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const b = req.body || {};
    const brand = ownedBrand(req, b.brandId || req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const l = db.prepare("SELECT * FROM link_assets WHERE id=? AND brand_id=?").get(req.params.id, brand.id);
    if (!l) return res.status(404).json({ error: "链接不存在" });
    const pick = (k, col) => (b[k] !== undefined ? b[k] : l[col]);
    const indexed =
      b.indexed === undefined ? l.indexed : b.indexed === null || b.indexed === "" ? null : Number(b.indexed) ? 1 : 0;
    db.prepare("UPDATE link_assets SET kind=?, title=?, note=?, published_at=?, indexed=? WHERE id=?").run(
      LINK_KINDS.includes(String(pick("kind", "kind"))) ? String(pick("kind", "kind")) : l.kind,
      String(pick("title", "title") || ""),
      String(pick("note", "note") || ""),
      String(pick("publishedAt", "published_at") || ""),
      indexed,
      l.id
    );
    res.json(mapLink(db.prepare("SELECT * FROM link_assets WHERE id=?").get(l.id), linkStats(brand.id)));
  })
);

app.delete(
  "/api/links/:id",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const out = db.prepare("DELETE FROM link_assets WHERE id=? AND brand_id=?").run(req.params.id, brand.id);
    if (!out.changes) return res.status(404).json({ error: "链接不存在" });
    db.prepare("DELETE FROM link_checks WHERE link_id=? AND brand_id=?").run(req.params.id, brand.id);
    res.json({ ok: true });
  })
);

/* ---------------- 定时扫描（默认关闭，配置 GEO_SEO_SCAN_INTERVAL_MIN 开启） ---------------- */

const SEO_SCAN_INTERVAL_MIN = Math.max(0, Number(process.env.GEO_SEO_SCAN_INTERVAL_MIN) || 0);
let seoScanBusy = false;
let seoLastAutoAt = null;
let seoLastAutoError = "";

function seoScheduleState() {
  return {
    enabled: SEO_SCAN_INTERVAL_MIN > 0,
    intervalMin: SEO_SCAN_INTERVAL_MIN,
    lastAutoAt: seoLastAutoAt,
    lastAutoError: seoLastAutoError,
  };
}

async function runScheduledSeoScans() {
  if (seoScanBusy) return;
  seoScanBusy = true;
  const failed = [];
  try {
    const rows = db
      .prepare(
        `SELECT b.id, b.site_url,
                (SELECT s.url FROM seo_scans s WHERE s.brand_id=b.id ORDER BY s.created_at DESC LIMIT 1) AS last_url
         FROM brands b`
      )
      .all();
    for (const row of rows) {
      const target = normalizeUrl(row.last_url || row.site_url || "");
      if (!target) continue;
      try {
        await performSeoScan({ id: row.id }, target);
      } catch (e) {
        failed.push(`${row.id}: ${String(e.message || e)}`);
      }
    }
    seoLastAutoAt = now();
    seoLastAutoError = failed.join(" | ");
  } finally {
    seoScanBusy = false;
  }
}

function startSeoScheduler() {
  if (SEO_SCAN_INTERVAL_MIN <= 0) return;
  const timer = setInterval(() => void runScheduledSeoScans(), SEO_SCAN_INTERVAL_MIN * 60000);
  timer.unref?.();
  console.log(`[seo] 定时扫描已启用：每 ${SEO_SCAN_INTERVAL_MIN} 分钟`);
}

/* ---------------- 数字人工作台：配置与任务落库 ---------------- */

const AVATAR_SEGMENT_KEYS = [
  { key: "hook", label: "开场钩子", time: "0–4s" },
  { key: "pain", label: "痛点", time: "4–16s" },
  { key: "plan", label: "方案与事实", time: "16–42s" },
  { key: "cta", label: "行动号召", time: "42–60s" },
];

app.get(
  "/api/avatar/config",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const rows = db.prepare("SELECT * FROM avatar_config WHERE brand_id=? ORDER BY sort_order, created_at").all(brand.id);
    const segments = AVATAR_SEGMENT_KEYS.map((s, i) => {
      const r = rows.find((x) => x.kind === "segment" && x.meta === s.key);
      return { ...s, text: r?.content || "", id: r?.id || "", sortOrder: i };
    });
    const assets = { looks: [], voices: [], tpls: [] };
    const map = { look: "looks", voice: "voices", tpl: "tpls" };
    for (const r of rows) {
      if (!map[r.kind]) continue;
      assets[map[r.kind]].push({ id: r.id, name: r.name, meta: r.meta || "", mine: r.meta === "mine" });
    }
    const jobs = db
      .prepare("SELECT * FROM avatar_jobs WHERE brand_id=? ORDER BY created_at DESC LIMIT 20")
      .all(brand.id)
      .map((j) => ({ id: j.id, kind: j.kind, status: j.status, note: j.note, createdAt: j.created_at }));
    res.json({ segments, assets, jobs, capability: { player: false, generator: false } });
  })
);

/** 保存口播脚本：真实落库，空内容表示待填，不再用写死的演示稿 */
app.put(
  "/api/avatar/config",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const b = req.body || {};
    const brand = ownedBrand(req, b.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const list = Array.isArray(b.segments) ? b.segments : [];
    const del = db.prepare("DELETE FROM avatar_config WHERE brand_id=? AND kind='segment' AND meta=?");
    const ins = db.prepare(
      "INSERT INTO avatar_config (id, brand_id, kind, name, content, meta, sort_order, created_at) VALUES (?,?,?,?,?,?,?,?)"
    );
    let saved = 0;
    db.exec("BEGIN");
    try {
      AVATAR_SEGMENT_KEYS.forEach((s, i) => {
        del.run(brand.id, s.key);
        const hit = list.find((x) => x?.key === s.key);
        const text = String(hit?.text || "").trim();
        if (text) {
          ins.run(id(), brand.id, "segment", s.label, text, s.key, i, now());
          saved += 1;
        }
      });
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      return res.status(500).json({ error: `保存失败：${e.message}` });
    }
    res.json({ ok: true, saved });
  })
);

app.post(
  "/api/avatar/assets",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const b = req.body || {};
    const brand = ownedBrand(req, b.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const kind = ["look", "voice", "tpl"].includes(String(b.kind)) ? String(b.kind) : "look";
    const name = String(b.name || "").trim().slice(0, 60);
    if (!name) return res.status(400).json({ error: "名称不能为空" });
    const rid = id();
    db.prepare(
      "INSERT INTO avatar_config (id, brand_id, kind, name, content, meta, sort_order, created_at) VALUES (?,?,?,?,?,?,?,?)"
    ).run(rid, brand.id, kind, name, "", String(b.meta || ""), 0, now());
    res.json({ id: rid, name, kind, meta: String(b.meta || "") });
  })
);

app.delete(
  "/api/avatar/assets/:id",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const out = db.prepare("DELETE FROM avatar_config WHERE id=? AND brand_id=? AND kind!='segment'").run(req.params.id, brand.id);
    if (!out.changes) return res.status(404).json({ error: "配置项不存在" });
    res.json({ ok: true });
  })
);

/** 生成任务只登记，不假装已出片：外部视频生成服务尚未接入 */
app.post(
  "/api/avatar/jobs",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const b = req.body || {};
    const brand = ownedBrand(req, b.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const rid = id();
    db.prepare(
      "INSERT INTO avatar_jobs (id, brand_id, kind, status, note, payload, created_at) VALUES (?,?,?,'pending',?,?,?)"
    ).run(
      rid,
      brand.id,
      String(b.kind || "speak"),
      "已登记，等待外部视频生成服务接入后执行",
      JSON.stringify(b.payload || {}),
      now()
    );
    res.json({ ok: true, id: rid, status: "pending", note: "外部生成服务未接入，任务不会自动出片" });
  })
);

/* ---------------- 服务商工作台：真实品牌数据 + 可管理客户 ---------------- */

function agencyOverview(tenantId) {
  const brands = db.prepare("SELECT id, name FROM brands WHERE tenant_id=? ORDER BY created_at").all(tenantId);
  const items = brands.map((b) => {
    const avi = db.prepare("SELECT avi FROM metrics_daily WHERE brand_id=? ORDER BY date DESC LIMIT 1").get(b.id)?.avi ?? null;
    const contents = db.prepare("SELECT COUNT(*) c FROM contents WHERE brand_id=?").get(b.id).c;
    const budget = db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE brand_id=?").get(b.id).s;
    return {
      id: `brand:${b.id}`, name: b.name, plan: "自有品牌", brands: "1", avi, contents, budget,
      state: "服务中", expire: "—", primary: false, source: "brand", note: "由 brands / metrics_daily / contents / orders 实时聚合",
    };
  });
  const manual = db
    .prepare("SELECT * FROM agency_clients WHERE tenant_id=? ORDER BY created_at")
    .all(tenantId)
    .map((c) => ({
      id: c.id, name: c.name, plan: c.plan, brands: "—", avi: c.avi, contents: c.contents,
      budget: c.budget, state: c.state, expire: c.expire, primary: Boolean(c.is_primary),
      source: "manual", note: c.note || "",
    }));
  const all = [...items, ...manual];
  const settings = db.prepare("SELECT * FROM agency_settings WHERE tenant_id=?").get(tenantId) || {};
  const tasks = db
    .prepare("SELECT * FROM agency_tasks WHERE tenant_id=? ORDER BY created_at DESC LIMIT 10")
    .all(tenantId)
    .map((t) => ({ id: t.id, kind: t.kind, target: t.target, status: t.status, note: t.note, createdAt: t.created_at }));
  return {
    items: all,
    summary: {
      clients: all.length,
      brands: items.length,
      budget: all.reduce((s, x) => s + (Number(x.budget) || 0), 0),
      warning: all.filter((x) => x.state === "续费预警").length,
    },
    settings: {
      themeColor: settings.theme_color || "#0071e3",
      reportTemplate: settings.report_template || "标准模板",
    },
    tasks,
  };
}

app.get(
  "/api/agency/overview",
  requireAuth,
  wrap((req, res) => res.json(agencyOverview(req.tenant.id)))
);

app.post(
  "/api/agency/clients",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const b = req.body || {};
    const name = String(b.name || "").trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: "客户名称必填" });
    const rid = id();
    db.prepare(
      `INSERT INTO agency_clients (id, tenant_id, name, plan, avi, contents, budget, state, expire, is_primary, note, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      rid, req.tenant.id, name, String(b.plan || "成长版"), b.avi ?? null, Number(b.contents) || 0,
      Number(b.budget) || 0, String(b.state || "服务中"), String(b.expire || ""), b.isPrimary ? 1 : 0,
      String(b.note || ""), now()
    );
    res.json({ ok: true, id: rid });
  })
);

app.patch(
  "/api/agency/clients/:id",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const row = db.prepare("SELECT * FROM agency_clients WHERE id=? AND tenant_id=?").get(req.params.id, req.tenant.id);
    if (!row) return res.status(404).json({ error: "客户不存在" });
    const b = req.body || {};
    const pick = (k, col) => (b[k] !== undefined ? b[k] : row[col]);
    db.prepare(
      `UPDATE agency_clients SET name=?, plan=?, avi=?, contents=?, budget=?, state=?, expire=?, is_primary=?, note=? WHERE id=?`
    ).run(
      String(pick("name", "name")), String(pick("plan", "plan")), pick("avi", "avi"),
      Number(pick("contents", "contents")) || 0, Number(pick("budget", "budget")) || 0,
      String(pick("state", "state")), String(pick("expire", "expire")),
      pick("isPrimary", "is_primary") ? 1 : 0, String(pick("note", "note") || ""), row.id
    );
    res.json({ ok: true });
  })
);

app.delete(
  "/api/agency/clients/:id",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const out = db.prepare("DELETE FROM agency_clients WHERE id=? AND tenant_id=?").run(req.params.id, req.tenant.id);
    if (!out.changes) return res.status(404).json({ error: "客户不存在" });
    res.json({ ok: true });
  })
);

app.put(
  "/api/agency/settings",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const b = req.body || {};
    const color = /^#[0-9a-f]{6}$/i.test(String(b.themeColor || "")) ? String(b.themeColor) : "#0071e3";
    db.prepare(
      `INSERT INTO agency_settings (tenant_id, theme_color, report_template, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(tenant_id) DO UPDATE SET theme_color=excluded.theme_color,
       report_template=excluded.report_template, updated_at=excluded.updated_at`
    ).run(req.tenant.id, color, String(b.reportTemplate || "标准模板").slice(0, 60), now());
    res.json({ ok: true });
  })
);

/** 批量任务只登记，不假装已生成 23 份报告 */
app.post(
  "/api/agency/tasks",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const b = req.body || {};
    const kind = String(b.kind || "").slice(0, 40);
    if (!kind) return res.status(400).json({ error: "任务类型必填" });
    const rid = id();
    db.prepare(
      "INSERT INTO agency_tasks (id, tenant_id, kind, target, status, note, created_at) VALUES (?,?,?,'all','pending',?,?)"
    ).run(rid, req.tenant.id, kind, "已登记；报告生成 / 批量复测服务尚未接入", now());
    res.json({ ok: true, id: rid, status: "pending" });
  })
);

/* ---------------- 发布排期：养号阶段 + 知识/GEO 穿插 ---------------- */

const mapPlan = (r) => ({
  id: r.id,
  contentId: r.content_id || "",
  title: r.title,
  kind: r.kind,
  stage: r.stage,
  channel: r.channel,
  plannedAt: r.planned_at,
  state: r.state,
  url: r.url || "",
  note: r.note || "",
  createdAt: r.created_at,
});

app.get(
  "/api/plans",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const items = db
      .prepare("SELECT * FROM publish_plans WHERE brand_id=? ORDER BY planned_at, created_at")
      .all(brand.id)
      .map(mapPlan);
    res.json({
      items,
      summary: {
        total: items.length,
        warmup: items.filter((x) => x.kind === "knowledge" && x.stage === "warmup").length,
        knowledge: items.filter((x) => x.kind === "knowledge").length,
        geo: items.filter((x) => x.kind === "geo").length,
        published: items.filter((x) => x.state === "published").length,
        withUrl: items.filter((x) => x.url).length,
        // 只有「GEO 文章 + 已发布 + 已回填链接」才计入效果口径；养号内容永远不计入
        geoEffective: items.filter((x) => x.kind === "geo" && x.state === "published" && x.url).length,
        channels: [...new Set(items.map((x) => x.channel))],
      },
      defaults: {
        warmupCount: 4, ratio: 3, weeks: 4, intervalDays: 2,
        channels: ["知乎", "小红书", "公众号"],
        startDate: new Date().toISOString().slice(0, 10),
      },
    });
  })
);

/** 生成排期：只落「计划」，不代发；覆盖同品牌尚未发布的旧计划，避免重复堆积 */
/** 排期生成：路由与 Agent 工作台共用，覆盖未发布的旧计划 */
function applyPlanGeneration(brand, body = {}) {
  const articles = db
    .prepare("SELECT id, title FROM contents WHERE brand_id=? ORDER BY created_at DESC LIMIT 60")
    .all(brand.id);
  const { options, slots } = buildPlanSlots(body, articles);

  const removed = db.prepare("DELETE FROM publish_plans WHERE brand_id=? AND state='planned'").run(brand.id).changes;
  const ins = db.prepare(
    `INSERT INTO publish_plans
     (id, brand_id, content_id, title, kind, stage, channel, planned_at, state, url, note, created_at)
     VALUES (?,?,?,?,?,?,?,?,'planned','','',?)`
  );
  db.exec("BEGIN");
  try {
    for (const s of slots) {
      ins.run(id(), brand.id, s.contentId, s.title, s.kind, s.stage, s.channel, s.date, now());
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw new Error(`排期生成失败：${e.message}`);
  }
  return {
    ok: true,
    created: slots.length,
    removed,
    warmup: slots.filter((s) => s.stage === "warmup").length,
    geo: slots.filter((s) => s.kind === "geo").length,
    articlesAvailable: articles.length,
    options,
    hint: articles.length ? "" : "还没有内容文章，穿插位已临时用知识内容填充；生成文章后重新排期即可挂上 GEO 文章",
  };
}

app.post(
  "/api/plans/generate",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const brand = ownedBrand(req, req.body?.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    res.json(applyPlanGeneration(brand, req.body || {}));
  })
);

/* ---------------- Agent 工作台：一句话 → 现有能力 ---------------- */

app.get(
  "/api/agent/presets",
  requireAuth,
  wrap((req, res) => res.json({ presets: AGENT_PRESETS }))
);

/** 工作台偏好：深度模式（问答优先交给本机 pi） */
app.get(
  "/api/agent/settings",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const row = db.prepare("SELECT * FROM agent_settings WHERE brand_id=?").get(brand.id);
    res.json({ deepMode: Boolean(row?.deep_mode), updatedAt: row?.updated_at || "" });
  })
);

app.put(
  "/api/agent/settings",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const brand = ownedBrand(req, req.body?.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const deep = req.body?.deepMode ? 1 : 0;
    db.prepare(
      `INSERT INTO agent_settings (brand_id, deep_mode, updated_at) VALUES (?,?,?)
       ON CONFLICT(brand_id) DO UPDATE SET deep_mode=excluded.deep_mode, updated_at=excluded.updated_at`
    ).run(brand.id, deep, now());
    res.json({ ok: true, deepMode: Boolean(deep) });
  })
);

/** 深度模式：把检索到的资料作为上下文交给 pi，由它组织回答 */
async function answerWithAgent(brandId, text, hits = []) {
  const context = hits
    .map((h) => `【${h.docName || "企业资料"}】${String(h.text || "").slice(0, 400)}`)
    .join("\n");
  const out = await runAgent({
    brandId,
    prompt: `${
      context ? `企业资料（可引用，引用时注明文件名）：\n${context}\n\n` : ""
    }用户提问：${text}\n\n请用中文简洁回答，控制在 250 字内。涉及企业事实（价格、门店、资质、案例、客户）而资料里没有时，直接说没有相关资料，不要编造。`,
    timeoutMs: 45000,
    system:
      "你是 GEO 工作台的问答助手。只输出最终回答，不要输出思考过程、不要描述你要做什么、不要提及读取文件或调用工具。回答简洁口语化，绝不编造企业事实。",
  });
  const answer = String(out.text || "")
    .replace(/^(?:I'll|I will|Let me|I am going to)[^\n]*\n+/i, "")
    .replace(/^(?:I'll|I will|Let me)[^\n]*$/i, "")
    .trim();
  return { ok: Boolean(out.ok && answer), answer, error: out.error || "" };
}

/** 最近执行记录：回答「这次执行到底跑了什么、成功没有、耗时多少」 */
app.get(
  "/api/agent/tasks",
  requireAuth,
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const rows = db
      .prepare("SELECT * FROM agent_tasks WHERE brand_id=? ORDER BY created_at DESC LIMIT ?")
      .all(brand.id, limit);
    res.json(
      rows.map((t) => ({
        id: t.id,
        text: t.text,
        intent: t.intent,
        status: t.status,
        resultId: t.result_id || "",
        error: t.error || "",
        ms: t.ms || 0,
        createdAt: t.created_at,
      }))
    );
  })
);

app.post(
  "/api/agent/act",
  requireAuth,
  requireLevel("editor"),
  wrap(async (req, res) => {
    const b = req.body || {};
    const brand = ownedBrand(req, b.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const text = String(b.text || "").trim();
    if (!text) return res.status(400).json({ error: "请输入一句话指令" });

    const taskId = id();
    const startedAt = Date.now();
    const setting = db.prepare("SELECT deep_mode FROM agent_settings WHERE brand_id=?").get(brand.id);
    const deep = b.deep === undefined ? Boolean(setting?.deep_mode) : Boolean(b.deep);
    db.prepare(
      `INSERT INTO agent_tasks (id, brand_id, text, intent, params, status, result_id, error, ms, created_at)
       VALUES (?,?,?,'pending',?,'running','','',0,?)`
    ).run(taskId, brand.id, text, JSON.stringify({ ...(b.params || {}), deep }), now());

    const r = routeIntent(text);
    const baseFields = fieldsFor(r.intent, r.params, r.provided);

    // 界面回填的参数优先于句子解析值
    const rawOverrides = b.params && typeof b.params === "object" ? b.params : {};
    const overrides = {};
    for (const [k, v] of Object.entries(rawOverrides)) {
      if (v === "" || v === null || v === undefined) continue;
      overrides[k] = v;
    }
    const p = { ...r.params };
    for (const f of baseFields) {
      if (overrides[f.key] === undefined) continue;
      p[f.key] = f.type === "number" ? Number(overrides[f.key]) : String(overrides[f.key]);
    }
    const provided = [...new Set([...r.provided, ...Object.keys(overrides).filter((k) => baseFields.some((f) => f.key === k))])];
    const fields = fieldsFor(r.intent, p, provided);
    const pending = needsConfirm(r.intent, r.provided, overrides) && !b.confirm;

    const actions = [];
    let card = null;
    let reply = describeIntent({ ...r, params: p });

    if (r.intent === "produce") {
      const prompts = db.prepare("SELECT * FROM prompts WHERE brand_id=? ORDER BY created_at").all(brand.id);
      const q = prompts.find((x) => x.intent === p.promptIntent) || prompts[0] || null;
      const ctx = loadContext(brand.id);
      const item = buildContent(brand, ctx, q, p.genre);
      card = {
        type: "article",
        contentId: item.id,
        title: item.title,
        geos: item.geos,
        chars: item.body.length,
        factIssues: item.factIssues.length,
        compliance: item.compliance.length,
      };
      reply = `已生成《${item.title}》，GEOS ${item.geos}，${item.body.length} 字，事实回比 ${item.factIssues.length} 个问题、合规 ${item.compliance.length} 项提示。`;
      actions.push({ label: "打开内容创作", to: "/content" });
    } else if (r.intent === "schedule") {
      if (pending) {
        card = { type: "confirm", fields };
        reply = "排期会覆盖该品牌尚未发布的旧计划。请先确认这几项参数，再生成。";
      } else {
        const out = applyPlanGeneration(brand, { ...p });
        card = { type: "plan", created: out.created, warmup: out.warmup, geo: out.geo, removed: out.removed, hint: out.hint };
        reply = `已生成 ${out.created} 条排期：养号 ${out.warmup} 条、GEO 文章 ${out.geo} 条。只落计划，不代发。`;
        actions.push({ label: "查看发布排期", to: "/plan" });
      }
    } else if (r.intent === "placement") {
      const media = db.prepare("SELECT name, price, aiw FROM media ORDER BY aiw DESC").all();
      const budget = p.budget;
      const picks = [];
      let used = 0;
      for (const m of media) {
        const price = Number(m.price) || 0;
        if (price <= 0 || used + price > budget) continue;
        picks.push({ name: m.name, price, aiw: m.aiw });
        used += price;
        if (picks.length >= 6) break;
      }
      card = { type: "placement", budget, picks, total: used, remaining: budget - used, candidates: media.length };
      reply = `按 ${budget} 元预算挑了 ${picks.length} 家媒体，合计 ${used} 元，剩余 ${budget - used} 元；不会自动下单。`;
      actions.push({ label: "去媒体分发", to: "/media" });
    } else if (r.intent === "analyze") {
      const rows = db
        .prepare("SELECT * FROM metrics_daily WHERE brand_id=? ORDER BY date DESC LIMIT 2")
        .all(brand.id);
      const latest = rows[0] || {};
      const prev = rows[1] || latest;
      const seo = db
        .prepare("SELECT * FROM seo_daily WHERE brand_id=? ORDER BY date DESC LIMIT 1")
        .get(brand.id) || {};
      const keywords = db
        .prepare("SELECT COUNT(*) c FROM seo_keywords WHERE brand_id=? AND enabled=1")
        .get(brand.id).c;
      const conflicts = db
        .prepare("SELECT COUNT(*) c FROM facts WHERE brand_id=? AND status='conflict'")
        .get(brand.id).c;
      card = {
        type: "analyze",
        avi: latest.avi ?? null,
        aviDelta: latest.avi != null ? latest.avi - (prev.avi ?? latest.avi) : null,
        mentionRate: latest.mention_rate ?? null,
        samples: latest.samples ?? 0,
        exposureRate: seo.exposure_rate ?? null,
        exposureSource: seo.source || "none",
        keywords,
        conflicts,
      };
      reply = `最新 AVI ${card.avi ?? "—"}，提及率 ${card.mentionRate ?? "—"}%，样本 ${card.samples}；SEO 曝光率 ${card.exposureRate ?? "—"}%（来源 ${card.exposureSource}），关键词 ${keywords} 个、事实冲突 ${conflicts} 处。`;
      actions.push({ label: "看监测复盘", to: "/monitor" }, { label: "看 SEO 看板", to: "/seo" });
    } else if (r.intent === "profile") {
      card = { type: "profile", params: p };
      reply = p.name
        ? `已解析：${p.name} / ${p.city || "城市待填"} / ${p.industry || "行业待填"}，去向导确认后创建。`
        : "没解析到品牌信息。可以在下面补齐名称、城市与行业，或点「去建档向导」。";
      actions.push({ label: "去建档向导", to: "/wizard" });
    } else if (r.intent === "greet") {
      if (deep) {
        const ans = await answerWithAgent(brand.id, text);
        if (ans.ok) {
          reply = "（深度模式）你好，我在。有什么可以帮你的？";
          card = { type: "answer", hits: [], text: ans.answer, deep: true, generated: true };
        } else {
          reply = "深度模式调用智能体失败，已回到默认引导。";
          card = { type: "presets", presets: AGENT_PRESETS };
        }
      } else {
        reply = [
          "你好，我是这个工作台的入口。可以直接说要做的事，比如：",
          "· 给 AgentFlow 生成一篇比较类文章",
          "· 按 4 条养号、3:1 穿插生成 4 周排期",
          "· 8000 元预算，投 AI 行业媒体",
          "· 看一下现在的 AI 可见度和缺口",
          "也可以问企业资料里的问题，我会检索并标来源；资料里没有的通用问题，我会调用智能体回答，并标注「未引用企业资料」。",
        ].join("\n");
        card = { type: "presets", presets: AGENT_PRESETS };
      }
    } else {
      // 非任务输入：先在企业资料里检索；命中就引用，没命中交给智能体回答（明确标注非企业资料）
      let hits = [];
      try {
        const raw = kbSearch.buildContext(brand.id, text, 8).hits || [];
        hits = selectAnswerHits(text, raw, 4);
      } catch {
        hits = [];
      }

      if (deep) {
        const ans = await answerWithAgent(brand.id, text, hits);
        if (ans.ok) {
          reply = hits.length
            ? "（深度模式）已结合企业资料回答："
            : "（深度模式）企业资料未命中，以下是通用回答：";
          card = { type: "answer", hits: [], text: ans.answer, deep: true, generated: !hits.length };
        } else {
          reply = `深度模式未返回内容${ans.error ? `（${ans.error}）` : ""}。可以关闭深度模式再试，或先把资料传到「文档与检索」。`;
          card = { type: "answer", hits: [] };
        }
      } else if (hits.length) {
        card = {
          type: "answer",
          hits: hits.map((h) => ({
            text: String(h.text || "").slice(0, 160),
            docName: h.docName || "",
          })),
        };
        reply = `在企业资料里找到 ${hits.length} 段相关内容：`;
      } else {
        const st = agentStatus();
        if (st.available) {
          const out = await runAgent({
            brandId: brand.id,
            prompt: `用户提问：${text}\n\n请用中文简洁回答，控制在 200 字内。涉及企业事实（价格、门店、资质、案例、客户）而资料里没有时，直接说没有相关资料，不要编造。`,
            timeoutMs: 45000,
            system:
              "你是 GEO 工作台的问答助手。只输出最终回答，不要输出思考过程、不要描述你要做什么、不要提及读取文件或调用工具。回答简洁口语化，绝不编造企业事实。",
          });
          if (out.ok && String(out.text || "").trim()) {
            const answer = String(out.text)
              .replace(/^(?:I'll|I will|Let me|I am going to)[^\n]*\n+/i, "")
              .replace(/^(?:I'll|I will|Let me)[^\n]*$/i, "")
              .trim();
            reply = "企业资料里没有相关内容，以下是通用回答（未引用企业资料，企业事实请以知识库为准）：";
            card = { type: "answer", hits: [], text: answer, generated: true };
          } else {
            reply = `智能体没有返回内容${out.error ? `（${out.error}）` : ""}。可以先把资料传到「文档与检索」，或点下面的预设指令。`;
            card = { type: "answer", hits: [] };
          }
        } else {
          reply = "企业知识库里没有检索到相关资料，本机智能体也不可用（未安装或未配置 pi）。可以先把文档传到「文档与检索」。";
          card = { type: "answer", hits: [] };
        }
      }
    }

    db.prepare("UPDATE agent_tasks SET intent=?, status='done', result_id=?, ms=? WHERE id=?").run(
      r.intent,
      card && card.type === "article" ? card.contentId : "",
      Date.now() - startedAt,
      taskId
    );

    res.json({
      ok: true,
      taskId,
      intent: r.intent,
      label: r.label,
      reply,
      card,
      actions,
      presets: AGENT_PRESETS,
      fields,
      needsConfirm: pending,
    });
  })
);

app.patch(
  "/api/plans/:id",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const b = req.body || {};
    const brand = ownedBrand(req, b.brandId || req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const row = db.prepare("SELECT * FROM publish_plans WHERE id=? AND brand_id=?").get(req.params.id, brand.id);
    if (!row) return res.status(404).json({ error: "排期不存在" });
    const pick = (k, col) => (b[k] !== undefined ? b[k] : row[col]);
    const kind = ["knowledge", "geo"].includes(pick("kind", "kind")) ? pick("kind", "kind") : row.kind;
    const stage = ["warmup", "mixed"].includes(pick("stage", "stage")) ? pick("stage", "stage") : row.stage;
    const state = ["planned", "published", "skipped"].includes(pick("state", "state")) ? pick("state", "state") : row.state;
    db.prepare(
      `UPDATE publish_plans SET title=?, kind=?, stage=?, channel=?, planned_at=?, state=?, note=? WHERE id=?`
    ).run(
      String(pick("title", "title") || "").slice(0, 120),
      kind,
      stage,
      String(pick("channel", "channel") || "").slice(0, 40),
      String(pick("plannedAt", "planned_at") || row.planned_at).slice(0, 10),
      state,
      String(pick("note", "note") || "").slice(0, 200),
      row.id
    );
    res.json(mapPlan(db.prepare("SELECT * FROM publish_plans WHERE id=?").get(row.id)));
  })
);

app.delete(
  "/api/plans/:id",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const brand = ownedBrand(req, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const out = db.prepare("DELETE FROM publish_plans WHERE id=? AND brand_id=?").run(req.params.id, brand.id);
    if (!out.changes) return res.status(404).json({ error: "排期不存在" });
    res.json({ ok: true });
  })
);

/** 人工回填真实发布链接：写回排期，并同步进链接资产台账（去重） */
app.post(
  "/api/plans/:id/publish",
  requireAuth,
  requireLevel("editor"),
  wrap((req, res) => {
    const b = req.body || {};
    const brand = ownedBrand(req, b.brandId || req.query.brandId);
    if (!brand) return res.status(404).json({ error: "品牌不存在" });
    const row = db.prepare("SELECT * FROM publish_plans WHERE id=? AND brand_id=?").get(req.params.id, brand.id);
    if (!row) return res.status(404).json({ error: "排期不存在" });
    const url = normalizeLink(b.url);
    if (!url) return res.status(400).json({ error: "请填写真实发布链接（http/https）" });
    db.prepare("UPDATE publish_plans SET state='published', url=?, note=? WHERE id=?").run(
      url, String(b.note || row.note || "").slice(0, 200), row.id
    );
    const linked = db
      .prepare(
        `INSERT OR IGNORE INTO link_assets
         (id, brand_id, url, host, kind, title, content_id, published_at, source, status, created_at)
         VALUES (?,?,?,?,?,?,?,?,'plan','unknown',?)`
      )
      .run(
        id(), brand.id, url, hostOf(url), "article", row.title, row.content_id || "",
        new Date().toISOString().slice(0, 10), now()
      ).changes > 0;
    res.json({ ok: true, url, linked });
  })
);

/* ---------------- 启动 ---------------- */

seed();
migrate();
startSeoScheduler();

app.use((req, res) => res.status(404).json({ error: `未实现的接口：${req.method} ${req.path}` }));

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[server] http://127.0.0.1:${PORT}  mode=${mode()}`);
  console.log(`[server] 演示账号 ${DEMO_PHONE} / ${DEMO_PASSWORD}`);
});
