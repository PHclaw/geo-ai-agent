/* ============================================================
   双轨指标计算
   - 模型倾向（aviModel）：取最近一次自动探测（C/B 级 API 或模拟）
   - C 端可见度（aviCend）：取所有 C 端取证记录（A 级），没有则为 null
   两者独立更新、独立展示，绝不合成一个数字冒充真相
   ============================================================ */
import { db } from "./db.js";
import { summarize, quadrantOf } from "./geo.js";

const CEND_CAP = 2000;

export function computeBrandMetrics(brandId) {
  const prompts = db.prepare("SELECT * FROM prompts WHERE brand_id = ?").all(brandId);

  const lastRun = db
    .prepare("SELECT * FROM probe_runs WHERE brand_id=? AND status='done' ORDER BY finished_at DESC LIMIT 1")
    .get(brandId);

  const modelRows = lastRun
    ? db.prepare("SELECT * FROM probe_results WHERE run_id=? AND channel != 'cend'").all(lastRun.id)
    : [];
  const cendRows = db
    .prepare(`SELECT * FROM probe_results WHERE brand_id=? AND channel='cend' ORDER BY created_at DESC LIMIT ${CEND_CAP}`)
    .all(brandId);

  const modelSummary = modelRows.length ? summarize(modelRows, prompts) : null;
  const cendSummary = cendRows.length ? summarize(cendRows, prompts) : null;

  const aviModel = modelSummary ? modelSummary.avi : null;
  const aviCend = cendSummary ? cendSummary.avi : null;

  // 展示口径：有 A 级证据以 C 端为准，否则退回模型倾向并标注来源
  const primary = cendSummary || modelSummary;
  const quadrant = quadrantOf({ aviCend, aviModel });

  const date = new Date().toISOString().slice(0, 10);

  // 没有任何样本时不写库：否则会把当天指标写成 0，盖掉历史基线（真实踩过的坑）
  let avi = 0;
  if (primary) {
    avi = primary.avi;
    const existing = db.prepare("SELECT id FROM metrics_daily WHERE brand_id=? AND date=?").get(brandId, date);
    const mentionRate = primary.mentionRate;
    const firstRate = primary.firstRate;
    const accuracy = primary.accuracy;
    const sov = primary.sov;

    if (existing) {
      db.prepare(
        `UPDATE metrics_daily
         SET avi=?, avi_model=?, avi_cend=?, mention_rate=?, first_rate=?, accuracy=?, sov=?, samples=?, cend_samples=?
         WHERE id=?`
      ).run(avi, aviModel, aviCend, mentionRate, firstRate, accuracy, sov, modelRows.length, cendRows.length, existing.id);
    } else {
      db.prepare(
        `INSERT INTO metrics_daily
          (id, brand_id, date, avi, avi_model, avi_cend, mention_rate, first_rate, accuracy, sov, samples, cend_samples)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        cryptoRandomId(), brandId, date, avi, aviModel, aviCend, mentionRate, firstRate, accuracy, sov,
        modelRows.length, cendRows.length
      );
    }
  } else {
    // 回退到最近一次有数值的记录，保持趋势连续
    const last = db
      .prepare("SELECT avi FROM metrics_daily WHERE brand_id=? AND date<=? ORDER BY date DESC LIMIT 1")
      .get(brandId, date);
    avi = last ? last.avi : 0;
  }

  return {
    avi,
    aviModel,
    aviCend,
    quadrant,
    modelSummary,
    cendSummary,
    samples: modelRows.length,
    cendSamples: cendRows.length,
    lastRun: lastRun
      ? { id: lastRun.id, mode: lastRun.mode, finishedAt: lastRun.finished_at, status: lastRun.status }
      : null,
  };
}

function cryptoRandomId() {
  return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** 把前端提交的 C 端取证答案转成一条 A 级记录 */
export function evidenceSummary(brandId) {
  const rows = db.prepare("SELECT platform, COUNT(*) c FROM probe_results WHERE brand_id=? AND channel='cend' GROUP BY platform").all(brandId);
  return rows.map((r) => ({ platform: r.platform, count: r.c }));
}
