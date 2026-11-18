/* ============================================================
   提问矩阵生成（v3）
   流程：① 从资料选关键词（带依据与别名）
        ② 按「关键词 × 维度」出题
        ③ 确定性质检（覆盖、句式分布、泛问、品牌词、近重复）
   - 维度 → 意图 的映射由代码固定，不交给模型，避免标签错位
   ============================================================ */

export const INTENTS = ["认知", "比较", "决策", "口碑", "本地"];

/** 七个维度；intent 用于现有 AVI 分意图统计，不让模型自由标 */
export const DIMENSIONS = [
  { key: "平台选型", intent: "决策", hint: "在几个候选平台里做决定，带预算/人数/上线时间等约束" },
  { key: "功能对比", intent: "比较", hint: "某个能力 A 有没有、和 B 差在哪" },
  { key: "应用场景", intent: "认知", hint: "我的业务场景能不能用、够不够用" },
  { key: "技术实现", intent: "本地", hint: "怎么接、支持什么格式、网络/端口/部署细节" },
  { key: "迁移替换", intent: "比较", hint: "从别家换过来的成本、工作量与风险" },
  { key: "成本预算", intent: "决策", hint: "多少钱、怎么计费、免费额度够不够" },
  { key: "口碑风险", intent: "口碑", hint: "稳定性、售后响应、踩过的坑" },
];

export const DIMENSION_INTENT = Object.fromEntries(DIMENSIONS.map((d) => [d.key, d.intent]));
export const INTENT_WEIGHT = { 认知: 1, 口碑: 2, 比较: 2, 决策: 3, 本地: 3 };

/** 句式骨架：用于限制「够不够 / 哪个划算 / 有人管吗」这类同构占比 */
const PATTERNS = [
  { key: "够不够", re: /(够不够|够用吗|撑得住|扛得住|顶得住|跑得动|跑得起来|撑得起)/ },
  { key: "选哪个", re: /(选哪个|哪个更|哪个值|哪个划算|哪项|哪家|还是)/ },
  { key: "有人管吗", re: /(有人管|有人维护|没人管|售后|响应)/ },
  { key: "来得及吗", re: /(来得及|多久|几天|几周|几个月|能不能.{0,6}上线|什么时候能)/ },
  { key: "差在哪", re: /(差在哪|区别|区别大|对比|相比|比.{0,4}省)/ },
  { key: "怎么接", re: /(怎么接|怎么打通|支持哪些|要改哪些|什么格式|能不能接|对接)/ },
  { key: "多少钱", re: /(多少钱|价格|费用|预算.{0,8}|按人头|免费额度)/ },
];

const VAGUE_RE = /(一般|平时|通常|有哪些|靠什么|怎么打通|都有啥|能搭出啥|都管哪些)/;
const PRAISE_RE = /(挺稳|很好用|特别好|口碑不错|听说.{0,8}(好|稳|强)|都说好)/;
const LOCAL_SERVICE_RE = /(附近|同城|到店|上门|周边|离我)/;

export function isLocalService(brand = {}, facts = []) {
  const hay = `${brand.industry || ""} ${brand.intro || ""} ${(facts || [])
    .map((f) => `${f.attr || ""} ${f.value || ""}`)
    .join(" ")}`;
  if (/(门店|到店|上门|施工|装修|门店数|服务区域|量房)/.test(hay)) return true;
  if (/(SaaS|软件|平台|开源|部署|API|模型|Agent|云端)/i.test(hay)) return false;
  return Boolean(brand.city);
}

export function normalizeText(t) {
  return String(t || "")
    .replace(/\s+/g, " ")
    .trim();
}

function charBigrams(s) {
  const t = normalizeText(s).replace(/[\s\p{P}]/gu, "");
  const set = new Set();
  for (let i = 0; i < t.length - 1; i += 1) set.add(t.slice(i, i + 2));
  return set;
}

export function similarity(a, b) {
  const A = charBigrams(a);
  const B = charBigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

export function patternOf(text) {
  for (const p of PATTERNS) if (p.re.test(text)) return p.key;
  return "其他";
}

export function parseJsonLoose(text) {
  const raw = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(raw);
  } catch {
    const arr = raw.match(/\[[\s\S]*\]/);
    if (arr) {
      try {
        return JSON.parse(arr[0]);
      } catch {
        /* fallthrough */
      }
    }
    const obj = raw.match(/\{[\s\S]*\}/);
    if (obj) {
      try {
        return JSON.parse(obj[0]);
      } catch {
        /* fallthrough */
      }
    }
    return null;
  }
}

/* ---------------- 提示词 ---------------- */

