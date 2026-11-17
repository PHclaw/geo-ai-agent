/* ============================================================
   链接资产工具：URL 规范化、存活巡检、信源/引用统计
   - 巡检是真实 HTTP 请求，不需要任何 Key
   - 引用统计区分「真实探测/C 端取证」与「模拟」，模拟不计入效果
   ============================================================ */
import { hostOf } from "./seo.js";

const URL_RE = /https?:\/\/[^\s)"'<>，。；、]+/gi;
const DOMAIN_RE = /\b(?:[a-z0-9-]+\.)+(?:com|cn|net|org|io|ai|xyz|co|me|dev|app|top|site|tech|online|gov|edu)\b/gi;

/** 规范化并校验 URL；非法返回空串 */
export function normalizeLink(raw) {
  let s = String(raw || "").trim();
  if (!s) return "";
  if (/^(?:javascript|data|file|ftp|mailto|tel):/i.test(s)) return "";
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol)) return "";
    return u.href;
  } catch {
    return "";
  }
}

/** 从一段文本（AI 答案、取证原文）里提取域名，兼容完整 URL 与裸域名 */
export function extractHosts(text) {
  const s = String(text || "");
  const out = new Set();
  for (const m of s.match(URL_RE) || []) {
    const h = hostOf(m);
    if (h) out.add(h.toLowerCase());
  }
  for (const m of s.match(DOMAIN_RE) || []) out.add(m.toLowerCase());
  return [...out];
}

/** 真发一次 HTTP 请求检查链接存活；HEAD 不被支持时降级 GET */
export async function checkLink(url, timeoutMs = 8000) {
  const started = Date.now();
  const attempt = async (method) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        redirect: "follow",
        signal: ctrl.signal,
        headers: { "User-Agent": "GEO-LinkCheck/1.0 (local audit)" },
      });
      if (method !== "HEAD" && res.body?.cancel) await res.body.cancel().catch(() => {});
      return { status: res.status, ok: res.ok };
    } catch (e) {
      return { status: 0, ok: false, error: e?.name === "AbortError" ? "超时" : String(e?.message || e) };
    } finally {
      clearTimeout(timer);
    }
  };

  let r = await attempt("HEAD");
  if (!r.ok && (r.status === 0 || r.status === 405 || r.status === 501 || r.status === 403)) {
    r = await attempt("GET");
  }
  return {
    ok: Boolean(r.ok),
    status: r.status,
    error: r.error || (r.ok ? "" : `HTTP ${r.status}`),
    ms: Date.now() - started,
  };
}

const bump = (map, host) => map.set(host, (map.get(host) || 0) + 1);

/**
 * 统计「AI 答案里引用了哪些域名」。
 * citations 字段历史上一直写空数组，因此兜底从 answer 正文解析。
 * 只有 source=live 或 C 端取证（channel 以 cend 开头）计入 real，模拟样本单列。
 */
export function citationCounts(db, brandId) {
  const rows = db
    .prepare(
      "SELECT answer, citations, source, channel FROM probe_results WHERE brand_id=? ORDER BY created_at DESC LIMIT 3000"
    )
    .all(brandId);
  const real = new Map();
  const mock = new Map();

  for (const r of rows) {
    let hosts = [];
    try {
      const parsed = JSON.parse(r.citations || "[]");
      if (Array.isArray(parsed)) hosts = parsed.map(String);
    } catch {
      /* 忽略脏 JSON */
    }
    if (!hosts.length) hosts = extractHosts(r.answer);

    const normalized = [
      ...new Set(
        hosts
          .map((h) => hostOf(/^https?:\/\//i.test(h) ? h : `https://${h}`))
          .filter(Boolean)
      ),
    ];
    const isReal = r.source === "live" || String(r.channel || "").startsWith("cend");
    for (const h of normalized) bump(isReal ? real : mock, h);
  }
  return { real, mock };
}

/** 搜索结果命中过的落地页域名（只有 live 通道才有值） */
export function serpHitCounts(db, brandId) {
  const rows = db.prepare("SELECT url FROM seo_results WHERE brand_id=? AND url!=''").all(brandId);
  const map = new Map();
  for (const r of rows) {
    const h = hostOf(r.url);
    if (h) bump(map, h);
  }
  return map;
}
