/* ============================================================
   合规检查：广告法绝对化用语 + 行业禁用语
   - block：必须修改，否则禁止发布（硬拦截在 PATCH 状态流转里）
   - warn ：建议修改，不阻断
   词库宁可保守：误伤由人改一句，漏放客户可能被罚 20 万
   ============================================================ */

const ABSOLUTE_BLOCK = [
  "最好", "最佳", "最优", "最强", "最便宜", "最低价", "最专业", "最权威", "最高级",
  "第一品牌", "全国第一", "全球第一", "行业第一", "销量第一", "排名第一",
  "国家级", "世界级", "顶级", "顶尖", "唯一", "首个", "首家", "独家", "万能",
  "100%", "百分百", "零风险", "零甲醛", "永久", "永不",
];

const ABSOLUTE_WARN = ["保证", "绝对", "史无前例", "前所未有", "免费", "限时", "抢购", "秒杀", "无敌", "王牌"];

const INDUSTRY_RULES = [
  {
    match: ["医疗", "健康", "诊所", "口腔", "医美", "药"],
    block: ["治愈", "根治", "药到病除", "无副作用", "包治", "疗效显著", "特效"],
    warn: ["改善", "缓解"],
    reason: "医疗健康类不得承诺疗效",
  },
  {
    match: ["教育", "培训", "学校", "留学", "辅导"],
    block: ["保过", "包过", "升学率", "提分保证", "押题", "100%通过"],
    warn: ["名师", "权威"],
    reason: "教育培训类不得承诺结果",
  },
  {
    match: ["金融", "投资", "理财", "贷款", "保险"],
    block: ["保本", "稳赚", "无风险", "收益保证", "高回报"],
    warn: ["稳", "翻倍"],
    reason: "金融类不得承诺收益",
  },
  {
    match: ["装修", "家装", "建材", "家具"],
    block: ["零甲醛", "无污染", "绝对环保"],
    warn: ["环保达标", "除醛"],
    reason: "家装类环保表述需有检测依据",
  },
];

function collect(text, words, level, reason) {
  const out = [];
  for (const w of words) {
    let from = 0;
    for (;;) {
      const i = text.indexOf(w, from);
      if (i < 0) break;
      out.push({
        word: w,
        level,
        reason,
        context: text.slice(Math.max(0, i - 18), Math.min(text.length, i + w.length + 18)).replace(/\s+/g, " ").trim(),
      });
      from = i + w.length;
      if (out.length > 40) return out;
    }
  }
  return out;
}

/**
 * @param text 正文
 * @param industry 行业名（用于匹配行业规则）
 */
export function checkCompliance(text, industry = "") {
  const body = String(text || "");
  const hits = [
    ...collect(body, ABSOLUTE_BLOCK, "block", "广告法禁止绝对化用语"),
    ...collect(body, ABSOLUTE_WARN, "warn", "承诺性用语，建议改为客观描述"),
  ];

  for (const rule of INDUSTRY_RULES) {
    if (!rule.match.some((k) => industry.includes(k))) continue;
    hits.push(...collect(body, rule.block, "block", rule.reason));
    hits.push(...collect(body, rule.warn, "warn", rule.reason));
  }

  // 去重（同词同位置只留一条）
  const seen = new Set();
  const uniq = hits.filter((h) => {
    const k = `${h.word}|${h.context}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const blocked = uniq.filter((h) => h.level === "block");
  const warnings = uniq.filter((h) => h.level === "warn");

  return {
    ok: blocked.length === 0,
    blocked,
    warnings,
    total: uniq.length,
    summary: blocked.length
      ? `${blocked.length} 处禁用词，发布前必须修改`
      : warnings.length
        ? `${warnings.length} 处建议调整（不阻断发布）`
        : "未发现合规风险",
  };
}