export function keywordPrompt({ brand, facts, corpus, competitors }) {
  const factLines = (facts || []).map((f) => `- ${f.attr}：${f.value}`).join("\n");
  const comps = (competitors || []).map((c) => c.name).filter(Boolean).join("、");
  return `你是 GEO（生成式引擎优化）关键词分析助手。请从品牌资料里选出「真实用户会在 AI 搜索里使用的关键词」。

【品牌】${brand.name}${brand.city ? `（${brand.city}）` : ""}
【行业】${brand.industry || "未注明"}
【一句话介绍】${brand.intro || "未注明"}
${comps ? `【已知竞品】${comps}` : ""}
${factLines ? `\n【事实口径】\n${factLines}\n` : ""}
${corpus ? `\n【资料原文】\n${corpus}\n` : ""}

关键词类型只能取：品类 / 场景 / 能力 / 技术 / 竞品 / 成本 / 合规。

要求：
1. 输出 14–18 个关键词，每个 2–8 字，是用户会打出来的词，不是句子。
2. 不得包含品牌名；竞品名可以作为「竞品」类。
3. 覆盖至少 5 种类型，每种不超过 4 个。
4. 同义词必须合并到一个词，并在 aliases 里列出（如「私有化部署 / 本地部署 / 自托管」→ term=私有化部署）。
5. why 写依据，必须来自上方事实或资料，编不出来就不要这个关键词。
6. 软件类产品禁止出现「附近 / 同城 / 到店 / 上门」。

输出格式：只输出 JSON，不要 markdown，不要解释。
{"keywords":[{"term":"私有化部署","type":"合规","aliases":["本地部署","自托管"],"why":"事实卡：部署方式=自托管 / Docker 一键"}]}`;
}

export function matrixPrompt({ brand, keywords, perCell = 2 }) {
  const kw = (keywords || []).map((k, i) => `${i + 1}. ${k.term}（${k.type}${k.aliases?.length ? `；别名：${k.aliases.join("/")}` : ""}）`).join("\n");
  const dims = DIMENSIONS.map((d) => `- ${d.key}：${d.hint}`).join("\n");
  const total = (keywords || []).length * perCell * 2;
  return `你是 GEO 提问设计助手。请按「关键词 × 维度」矩阵出题。

【品牌】${brand.name}${brand.city ? `（${brand.city}）` : ""}
【行业】${brand.industry || "未注明"}

【关键词清单】
${kw}

【维度定义】
${dims}

要求：
1. 每个关键词至少覆盖 2 个不同维度；每个维度至少 4 条；总数 ${Math.max(24, Math.min(64, total))} 条左右。
2. 15–35 字，口语化，像真人打字，必须以问号结尾。
3. 不得出现品牌名；唯一例外是「口碑风险」维度，最多 3 条。
4. 每条必须带一个具体约束：预算 / 人数 / 服务器配置 / 端口 / 现有工具 / 上线时间，任选其一。
5. 禁止科普式泛问：不要写「一般」「平时」「通常」「有哪些」「靠什么」「怎么打通」。
6. 口碑风险类必须中立，不得预设「好用 / 稳定 / 口碑好」。
7. 同一句式的问法（够不够 / 选哪个 / 有人管吗 / 来得及吗 / 差在哪 / 怎么接 / 多少钱）不得超过总数的 25%。
8. 不要用「是否」「如何」「请介绍」这类书面语开头。

输出格式：只输出 JSON，不要 markdown，不要解释。
{"matrix":[{"keyword":"私有化部署","dimension":"技术实现","questions":["只放通 443 端口，内网能跑起来吗？","机房有两张 3090，本地模型要什么格式？"]}]}`;
}

/* ---------------- 质检 ---------------- */

export function auditKeywords(items, { brandName = "", limit = 18, softLimit = 4 } = {}) {
  const accepted = [];
  const rejected = [];
  const typeCount = {};
  for (const it of Array.isArray(items) ? items : []) {
    const term = normalizeText(it?.term).slice(0, 20);
    if (term.length < 2) {
      rejected.push({ term, reason: "过短" });
      continue;
    }
    if (brandName && term.includes(brandName)) {
      rejected.push({ term, reason: "含品牌名" });
      continue;
    }
    if (accepted.some((x) => x.term === term)) {
      rejected.push({ term, reason: "重复" });
      continue;
    }
    const type = ["品类", "场景", "能力", "技术", "竞品", "成本", "合规"].includes(String(it?.type))
      ? String(it.type)
      : "品类";
    if ((typeCount[type] || 0) >= softLimit) {
      rejected.push({ term, reason: `${type}类已达上限 ${softLimit}` });
      continue;
    }
    typeCount[type] = (typeCount[type] || 0) + 1;
    accepted.push({
      term,
      type,
      aliases: Array.isArray(it?.aliases) ? it.aliases.map((a) => normalizeText(a).slice(0, 12)).filter(Boolean).slice(0, 4) : [],
      why: String(it?.why || "").slice(0, 80),
    });
    if (accepted.length >= limit) break;
  }
  const types = Object.keys(typeCount);
  return { accepted, rejected, stats: { types: types.length, typeCount } };
}

/**
 * 矩阵质检：逐条规则 + 句式分布裁剪
 * 返回展平后可直接入库的问题（带 keyword / dimension / intent / weight）
 */
