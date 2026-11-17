/* Monitor 数据现状盘点：node scripts/check-monitor-data.mjs */
import { db } from "../db.js";

for (const b of db.prepare("SELECT id, name FROM brands ORDER BY created_at").all()) {
  const q = (sql, ...a) => db.prepare(sql).get(b.id, ...a) || {};
  const runs = q("SELECT COUNT(*) c FROM probe_runs WHERE brand_id=?").c;
  const results = q("SELECT COUNT(*) c FROM probe_results WHERE brand_id=?").c;
  const cend = q("SELECT COUNT(*) c FROM probe_results WHERE brand_id=? AND channel='cend'").c;
  const metrics = q("SELECT COUNT(*) c FROM metrics_daily WHERE brand_id=?").c;
  const contents = q("SELECT COUNT(*) c FROM contents WHERE brand_id=?").c;
  console.log("\n%s", b.name);
  console.log("  probe_runs=%s  probe_results=%s（其中 cend=%s）  metrics_daily=%s  contents=%s", runs, results, cend, metrics, contents);

  const last = db
    .prepare("SELECT date, avi, avi_model, avi_cend, samples, cend_samples FROM metrics_daily WHERE brand_id=? ORDER BY date DESC LIMIT 3")
    .all(b.id);
  if (last.length) {
    console.log("  最近指标：");
    last.forEach((m) => console.log("    %s  avi=%s model=%s cend=%s samples=%s/%s", m.date, m.avi, m.avi_model ?? "-", m.avi_cend ?? "-", m.samples ?? "-", m.cend_samples ?? "-"));
  }

  const plats = db
    .prepare(
      `SELECT platform, COUNT(*) n, SUM(mention) m, ROUND(AVG(NULLIF(position,0)),1) pos
       FROM probe_results WHERE brand_id=? AND channel!='cend' GROUP BY platform`
    )
    .all(b.id);
  if (plats.length) {
    console.log("  分平台（模型口径）：");
    plats.forEach((p) => console.log("    %s  n=%s 提及=%s 平均位次=%s", p.platform, p.n, p.m, p.pos ?? "-"));
  }

  const intents = db
    .prepare(
      `SELECT p.intent, COUNT(*) n, SUM(r.mention) m
       FROM probe_results r JOIN prompts p ON p.id=r.prompt_id
       WHERE r.brand_id=? AND r.channel!='cend' GROUP BY p.intent`
    )
    .all(b.id);
  if (intents.length) {
    console.log("  分意图（模型口径）：");
    intents.forEach((i) => console.log("    %s  n=%s 提及=%s", i.intent, i.n, i.m));
  }
}
