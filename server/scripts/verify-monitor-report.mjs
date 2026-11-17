/* 监测复盘验收报告（接口层逐条核对）：node scripts/verify-monitor-report.mjs */
const base = process.env.GEO_BASE || "http://127.0.0.1:8002/api";

const token = (
  await (
    await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "13800000000", password: "123456" }),
    })
  ).json()
).token;
const H = { Authorization: `Bearer ${token}` };
const me = await (await fetch(`${base}/me`, { headers: H })).json();
const brand = me.brands.find((b) => b.name.includes("和序"));

const get = async (u) => {
  const r = await fetch(base + u, { headers: H });
  return { status: r.status, data: await r.json() };
};

const { status, data: d } = await get(`/monitor?brandId=${brand.id}&days=30`);
console.log("【1】接口 http=%s  品牌=%s（%s）", status, brand.name, [brand.city, brand.industry].filter(Boolean).join(" · "));

console.log("\n【2】主口径来源与可比性");
console.log("   avi=%s  model=%s  cend=%s", d.summary.avi, d.summary.aviModel, d.summary.aviCend);
console.log("   source=%s  prevSource=%s  delta=%s  comparable=%s", d.summary.source, d.summary.prevSource, d.summary.delta, d.summary.deltaComparable);
console.log("   → 界面应显示徽标「以 C 端取证为准」，副文案「口径已切换（基线 → 当前口径），暂不可比」");

console.log("\n【3】剩余缺口（%s 项）", d.gaps.length);
d.gaps.forEach((g) => console.log("   ! %s → %s（%s）", g.label, g.action, g.to));

const pts = d.trend.filter((t) => t.samples > 0 || t.cendSamples > 0 || t.avi > 0);
console.log("\n【4】趋势：30 天内有数据 %s 天，最后 3 个点：", pts.length);
pts.slice(-3).forEach((t) => console.log("   %s  avi=%s model=%s cend=%s 样本=%s/%s", t.date, t.avi, t.aviModel, t.aviCend, t.samples, t.cendSamples));
const lines = {
  主口径: pts.filter((t) => t.avi > 0).length,
  模型倾向: pts.filter((t) => t.aviModel !== null).length,
  C端可见度: pts.filter((t) => t.aviCend !== null).length,
};
console.log("   可绘制线段点数：%j → 图上会出现 3 条线（历史段只有主口径，今天三点齐）", lines);

console.log("\n【5】分平台（最近一轮 %s / %s 样本）", d.lastRun?.mode, d.lastRun?.total);
d.platforms.forEach((p) => console.log("   %-10s 样本=%s 提及率=%s%% 平均位次=%s", p.platform, p.samples, p.rate, p.avgPosition ?? "—"));

console.log("\n【6】分意图");
d.intents.forEach((i) => console.log("   %-6s 样本=%s 提及率=%s%%", i.intent, i.samples, i.rate));

console.log("\n【7】C 端取证：共 %s 条", d.cend.total);
d.cend.byPlatform.forEach((c) => console.log("   %-10s %s 条 提及率=%s%%", c.platform, c.count, c.rate));
d.cend.recent.forEach((r) => console.log("   · %s | %s | %s | 准确度 %s%%", r.platform, r.mention ? `第 ${r.position} 位` : "未提及", r.prompt, Math.round(r.accuracy * 100)));

console.log("\n【8】探测轮次：%s 次", d.runs.length);
d.runs.forEach((r) => console.log("   %s  mode=%s  样本=%s  状态=%s", r.finishedAt, r.mode, r.total, r.status));

console.log("\n【9】区间切换（有数据天数）");
for (const days of [7, 30, 90]) {
  const r = await get(`/monitor?brandId=${brand.id}&days=${days}`);
  console.log("   %s 天 → points=%s  avi=%s  source=%s", days, r.data.summary.points, r.data.summary.avi, r.data.summary.source);
}

console.log("\n【10】工作台四象限（同源校验）");
const ov = await get(`/overview?brandId=${brand.id}`);
console.log("   kpi avi=%s model=%s cend=%s samples=%s/%s", ov.data.kpi.avi, ov.data.kpi.aviModel, ov.data.kpi.aviCend, ov.data.kpi.samples, ov.data.kpi.cendSamples);
console.log("   quadrant=%s（%s）", ov.data.quadrant.key, ov.data.quadrant.label);
console.log("   %s", ov.data.quadrant.diagnosis);