export function auditMatrix(matrix, { brandName = "", localService = true, existing = [], perCellLimit = 3 } = {}) {
  const accepted = [];
  const rejected = [];
  const seen = (existing || []).map((t) => normalizeText(t));
  const cellCount = new Map();
  const bundle = [];

  for (const cell of Array.isArray(matrix) ? matrix : []) {
    const keyword = normalizeText(cell?.keyword).slice(0, 20);
    const dimension = normalizeText(cell?.dimension).slice(0, 12);
    const dim = DIMENSIONS.find((d) => d.key === dimension);
    if (!dim) {
      rejected.push({ text: `${keyword} / ${dimension}`, reason: "维度不合法" });
      continue;
    }
    const list = Array.isArray(cell?.questions) ? cell.questions : [];
    for (const raw of list) {
      const item = typeof raw === "string" ? { text: raw } : raw || {};
      let text = normalizeText(item.text).slice(0, 80);
      if (text && !/[？?]$/.test(text) && /(吗|呢|么|多少|几|怎么|如何|哪|是否|能不能|要不要|行不行|够不够|好不好|会不会)$/.test(text)) {
        text += "？";
      }
      const cellKey = `${keyword}||${dimension}`;
      const push = (reason) => rejected.push({ text: text || "(空)", reason, keyword, dimension });

      if (text.length < 10) {
        push("过短（<10 字）");
        continue;
      }
      if (text.length > 45) {
        push("过长（>45 字）");
        continue;
      }
      if (!/[？?]$/.test(text)) {
        push("不是问句");
        continue;
      }
      if (!localService && LOCAL_SERVICE_RE.test(text)) {
        push("软件产品不适用本地服务词");
        continue;
      }
      if (VAGUE_RE.test(text)) {
        push("科普式泛问");
        continue;
      }
      if (dim.key === "口碑风险" && PRAISE_RE.test(text)) {
        push("口碑类预设了正面结论");
        continue;
      }
      if (seen.some((t) => similarity(t, text) > 0.82)) {
        push("与已有问题近重复");
        continue;
      }
      if ((cellCount.get(cellKey) || 0) >= perCellLimit) {
        push(`同一关键词×维度超过 ${perCellLimit} 条`);
        continue;
      }
      const hasBrand = Boolean(brandName) && text.includes(brandName);
      seen.push(text);
      cellCount.set(cellKey, (cellCount.get(cellKey) || 0) + 1);
      const intent = dim.intent;
      bundle.push({
        text,
        keyword,
        dimension,
        intent,
        weight: INTENT_WEIGHT[intent] || 2,
        brand: hasBrand,
        pattern: patternOf(text),
      });
    }
  }

  // 品牌词：只允许口碑风险类，且总量 ≤10% 与 ≤3 条
  const brandAllowed = bundle.filter((b) => b.brand && b.dimension === "口碑风险").slice(0, 3);
  for (const b of bundle) {
    if (!b.brand) continue;
    if (!brandAllowed.includes(b)) rejected.push({ text: b.text, reason: "含品牌名（仅口碑风险类允许，且最多 3 条）", keyword: b.keyword, dimension: b.dimension });
  }
  const kept = bundle.filter((b) => !b.brand || brandAllowed.includes(b));

  // 句式分布：单一问法不超过 30%，超出按顺序裁掉
  const byPattern = {};
  for (const b of kept) byPattern[b.pattern] = (byPattern[b.pattern] || 0) + 1;
  const cap = Math.max(3, Math.ceil(kept.length * 0.3));
  const patternUsed = {};
  const finalList = [];
  for (const b of kept) {
    patternUsed[b.pattern] = (patternUsed[b.pattern] || 0) + 1;
    // 「其他」是兜底类，不是同一种问法，不参与句式上限
    if (b.pattern !== "其他" && patternUsed[b.pattern] > cap) {
      rejected.push({ text: b.text, reason: `问法「${b.pattern}」重复过多`, keyword: b.keyword, dimension: b.dimension });
      continue;
    }
    finalList.push({
      text: b.text,
      intent: b.intent,
      weight: b.weight,
      keyword: b.keyword,
      dimension: b.dimension,
      pattern: b.pattern,
    });
  }

  const perDimension = {};
  const perKeyword = {};
  for (const q of finalList) {
    perDimension[q.dimension] = (perDimension[q.dimension] || 0) + 1;
    perKeyword[q.keyword] = (perKeyword[q.keyword] || 0) + 1;
  }
  const keywordsWithQ = Object.keys(perKeyword).length;
  const dimensionsWithQ = Object.keys(perDimension).length;

  return {
    accepted: finalList,
    rejected,
    coverage: {
      keywords: keywordsWithQ,
      dimensions: dimensionsWithQ,
      cells: new Set(finalList.map((q) => `${q.keyword}||${q.dimension}`)).size,
      questions: finalList.length,
      perDimension,
      perKeyword,
      pattern: patternUsed,
    },
    stats: {
      total: bundle.length + rejected.length,
      accepted: finalList.length,
      rejected: rejected.length,
      brandHits: finalList.filter((q) => q.text.includes(brandName)).length,
      brandRatio: finalList.length
        ? Number((finalList.filter((q) => q.text.includes(brandName)).length / finalList.length).toFixed(3))
        : 0,
      dimensionsCovered: dimensionsWithQ,
      keywordsCovered: keywordsWithQ,
    },
  };
}
