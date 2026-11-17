/* 端到端验证：跑探测 + 取证 → Monitor 是否被填满
   node scripts/verify-monitor-fill.mjs [品牌名] */
const base = process.env.GEO_BASE || "http://127.0.0.1:8002/api";

async function req(path, { method = "GET", token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  return { status: res.status, data };
}

const token = (await req("/auth/login", { method: "POST", body: { phone: "13800000000", password: "123456" } })).data.token;
const me = (await req("/me", { token })).data;
const name = process.argv[2] || "和序";
const brand = me.brands.find((b) => b.name.includes(name)) || me.brands[0];

const before = (await req(`/monitor?brandId=${brand.id}&days=30`, { token })).data;
console.log("BEFORE %s：points=%s avi=%s source=%s 缺口=%s", brand.name, before.summary.points, before.summary.avi, before.summary.source, before.gaps.map((g) => g.key).join(","));

const prompts = (await req(`/prompts?brandId=${brand.id}`, { token })).data;
console.log("       提问 %s 条", prompts.length);

/* ---------- 1) 跑一轮探测 ---------- */
console.log("\n=== 1) 跑探测（%s 条提问 × 6 平台）===", prompts.length);
const run = await req("/probes/run", { method: "POST", token, body: { brandId: brand.id, sample: 1 } });
console.log("START  http=%s mode=%s runId=%s", run.status, run.data.mode, (run.data.runId || "").slice(0, 8));
if (run.status !== 202) {
  console.log("失败：%j", run.data);
  process.exit(0);
}

const t0 = Date.now();
let latest = null;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  latest = (await req(`/probes/latest?brandId=${brand.id}`, { token })).data;
  const st = latest?.run?.status;
  if (st === "done" || st === "failed") break;
  if (i % 5 === 0) console.log("  …%ss status=%s done=%s/%s", i, st, latest?.run?.done, latest?.run?.total);
}
const r = latest?.run || {};
const s = latest?.summary || {};
console.log("DONE   status=%s 耗时 %ss 样本 %s/%s", r.status, ((Date.now() - t0) / 1000).toFixed(1), r.done, r.total);
console.log("       AVI=%s 提及率=%s 首选率=%s 准确率=%s sources=%j", s.avi, s.mentionRate, s.firstRate, s.accuracy, s.sources);

/* ---------- 2) 做 3 条 C 端取证 ---------- */
console.log("\n=== 2) 录入 3 条 C 端取证 ===");
const picks = [
  { platform: "doubao", p: prompts[0], answer: `${brand.name} 在本地口碑不错，目前有 4 家门店，整装报价 980–1350 元/㎡，工期 45–60 天，水电质保 10 年。\n信息来源：本地家居门户` },
  { platform: "deepseek", p: prompts[1], answer: `可以看这几家：栖岸设计、木言空间、${brand.name}。建议对比在建工地与报价单漏项。\n信息来源：知乎` },
  { platform: "kimi", p: prompts[2], answer: `推荐 ${brand.name}，南京本地 4 家门店，整装 980–1350 元/㎡。\n信息来源：行业榜单` },
];
for (const c of picks) {
  const res = await req("/evidence", {
    method: "POST",
    token,
    body: { brandId: brand.id, promptId: c.p.id, platform: c.platform, answer: c.answer, location: brand.city || "南京" },
  });
  console.log("  %s → http=%s mention=%s pos=%s acc=%s | aviCend=%s", c.platform, res.status, res.data.mention, res.data.position, res.data.accuracy, res.data.metrics?.aviCend);
}

/* ---------- 3) Monitor 现在有什么 ---------- */
console.log("\n=== 3) Monitor（30 天）===");
const after = (await req(`/monitor?brandId=${brand.id}&days=30`, { token })).data;
console.log("summary  avi=%s model=%s cend=%s source=%s points=%s delta=%s", after.summary.avi, after.summary.aviModel, after.summary.aviCend, after.summary.source, after.summary.points, after.summary.delta);
console.log("runs     %s 次，最近 mode=%s total=%s", after.runs.length, after.lastRun?.mode, after.lastRun?.total);
console.log("平台     %s", after.platforms.map((p) => `${p.platform} ${p.rate}%(${p.samples})`).join("  "));
console.log("意图     %s", after.intents.map((i) => `${i.intent} ${i.rate}%`).join("  "));
console.log("C端      total=%s  %s", after.cend.total, after.cend.byPlatform.map((c) => `${c.platform} ${c.count}条/${c.rate}%`).join("  "));
console.log("缺口     %s", after.gaps.map((g) => g.key).join(",") || "无");

const trendTail = after.trend.filter((t) => t.samples > 0 || t.cendSamples > 0 || t.avi > 0).slice(-3);
console.log("最近趋势 %j", trendTail);

/* ---------- 4) 工作台四象限 ---------- */
console.log("\n=== 4) 工作台四象限 ===");
const ov = (await req(`/overview?brandId=${brand.id}`, { token })).data;
console.log("kpi      avi=%s model=%s cend=%s samples=%s/%s", ov.kpi.avi, ov.kpi.aviModel, ov.kpi.aviCend, ov.kpi.samples, ov.kpi.cendSamples);
console.log("quadrant %s（%s）", ov.quadrant.key, ov.quadrant.label);
console.log("         %s", ov.quadrant.diagnosis);
console.log("         下一步：%s", ov.quadrant.action);
