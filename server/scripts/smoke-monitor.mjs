/* Monitor 接口验证：node scripts/smoke-monitor.mjs */
const base = process.env.GEO_BASE || "http://127.0.0.1:8002/api";

async function req(path, { token } = {}) {
  const res = await fetch(base + path, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  return { status: res.status, data };
}

const login = await fetch(`${base}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ phone: "13800000000", password: "123456" }),
});
const token = (await login.json()).token;
const me = (await req("/me", { token })).data;

for (const days of [7, 30, 90]) {
  console.log("\n========== days=%s ==========", days);
  for (const brand of me.brands) {
    const r = await req(`/monitor?brandId=${brand.id}&days=${days}`, { token });
    if (r.status !== 200) {
      console.log("%s → http=%s %j", brand.name, r.status, r.data);
      continue;
    }
    const d = r.data;
    console.log("%s", brand.name);
    console.log("  summary: avi=%s model=%s cend=%s delta=%s points=%s last=%s",
      d.summary.avi, d.summary.aviModel, d.summary.aviCend, d.summary.delta, d.summary.points, d.summary.lastDate);
    console.log("  trend 点（共 %s）：%j", d.trend.length, d.trend.slice(0, 2).map((t) => t.date));
    console.log("  runs=%s  lastRun=%s", d.runs.length, d.lastRun ? d.lastRun.mode + "/" + d.lastRun.total : "无");
    console.log("  platforms=%s  intents=%s  cend.total=%s", d.platforms.length, d.intents.length, d.cend.total);
    console.log("  gaps: %s", d.gaps.map((g) => g.key).join(", ") || "无");
  }
}

/* 详细看一个品牌的分平台与意图（若有数据） */
const brand = me.brands.find((b) => b.name.includes("和序")) || me.brands[0];
const d = (await req(`/monitor?brandId=${brand.id}&days=90`, { token })).data;
console.log("\n=== %s 详情 ===", brand.name);
console.log("平台：%j", d.platforms);
console.log("意图：%j", d.intents);
console.log("C端：%j", d.cend.byPlatform);
console.log("缺口：%j", d.gaps);
