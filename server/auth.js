import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import { db } from "./db.js";

const SECRET = process.env.GEO_TOKEN_SECRET || "geo-dev-secret-change-in-production";
const TTL_MS = 30 * 24 * 3600 * 1000;

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  const a = Buffer.from(scryptSync(password, salt, 64).toString("hex"), "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const b64 = (s) => Buffer.from(s).toString("base64url");

export function signToken(payload) {
  const body = { ...payload, exp: Date.now() + TTL_MS };
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const data = `${head}.${b64(JSON.stringify(body))}`;
  const sig = createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyToken(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [head, payload, sig] = parts;
  const expect = createHmac("sha256", SECRET).update(`${head}.${payload}`).digest("base64url");
  if (sig !== expect) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!body.exp || body.exp < Date.now()) return null;
    return body;
  } catch {
    return null;
  }
}

/** 从请求头解析用户，挂到 req.user */
export function requireAuth(req, res, next) {
  const raw = req.headers.authorization || "";
  const token = raw.startsWith("Bearer ") ? raw.slice(7) : "";
  const claims = verifyToken(token);
  if (!claims) return res.status(401).json({ error: "未登录或登录已过期" });

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(claims.uid);
  if (!user) return res.status(401).json({ error: "用户不存在" });

  const tenant = db.prepare("SELECT * FROM tenants WHERE id = ?").get(user.tenant_id);
  req.user = user;
  req.tenant = tenant;
  next();
}

/** 平台运营专用：人工代投的执行人 */
export function requireOps(req, res, next) {
  if (req.user?.role !== "ops") return res.status(403).json({ error: "需要平台运营权限" });
  next();
}

/** 角色权重：owner > editor > viewer；ops 为平台方独立角色 */
export const ROLE_LEVEL = { owner: 3, editor: 2, viewer: 1, ops: 0 };

/** 至少具备某个角色级别才放行，用于写操作 */
export function requireLevel(minRole) {
  return (req, res, next) => {
    const lv = ROLE_LEVEL[req.user?.role] ?? 0;
    if (lv < (ROLE_LEVEL[minRole] ?? 99)) {
      return res.status(403).json({
        error: `当前角色无权执行此操作（需要${minRole === "owner" ? "负责人" : "编辑"}权限）`,
        role: req.user?.role || "viewer",
      });
    }
    next();
  };
}

/** 价格类属性：只允许 owner 修改（属性名中英文关键词 + 金额值三重判定，防止绕过） */
export function isPriceAttr(attr, value = "") {
  const a = String(attr || "").toLowerCase();
  const v = String(value || "");
  const cn = /价格|人均|报价|费用|优惠|折扣|单价|总价|均价/.test(a);
  const en = /price|cost|fee|amount|rate|discount/.test(a);
  const money = /[¥￥$€]|\d+\s*(元|万元|元\/㎡|元每平)/.test(v);
  return cn || en || money;
}

/** 写审计日志 */
export function audit(req, action, objectType, objectId, detail = "") {
  try {
    db.prepare(
      `INSERT INTO audit_logs (id, tenant_id, user_id, user_name, action, object_type, object_id, detail, ip, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(
      randomBytes(8).toString("hex"),
      req.tenant?.id || "",
      req.user?.id || "",
      req.user?.name || req.user?.phone || "",
      action,
      objectType,
      String(objectId || ""),
      String(detail).slice(0, 500),
      req.ip || "",
      new Date().toISOString()
    );
  } catch (e) {
    console.error("[audit] failed", e.message);
  }
}

/** 校验品牌归属当前租户，返回品牌或 404 */
export function ownedBrand(req, brandId) {
  return db.prepare("SELECT * FROM brands WHERE id = ? AND tenant_id = ?").get(brandId, req.tenant.id);
}
