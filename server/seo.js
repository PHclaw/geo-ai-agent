/* ============================================================
   SEO 曝光率模块
   三路数据源，全部标注来源，绝不把「没数据」写成 0：
     site   —— 真抓目标站（首页 / robots.txt / sitemap.xml / 搜索爬虫 UA），判定可索引性
     live   —— 可选搜索 API（SerpAPI 或 Bing Web Search），查关键词排名与 site: 收录数
     manual —— 手工录入 GSC / 百度站长平台导出的真实展现量、点击、收录数
   指标口径：曝光率 = 进入搜索结果前 20 位的关键词数 ÷ 启用关键词数 × 100
   ============================================================ */
import { load } from "cheerio";
import { normalizeUrl } from "./agent/siteaudit.js";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/** 传统搜索爬虫（与 siteaudit.js 的 AI 爬虫分开，口径不同） */
export const SEARCH_BOTS = {
  Baiduspider: "Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)",
  Googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  Bingbot: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
};

/** 运行时读取配置：loadEnv() 在 index.js 里执行，禁止在模块顶层缓存 */
export function searchConfig() {
  const key = process.env.GEO_SEO_SEARCH_KEY || "";
  const base = process.env.GEO_SEO_SEARCH_BASE || "";
  const engine = process.env.GEO_SEO_SEARCH_ENGINE || "google";
  return { key, base, engine, live: Boolean(key && base), provider: /serpapi/i.test(base) ? "serpapi" : "bing" };
}

async function grab(url, { ua = BROWSER_UA, timeout = 10000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": ua, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    const type = res.headers.get("content-type") || "";
    const text = /text|xml|json/i.test(type) ? await res.text() : "";
    return { ok: res.ok, status: res.status, text, type };
  } catch (e) {
    return { ok: false, status: 0, text: "", error: e?.name === "AbortError" ? "超时" : String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

const isHtml = (t) => /^\s*<!doctype html|^\s*<html/i.test(t || "");
const cjk = (s) => (String(s || "").match(/[\u4e00-\u9fff]/g) || []).length;
const isNoIndex = (robotsText) => /noindex/i.test(robotsText || "");
const rootBlocked = (robotsText) => /disallow\s*:\s*\/\s*$/im.test(robotsText || "");

/**
 * 站点可索引性体检：只依赖真实 HTTP 抓取，不需要任何 Key。
 * 返回 score(0-100) / checks(明细) / facts(原始事实)
 */
export async function scanTarget(rawUrl) {
  const origin = normalizeUrl(rawUrl);
  if (!origin) throw new Error("网址不合法，请填写如 example.com 或 http://127.0.0.1:3000");

  const [home, robots, sitemap] = await Promise.all([
    grab(origin),
    grab(`${origin}/robots.txt`),
    grab(`${origin}/sitemap.xml`),
  ]);
  if (!home.ok) throw new Error(`首页无法访问（${home.error || `HTTP ${home.status}`}），请确认网址可公开访问`);

  const $ = load(home.text);
  const jsonLdTypes = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).contents().text() || "{}");
      const walk = (node) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(walk);
        if (node["@type"]) jsonLdTypes.push(String(node["@type"]));
        if (node["@graph"]) walk(node["@graph"]);
      };
      walk(data);
    } catch {
      /* 无效 JSON-LD 忽略 */
    }
  });

  $("script, style, noscript").remove();
  const title = ($("title").first().text() || "").trim();
  const description = ($('meta[name="description"]').attr("content") || "").trim();
  const h1 = ($("h1").first().text() || "").trim();
  const metaRobots = ($('meta[name="robots"]').attr("content") || "").trim();
  const canonical = ($('link[rel="canonical"]').attr("href") || "").trim();
  const bodyText = ($("body").text() || "").replace(/\s+/g, " ").trim();
  const visibleChars = cjk(bodyText);
  const links = $("a[href]").length;

  const botProbe = {};
  await Promise.all(
    Object.entries(SEARCH_BOTS).map(async ([name, ua]) => {
      const r = await grab(origin, { ua, timeout: 9000 });
      botProbe[name] = r.ok;
    })
  );

  const robotsValid = robots.ok && !isHtml(robots.text);
  const robotsBlock = robotsValid && (rootBlocked(robots.text) || isNoIndex(robots.text));
  const sitemapValid = sitemap.ok && !isHtml(sitemap.text) && /<urlset|<loc/i.test(sitemap.text);
  const sitemapUrls = sitemapValid ? (sitemap.text.match(/<loc>/gi) || []).length : 0;
  const botOkCount = Object.values(botProbe).filter(Boolean).length;
  const looksSpa = visibleChars < 100;

  const checks = [];
  const add = (key, label, level, detail) => checks.push({ key, label, level, detail });

  add("reachable", "首页可访问", "pass", `HTTP ${home.status} · ${origin}`);
  add(
    "title",
    "页面标题",
    title.length >= 8 ? "pass" : title ? "warn" : "fail",
    title ? `「${title.slice(0, 40)}」` : "缺少 <title>，搜索结果无法生成有效标题"
  );
  add(
    "description",
    "页面描述",
    description.length >= 30 ? "pass" : description ? "warn" : "fail",
    description ? `${description.length} 字` : "缺少 meta description"
  );
  add("h1", "H1 主标题", h1 ? "pass" : "fail", h1 ? `「${h1.slice(0, 40)}」` : "缺少 H1，主题信号弱");
  add(
    "body",
    "首屏可见正文",
    visibleChars >= 200 ? "pass" : visibleChars >= 100 ? "warn" : "fail",
    `中文正文 ${visibleChars} 字${looksSpa ? " · 疑似纯前端渲染（SPA），爬虫拿到空白页" : ""}`
  );
  add(
    "robots",
    "robots.txt",
    !robotsValid ? "fail" : robotsBlock ? "fail" : "pass",
    !robotsValid
      ? `返回 ${robots.status}${robots.ok ? " 但是 HTML（SPA 404 回退，假 200）" : ""}，搜索引擎读不到规则`
      : robotsBlock
        ? "存在 Disallow: / 或 noindex，全站禁止抓取"
        : "真实文本，未禁止抓取"
  );
  add(
    "sitemap",
    "sitemap.xml",
    !sitemapValid ? "fail" : sitemapUrls > 0 ? "pass" : "warn",
    !sitemapValid
      ? `返回 ${sitemap.status}${sitemap.ok ? " 但是 HTML（SPA 404 回退，假 200）" : ""}，无法发现页面`
      : `声明 ${sitemapUrls} 个 URL`
  );
  add(
    "bots",
    "搜索爬虫可达",
    botOkCount >= 2 ? "pass" : botOkCount === 1 ? "warn" : "fail",
    `${botOkCount}/3 可达（${Object.entries(botProbe).map(([k, v]) => `${k}:${v ? "ok" : "blocked"}`).join(" · ")}）`
  );
  add(
    "jsonld",
    "结构化数据",
    jsonLdTypes.length ? "pass" : "warn",
    jsonLdTypes.length ? jsonLdTypes.slice(0, 4).join(" / ") : "无 JSON-LD，缺少实体与 FAQ 结构化信号"
  );
  if (metaRobots && isNoIndex(metaRobots)) {
    add("metaRobots", "meta robots", "fail", `页面声明 ${metaRobots}`);
  }

  const WEIGHT = {
    reachable: 6, title: 12, description: 12, h1: 10, body: 22,
    robots: 14, sitemap: 14, bots: 10, jsonld: 6, metaRobots: 4,
  };
  const totalWeight = checks.reduce((s, c) => s + (WEIGHT[c.key] || 0), 0);
  const gained = checks.reduce(
    (s, c) => s + (WEIGHT[c.key] || 0) * (c.level === "pass" ? 1 : c.level === "warn" ? 0.5 : 0),
    0
  );
  const score = Math.round((gained / totalWeight) * 100);
  const grade = score >= 80 ? "良好" : score >= 60 ? "待改进" : score >= 40 ? "较差" : "严重不足";

  return {
    url: origin,
    score,
    grade,
    passed: checks.filter((c) => c.level === "pass").length,
    total: checks.length,
    checks,
    facts: {
      title, description, h1, canonical, metaRobots,
      visibleChars, links, looksSpa, jsonLdTypes,
      robotsStatus: robots.status, robotsValid,
      sitemapStatus: sitemap.status, sitemapValid, sitemapUrls,
      botProbe, htmlBytes: home.text.length,
    },
  };
}

