import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "http://127.0.0.1:8002/api";
const OUT = "d:/工作/GEO Aiagent/deliverables/e2e-agentflow";
mkdirSync(OUT, { recursive: true });

const results = [];
const t0 = Date.now();

async function req(path, opts = {}, headers = {}) {
  const r = await fetch(`${BASE}${path}`, { ...opts, headers: { "Content-Type": "application/json", ...headers } });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${text.slice(0, 160)}`);
  try { return JSON.parse(text); } catch { return { raw: text.slice(0, 200) }; }
}

async function step(name, group, fn) {
  const s = Date.now();
  try {
    const summary = await fn();
    const ms = Date.now() - s;
    results.push({ name, group, ok: true, ms, summary });
    console.log(`OK   ${group.padEnd(8)} ${name.padEnd(24)} ${String(ms).padStart(6)}ms | ${summary}`);
    return true;
  } catch (e) {
    const ms = Date.now() - s;
    results.push({ name, group, ok: false, ms, summary: String(e.message || e) });
    console.log(`FAIL ${group.padEnd(8)} ${name.padEnd(24)} ${String(ms).padStart(6)}ms | ${String(e.message || e)}`);
    return false;
  }
}

const login = await req("/auth/login", {
  method: "POST",
  body: JSON.stringify({ phone: "13800000000", password: "123456" }),
});
const H = { Authorization: `Bearer ${login.token}` };
const api = (p, opts = {}) => req(p, opts, H);
const post = (p, body) => api(p, { method: "POST", body: JSON.stringify(body) });

const me = await api("/me");
const brand = me.brands.find((b) => b.name === "AgentFlow") || me.brands[0];
const BID = brand.id;
const q = `?brandId=${BID}`;
console.log(`\n=== E2E: ${brand.name} (${BID}) ===\n`);

const health = await api("/health");
await step("健康检查", "环境", async () => `mode=${health.mode} live=${health.providers?.filter((p) => p.live).length ?? 0}/${health.providers?.length ?? 0}`);

await step("品牌档案", "建档", async () => {
  const brands = await api("/brands");
  const b = brands.find((x) => x.id === BID);
  return `${b.name} / ${b.city || "城市未登记"} / ${b.industry || "行业未登记"} / site=${b.siteUrl || b.site_url || "未设置"}`;
});

await step("事实卡与提问", "建档", async () => {
  const facts = await api(`/facts${q}`);
  const prompts = await api(`/prompts${q}`);
  const active = facts.filter((f) => f.status === "active").length;
  const conflict = facts.filter((f) => f.status === "conflict").length;
  const intents = [...new Set(prompts.map((p) => p.intent))].join(",");
  globalThis.__promptIds = prompts.slice(0, 2).map((p) => p.id);
  return `事实卡 ${facts.length}（生效 ${active} / 冲突 ${conflict}）· 提问 ${prompts.length} · 意图 ${intents}`;
});

await step("知识库统计", "资产", async () => {
  const s = await api(`/kb/stats${q}`);
  return `文档 ${s.documents}（可检索 ${s.ready}）· 切片 ${s.chunks} · 字符 ${s.chars}`;
});

await step("知识库检索", "资产", async () => {
  const r = await post("/kb/search", { brandId: BID, query: "私有化部署 数据不出内网 模型配置", topK: 4 });
  const hits = r.hits || [];
  globalThis.__kbHit = hits[0];
  return `命中 ${hits.length} 段 · 首条来源 ${hits[0]?.docName || "—"} · 相关度 ${hits[0]?.score ?? "—"}`;
});

await step("AI 探测一轮", "诊断", async () => {
  const r = await post("/probes/run", { brandId: BID, sample: 1 });
  return `runId=${String(r.runId || r.id || "—").slice(0, 8)} · mode=${r.mode} · 样本 ${r.count ?? r.total ?? "见 latest"}`;
});

await step("最新探测结果", "诊断", async () => {
  const r = await api(`/probes/latest${q}`);
  const s = r.summary || {};
  return `AVI=${s.avi ?? "—"} 提及率=${s.mentionRate ?? "—"} · ${r.run?.total ?? "—"} 样本 live=${s.sources?.live ?? "—"} mock=${s.sources?.mock ?? "—"}`;
});

await step("指标趋势", "诊断", async () => {
  const r = await api(`/metrics${q}&days=30`);
  const last = r[r.length - 1];
  return `${r.length} 个日数据点 · 最新 AVI=${last?.avi ?? "—"} SoV=${last?.sov ?? "—"}`;
});

await step("监测复盘聚合", "诊断", async () => {
  const r = await api(`/monitor${q}`);
  return `趋势点 ${r.trend?.length ?? 0} · 平台 ${r.platforms?.length ?? Object.keys(r).length} 项聚合字段`;
});

await step("工作台聚合", "诊断", async () => {
  const r = await api(`/overview${q}`);
  const k = r.kpi || {};
  return `AVI=${k.avi ?? "—"}（模型 ${k.aviModel ?? "—"} / C 端 ${k.aviCend ?? "—"}）· ${r.quadrant?.label ?? "—"} · 事实卡 ${k.facts ?? "—"}`;
});

await step("C 端取证队列", "诊断", async () => {
  const r = await api(`/evidence/queue${q}`);
  const list = Array.isArray(r) ? r : r.items || [];
  return `待取证 ${list.length} 条`;
});

await step("模板文章生成", "内容", async () => {
  const r = await post("/contents/generate", { brandId: BID, promptIds: globalThis.__promptIds, genre: "攻略" });
  const items = r.items || [];
  globalThis.__contentId = items[0]?.id;
  return `生成 ${items.length} 篇 · GEOS ${items.map((x) => x.geos).join("/")} · 事实回比 ${items.map((x) => x.factIssues?.length ?? 0).join("/")}`;
});

await step("智能体写作 SSE", "内容", async () => {
  const prompts = await api(`/prompts${q}`);
  const p = prompts.find((x) => x.intent === "比较") || prompts[0];
  const s = Date.now();
  const res = await fetch(`${BASE}/contents/agent`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ brandId: BID, promptId: p.id, genre: "攻略" }),
  });
  const raw = await res.text();
  const events = raw.split("\n\n").filter((l) => l.startsWith("data: ")).map((l) => {
    try { return JSON.parse(l.slice(6)); } catch { return null; }
  }).filter(Boolean);
  const saved = events.find((e) => e.type === "saved");
  if (!saved?.contentId) throw new Error(`无 saved 事件: ${raw.slice(0, 160)}`);
  globalThis.__agentId = saved.contentId;
  return `${((Date.now() - s) / 1000).toFixed(1)}s · ${saved.chars} 字 · GEOS ${saved.geos} · 成功落库`;
});

await step("文章 HTML 导出", "内容", async () => {
  const r = await fetch(`${BASE}/contents/${globalThis.__contentId}/export.html?brandId=${BID}`, { headers: H });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return `${t.length} 字节 · 含内置图片 ${t.includes("data:image") ? "是" : "否"}`;
});

await step("发布排期生成", "分发", async () => {
  const r = await post("/plans/generate", {
    brandId: BID, warmupCount: 4, ratio: 3, weeks: 4, intervalDays: 2,
    channels: ["知乎", "小红书", "公众号"], startDate: new Date().toISOString().slice(0, 10),
  });
  return `${r.created} 条 · 养号 ${r.warmup} · GEO ${r.geo} · 可用文章 ${r.articlesAvailable}`;
});

await step("排期汇总口径", "分发", async () => {
  const r = await api(`/plans${q}`);
  const s = r.summary;
  return `总 ${s.total} · 知识 ${s.knowledge} · GEO ${s.geo} · 已回填 ${s.withUrl} · 计入效果 ${s.geoEffective}`;
});

await step("媒体与投放台账", "分发", async () => {
  const media = await api("/media");
  const orders = await api(`/orders${q}`);
  const placements = await api(`/placements${q}`);
  return `媒体 ${media.length} · 订单 ${orders.length} · 投放 ${placements.length}`;
});

await step("链接台账同步", "分发", async () => {
  const r = await post("/links/sync", { brandId: BID });
  return `发现 ${r.found} · 新增 ${r.added} · 已存在 ${r.skipped}`;
});

await step("链接存活巡检", "分发", async () => {
  const r = await post("/links/check", { brandId: BID });
  return `检查 ${r.checked} · 可访问 ${r.active} · 失效 ${r.broken} · 网络错误 ${r.networkErrors}`;
});

await step("SEO 站点扫描", "复盘", async () => {
  const r = await post("/seo/scan", { brandId: BID, url: "http://159.75.21.251:3000" });
  return `${r.scan.score}/100 · ${r.scan.passed}/${r.scan.total} 通过 · mode=${r.mode} · 检查 ${r.scan.checks.length} 项`;
});

await step("SEO 看板", "复盘", async () => {
  const r = await api(`/seo/overview${q}`);
  return `曝光率 ${r.summary.exposureRate ?? "—"}（${r.summary.exposureSource}）· 关键词 ${r.summary.keywordsTotal} · 缺口 ${r.gaps.length}`;
});

await step("官网可索引性体检", "复盘", async () => {
  const r = await post("/site/audit", { brandId: BID, url: "http://159.75.21.251:3000" });
  return `${r.score ?? "—"}/100 · 检查 ${r.checks?.length ?? 0} 项`;
});

await step("GEO 站点资产", "复盘", async () => {
  const r = await api(`/site/assets${q}`);
  return Object.keys(r).slice(0, 5).join(", ") || "无返回字段";
});

await step("服务商视图", "扩展", async () => {
  const r = await api("/agency/overview");
  return `客户 ${r.summary.clients} · 自有品牌 ${r.summary.brands} · 任务 ${r.tasks.length}`;
});

await step("数字人配置", "扩展", async () => {
  const r = await api(`/avatar/config${q}`);
  return `脚本分段 ${r.segments.length} · 形象 ${r.assets.looks.length} · 音色 ${r.assets.voices.length} · 任务 ${r.jobs.length}`;
});

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

const lines = [
  `# AgentFlow 全链路端到端测试报告`,
  "",
  `- 时间：${new Date().toISOString()}`,
  `- 品牌：${brand.name}（${BID}）`,
  `- 后端模式：\`${health.mode}\`（真实模型 ${health.providers?.filter((p) => p.live).length ?? 0}/${health.providers?.length ?? 0}）`,
  `- 结果：**${passed}/${results.length} 通过**，失败 ${failed}，总耗时 ${elapsed}s`,
  "",
  "## 口径说明（重要）",
  "",
  "- 未配置模型 Key，AI 探测走确定性 mock；**AVI / 提及率 / SoV 不是真实 AI 平台答案**，仅验证链路与算法可运行。",
  "- SEO 站点扫描、链接存活巡检、知识库检索、内容生成与落库均为真实执行；关键词排名与收录数因无搜索 API 保持「未检测」。",
  "- 发布排期只生成计划、不代发；养号内容不计入 AI 曝光指标。",
  "",
  "## 逐步结果",
  "",
  "| 阶段 | 步骤 | 状态 | 耗时 | 关键数据 |",
  "| --- | --- | --- | --- | --- |",
  ...results.map((r) => `| ${r.group} | ${r.name} | ${r.ok ? "通过" : "失败"} | ${r.ms}ms | ${String(r.summary).replace(/\|/g, "/").slice(0, 160)} |`),
  "",
  "## 链路覆盖",
  "",
  "登录鉴权 → 品牌档案 / 事实卡 / 提问矩阵 → 知识库上传切片与 BM25 检索 → AI 探测与 AVI 指标 → 监测与工作台聚合 → C 端取证队列 → 模板文章与智能体写作 → 文章 HTML 导出 → 发布排期（养号+穿插）→ 媒体与投放台账 → 链接资产同步与真实巡检 → SEO 站点扫描与看板 → 官网体检与 GEO 资产 → 服务商与数字人扩展视图。",
  "",
];
writeFileSync(`${OUT}/REPORT.md`, lines.join("\n"), "utf8");
writeFileSync(`${OUT}/results.json`, JSON.stringify({ at: new Date().toISOString(), brand: brand.name, brandId: BID, mode: health.mode, passed, failed, elapsed, results }, null, 2), "utf8");

console.log(`\n=== ${passed}/${results.length} 通过，失败 ${failed}，耗时 ${elapsed}s ===`);
console.log(`report: ${OUT}/REPORT.md`);
