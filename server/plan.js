/* ============================================================
   发布排期规则（纯函数，无 IO）
   - 先养号：每个渠道前 N 条为纯知识内容（不带品牌、不带数字、不计入 GEO 指标）
   - 再穿插：每 ratio+1 条里前 ratio 条知识、1 条 GEO 文章
   - 只生成「计划」，不代发、不编造 URL
   ============================================================ */

/** 行业无关的纯知识选题：不含品牌名、不含数字、不含承诺性用语 */
export const KNOWLEDGE_TOPICS = [
  "怎么判断一份资料有没有写清来源？",
  "常见的参数对照表应该怎么看？",
  "核验口径时最容易忽略的是什么？",
  "把默认可用和需要额外配置分开记录",
  "文档版本不一致时怎么处理？",
  "怎么给一份说明标注可回溯的出处？",
  "术语不统一会带来哪些理解偏差？",
  "公开资料与企业资料冲突时以谁为准？",
  "结构化信息为什么更容易被引用？",
  "做选型记录时该保留哪些原始信息？",
  "常见问答里哪些说法需要避免绝对化？",
  "怎么检查一份清单有没有漏项？",
];

const DEFAULT_CHANNELS = ["知乎", "小红书", "公众号"];

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function normalizePlanOptions(raw = {}) {
  const clamp = (v, min, max, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };
  const channels = Array.isArray(raw.channels)
    ? raw.channels.map((c) => String(c || "").trim().slice(0, 40)).filter(Boolean).slice(0, 8)
    : [];
  return {
    warmupCount: clamp(raw.warmupCount, 0, 20, 4),
    ratio: clamp(raw.ratio, 1, 9, 3),
    weeks: clamp(raw.weeks, 1, 12, 4),
    intervalDays: clamp(raw.intervalDays, 1, 14, 2),
    channels: channels.length ? [...new Set(channels)] : [...DEFAULT_CHANNELS],
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.startDate || "")) ? String(raw.startDate) : new Date().toISOString().slice(0, 10),
  };
}

/**
 * @param raw 选项
 * @param articles 可用的 GEO 文章 [{ id, title }]
 * @returns slots: [{ date, channel, kind, stage, title, contentId }]
 */
export function buildPlanSlots(raw = {}, articles = []) {
  const o = normalizePlanOptions(raw);
  const slotsPerChannel = Math.min(60, Math.max(1, Math.floor((o.weeks * 7) / o.intervalDays)));
  const out = [];

  for (const channel of o.channels) {
    for (let i = 0; i < slotsPerChannel; i += 1) {
      const warmup = i < o.warmupCount;
      const seq = i - o.warmupCount;
      const isGeo = !warmup && o.ratio > 0 && seq % (o.ratio + 1) === o.ratio;
      const article = isGeo && articles.length ? articles[(out.filter((s) => s.kind === "geo").length) % articles.length] : null;
      const topic = KNOWLEDGE_TOPICS[out.length % KNOWLEDGE_TOPICS.length];
      out.push({
        date: addDays(o.startDate, i * o.intervalDays),
        channel,
        kind: isGeo && article ? "geo" : "knowledge",
        stage: warmup ? "warmup" : "mixed",
        title: isGeo && article ? String(article.title).slice(0, 120) : topic,
        contentId: isGeo && article ? String(article.id) : "",
      });
    }
  }
  return { options: o, slots: out };
}