/**
 * 搜索结果查询。未配置 Key 时返回 available:false，调用方不得据此编造排名。
 * 兼容 SerpAPI（/search.json）与 Bing Web Search v7（/v7.0/search）。
 */
export async function querySerp(keyword, engine = "google") {
  const cfg = searchConfig();
  if (!cfg.live) return { available: false, reason: "unconfigured", items: [], total: null };

  const url = new URL(cfg.base);
  url.searchParams.set("q", keyword);
  const headers = {};
  if (cfg.provider === "serpapi") {
    url.searchParams.set("api_key", cfg.key);
    url.searchParams.set("engine", cfg.engine || engine);
  } else {
    headers["Ocp-Apim-Subscription-Key"] = cfg.key;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) return { available: true, error: `HTTP ${res.status}`, items: [], total: null };
    const data = await res.json();
    const raw = data.organic_results || data.webPages?.value || data.results || data.items || [];
    const items = (Array.isArray(raw) ? raw : [])
      .map((x) => ({ url: String(x.link || x.url || ""), title: String(x.title || x.name || ""), snippet: String(x.snippet || "") }))
      .filter((x) => x.url);
    const total = data.search_metadata?.total_results ?? data.webPages?.totalEstimatedMatches ?? null;
    return { available: true, items, total: Number.isFinite(Number(total)) ? Number(total) : null, engine: cfg.engine || engine };
  } catch (e) {
    return { available: true, error: e?.name === "AbortError" ? "超时" : String(e?.message || e), items: [], total: null };
  } finally {
    clearTimeout(timer);
  }
}

/** site: 查询得到的收录数（只有 live 通道才有值） */
export async function queryIndexed(origin) {
  const host = new URL(origin).hostname;
  const r = await querySerp(`site:${host}`);
  if (!r.available) return { count: null, source: "unconfigured" };
  if (r.error) return { count: null, source: "error", error: r.error };
  const own = r.items.filter((x) => hostOf(x.url) === host);
  return { count: own.length, estimated: r.total, source: "live" };
}

export function hostOf(raw) {
  try {
    return new URL(raw).hostname;
  } catch {
    return "";
  }
}

/** 目标域名在结果列表里第一次出现的位次（1-based），0 = 未进榜 */
export function matchPosition(items, origin) {
  const host = new URL(origin).hostname;
  const i = items.findIndex((x) => hostOf(x.url) === host);
  return i < 0 ? 0 : i + 1;
}
