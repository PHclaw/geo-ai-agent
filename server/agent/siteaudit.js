/* ============================================================
   站点体检：判断"AI 能不能读懂并引用这个站"
   8 项检查，全部真抓真判，不编分数
   ============================================================ */
import { load } from "cheerio";

const UA_BROWSER =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export const AI_BOTS = {
  GPTBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.0; +https://openai.com/gptbot)",
  ClaudeBot: "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  PerplexityBot: "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
};

export function normalizeUrl(input) {
  let u = String(input || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    const url = new URL(u);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

async function grab(url, { ua = UA_BROWSER, timeout = 12000 } = {}) {
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
    return { ok: res.ok, status: res.status, text, type, finalUrl: res.url };
  } catch (e) {
    return { ok: false, status: 0, text: "", error: e.name === "AbortError" ? "超时" : String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

/** 解析 robots.txt：判断某 bot 是否被禁止抓取根路径 */
export function robotsDenies(robotsText, bot) {
  if (!robotsText) return false;
  const groups = [];
  let cur = null;
  for (const raw of robotsText.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || cur.rules.length) {
        cur = { agents: [val.toLowerCase()], rules: [] };
        groups.push(cur);
      } else {
        cur.agents.push(val.toLowerCase());
      }
    } else if ((key === "disallow" || key === "allow") && cur) {
      cur.rules.push({ type: key, path: val });
    }
  }
  const target = String(bot).toLowerCase();
  const exact = groups.filter((g) => g.agents.some((a) => a === target));
  const use = exact.length ? exact : groups.filter((g) => g.agents.some((a) => a === "*"));
  return use.some((g) => g.rules.some((r) => r.type === "disallow" && (r.path === "/" || r.path === "")));
}

const countCjk = (s) => (String(s || "").match(/[\u4e00-\u9fff]/g) || []).length;

export async function auditSite(rawUrl) {
  const origin = normalizeUrl(rawUrl);
  if (!origin) throw new Error("网址不合法，请填写如 example.com 或 https://example.com");

  const [page, robotsTxt, llmsTxt, sitemap] = await Promise.all([
    grab(origin),
    grab(`${origin}/robots.txt`),
    grab(`${origin}/llms.txt`),
    grab(`${origin}/sitemap.xml`),
  ]);

  if (!page.ok) {
    throw new Error(`首页无法访问（${page.error || `HTTP ${page.status}`}），请确认网址可公开访问`);
  }

  const $ = load(page.text);
  const title = ($("title").first().text() || "").trim();
  const desc = ($('meta[name="description"]').attr("content") || "").trim();
  const h1s = $("h1").map((_, el) => $(el).text().trim()).get().filter(Boolean);
  const h2s = $("h2").map((_, el) => $(el).text().trim()).get().filter(Boolean);

  const jsonLdTypes = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).contents().text());
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

  const paragraphs = $("p")
    .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
    .get()
    .filter((t) => t.length > 0);
  const quotable = paragraphs.filter((t) => countCjk(t) >= 40).length;
  const quotableRate = paragraphs.length ? quotable / paragraphs.length : 0;

  /* 爬虫可达性：分别用三家 AI 爬虫 UA 打首页 */
  const botProbe = {};
  await Promise.all(
    Object.entries(AI_BOTS).map(async ([name, ua]) => {
      const r = await grab(origin, { ua, timeout: 10000 });
      botProbe[name] = { status: r.status, ok: r.ok };
    })
  );
  const blockedBots = Object.entries(botProbe).filter(([, v]) => !v.ok).map(([k]) => k);

  const robotsText = robotsTxt.ok ? robotsTxt.text : "";
  const robotsIsHtml = /^\s*<!doctype html|^\s*<html/i.test(robotsText);
  const robotsBlockedBots = robotsIsHtml ? [] : Object.keys(AI_BOTS).filter((b) => robotsDenies(robotsText, b));

  // 防“假 200”：静态服务器会把 404 回退到首页，导致 llms/sitemap 看似存在
  const llmsIsHtml = /^\s*<!doctype html|^\s*<html/i.test(llmsTxt.text || "");
  const llmsLooksValid = llmsTxt.ok && !llmsIsHtml && /(^|\n)\s*#\s/.test(llmsTxt.text || "");

  const smText = sitemap.text || "";
  const smIsXml = /<urlset|<sitemapindex/i.test(smText);
  const sitemapCount = sitemap.ok && smIsXml ? (smText.match(/<loc>/g) || []).length : 0;

  const semanticTypes = ["LocalBusiness", "Organization", "ProfessionalService", "HomeAndConstructionBusiness", "Store", "Restaurant", "Product", "FAQPage", "Article", "Service"];
  const hasSemantic = jsonLdTypes.some((t) => semanticTypes.includes(t));

  // 可见正文：排除 script/style，衡量“AI 爬虫不执行 JS 时到底看得到什么”
  const visibleText = $("body").clone().find("script,style,noscript,template").remove().end().text();
  const readableChars = visibleText.replace(/\s+/g, "").length;
  const looksSpa =
    readableChars < 300 &&
    ($("script").length >= 2 ||
      $('script[type="module"]').length > 0 ||
      $("#root, #app").length > 0 ||
      /__NEXT_DATA__|__NUXT__|__remixContext/i.test(page.text));

  const checks = [
    {
      key: "crawler",
      label: "AI 爬虫可访问",
      level: blockedBots.length === 0 ? "pass" : blockedBots.length === Object.keys(AI_BOTS).length ? "fail" : "warn",
      detail:
        blockedBots.length === 0
          ? `GPTBot / ClaudeBot / PerplexityBot 均返回 ${Object.values(botProbe)[0].status}`
          : `${blockedBots.join("、")} 访问被拒（${blockedBots.map((b) => botProbe[b].status).join("/")}）`,
      fix: "如果你的 CDN / WAF 开了机器人拦截，需要在白名单放行这些 UA，否则 AI 永远读不到你的站",
    },
    {
      key: "robots",
      label: "robots.txt 是否放行 AI",
      level: robotsIsHtml ? "warn" : robotsBlockedBots.length === 0 ? "pass" : "fail",
      detail: robotsIsHtml
        ? "访问 /robots.txt 返回的是网页（404 回退），实际没有 robots.txt（默认允许）"
        : !robotsText
          ? "没有 robots.txt（默认允许，可接受）"
          : robotsBlockedBots.length
            ? `robots.txt 明确禁止：${robotsBlockedBots.join("、")}`
            : "未禁止 AI 爬虫",
      fix: "删除针对 GPTBot / ClaudeBot 的 Disallow: /，或单独为它们写 Allow",
    },
    {
      key: "content",
      label: "可见正文（AI 不执行 JS）",
      level: readableChars >= 300 ? "pass" : readableChars >= 100 ? "warn" : "fail",
      detail: looksSpa
        ? `HTML 中可见正文仅 ${readableChars} 字，且检测到前端框架特征——AI 爬虫看到的是空壳`
        : `HTML 中可见正文 ${readableChars} 字`,
      fix: looksSpa
        ? "改用 SSR/预渲染（Next.js SSR、Nuxt SSR 或静态导出），否则爬虫只拿到一个空 div"
        : "正文太少，建议把服务介绍与常见问答写在首屏 HTML 里",
    },
    {
      key: "llms",
      label: "llms.txt",
      level: llmsLooksValid ? "pass" : llmsTxt.ok && !llmsIsHtml ? "warn" : "fail",
      detail: llmsIsHtml
        ? "访问 /llms.txt 返回的是网页（服务器把 404 回退到首页），实际没有这个文件"
        : !llmsTxt.ok
          ? "缺失（AI 只能靠猜你的业务）"
          : llmsLooksValid
            ? `存在，约 ${llmsTxt.text.length} 字符`
            : `存在但内容不像 llms.txt（${llmsTxt.text.length} 字符，无标题行）`,
      fix: "用本页「生成资产」一键生成 llms.txt，放到站点根目录；并确保静态服务器不对 .txt 做首页回退",
    },
    {
      key: "sitemap",
      label: "sitemap.xml",
      level: sitemapCount > 0 ? "pass" : smIsXml ? "warn" : "fail",
      detail: smIsXml
        ? sitemapCount
          ? `${sitemapCount} 个 URL`
          : "是 sitemap 但没有任何 <loc>"
        : sitemap.ok
          ? "访问 /sitemap.xml 返回的不是 XML（很可能是首页回退）"
          : "缺失",
      fix: "生成站点地图并在 robots.txt 里用 Sitemap: 声明；SPA 需静态输出 sitemap 文件",
    },
    {
      key: "schema",
      label: "结构化数据（JSON-LD）",
      level: hasSemantic ? "pass" : jsonLdTypes.length ? "warn" : "fail",
      detail: jsonLdTypes.length ? `已检测到：${[...new Set(jsonLdTypes)].join("、")}` : "没有任何 JSON-LD",
      fix: "至少加上 LocalBusiness（名称/地址/电话/营业时间/价格区间）与 FAQPage",
    },
    {
      key: "headings",
      label: "标题层级",
      level: h1s.length === 1 ? "pass" : h1s.length === 0 ? "fail" : "warn",
      detail: `H1 ${h1s.length} 个${h1s[0] ? `（${h1s[0].slice(0, 24)}）` : ""}，H2 ${h2s.length} 个`,
      fix: "每页只保留一个 H1，用小标题拆成可摘取的段落",
    },
    {
      key: "quotable",
      label: "可引用段落",
      level: quotableRate >= 0.3 ? "pass" : quotableRate > 0 ? "warn" : "fail",
      detail: `${paragraphs.length} 个段落中，${quotable} 个可独立引用（≥40 字）`,
      fix: "把卖点写成带数字的完整句子，而不是短语标签——AI 摘取的是句子",
    },
    {
      key: "meta",
      label: "标题与描述",
      level: title && desc ? "pass" : title || desc ? "warn" : "fail",
      detail: `title ${title ? `${title.length} 字` : "缺失"}，description ${desc ? `${desc.length} 字` : "缺失"}`,
      fix: "title 写清「城市 + 服务 + 品牌」，description 写成一句可被引用的事实句",
    },
  ];

  const passed = checks.filter((c) => c.level === "pass").length;
  const score = Math.round((passed / checks.length) * 100);

  return {
    url: origin,
    fetchedAt: new Date().toISOString(),
    score,
    grade: score >= 75 ? "良好" : score >= 50 ? "尚可" : "偏低",
    passed,
    total: checks.length,
    checks,
    facts: {
      title,
      desc,
      h1: h1s[0] || "",
      h2Count: h2s.length,
      paragraphs: paragraphs.length,
      quotable,
      jsonLdTypes: [...new Set(jsonLdTypes)],
      bots: botProbe,
      robotsTxt: Boolean(robotsText) && !robotsIsHtml,
      llmsTxt: llmsLooksValid,
      sitemapUrls: sitemapCount,
      readableChars,
      looksSpa,
    },
  };
}
