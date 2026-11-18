/* ============================================================
   提问矩阵生成（M4 前置改造）
   流程：① AI 选关键词 → ② 基于关键词造问题 → ③ 确定性质检
   - 提示词与质检都在这里，纯函数部分可单测
   - 质检不通过的问题不进库，原因可回灌给模型重试
   ============================================================ */

export const INTENTS = ["认知", "比较", "决策", "口碑", "本地"];

const INTENT_WEIGHT = { 认知: 1, 口碑: 2, 比较: 2, 决策: 3, 本地: 3 };

/** 软件类产品没有「附近/到店」，本地意图要解释为「本地部署 / 私有化」 */
export function isLocalService(brand = {}, facts = []) {
  const hay = `${brand.industry || ""} ${brand.intro || ""} ${(facts || [])
    .map((f) => `${f.attr || ""} ${f.value || ""}`)
    .join(" ")}`;
  if (/(门店|到店|上门|施工|装修|门店数|服务区域|量房)/.test(hay)) return true;
  if (/(SaaS|软件|平台|开源|部署|API|模型|Agent|云端)/i.test(hay)) return false;
  return Boolean(brand.city);
}

export function keywordPrompt({ brand, facts, corpus, competitors }) {
  const factLines = (facts || []).map((f) => `- ${f.attr}：${f.value}`).join("\n");
  const comps = (competitors || []).map((c) => c.name).filter(Boolean).join("、");
  return `你是 GEO（生成式引擎优化）关键词分析助手。请基于品牌资料，选出「真实用户会在 AI 搜索里使用的关键词」。

【品牌】${brand.name}${brand.city ? `（${brand.city}）` : ""}
【行业】${brand.industry || "未注明"}
【一句话介绍】${brand.intro || "未注明"}
${comps ? `【已知竞品】${comps}` : ""}
${factLines ? `\n【事实口径】\n${factLines}\n` : ""}
${corpus ? `\n【资料原文】\n${corpus}\n` : ""}

要求：
1. 输出 12–16 个关键词，每个 2–8 个字，是用户会打出来的词，不是句子。
2. 关键词里**不要出现品牌名本身**；竞品名可以作为「竞品」类关键词。
3. 必须覆盖以下类型（每类至少 2 个）：品类、场景、痛点、竞品、决策、技术。
4. 软件类产品禁止出现「附近 / 同城 / 到店 / 上门」；「本地」应理解为「本地部署 / 私有化 / 数据不出内网」。
5. why 写明依据（引用上面的事实或资料，不要编）。

输出格式：只输出 JSON，不要 markdown 代码块，不要解释。
{"keywords":[{"term":"私有化部署","type":"痛点","intentHint":"决策","why":"事实卡：部署方式=自托管 / Docker 一键"}]}`;
}

export function questionPrompt({ brand, keywords, perKeyword = 2, local = true }) {
  const list = (keywords || []).map((k, i) => `${i + 1}. ${k.term}（${k.type}，偏${k.intentHint || "决策"}）`).join("\n");
  return `你是 GEO 提问设计助手。请围绕下列关键词，写出「真实用户会问出口的问题」。

【品牌】${brand.name}${brand.city ? `（${brand.city}）` : ""}
【行业】${brand.industry || "未注明"}

【关键词清单】
${list}

要求：
1. 每个关键词生成 ${perKeyword} 条问题，总条数约 ${(keywords || []).length * perKeyword} 条。
2. 15–35 字，口语化，像真人打字，不要写成产品文档标题。
3. **不要出现品牌名**，唯一例外是意图为「口碑」的问题（最多 3 条，例如「XX 靠谱吗」）。
4. 每条必须带一个**具体约束**：预算、人数、服务器配置、端口/网络、团队角色、现有技术栈、上线时间，任选其一。
5. 意图只能取：认知 / 比较 / 决策 / 口碑 / 本地。**五类各 5–8 条，认知与口碑不得少于 5 条。**
6. 口碑类必须中立：「出问题有人管吗」「更新勤不勤」「踩过哪些坑」，**不得预设「好用 / 稳定 / 口碑好 / 挺稳」**。${local ? "" : "\n7. 这是软件产品：「本地」指本地部署 / 私有化 / 数据不出内网，禁止写「附近 / 同城 / 到店 / 上门」。"}
8. 问题之间不得重复或高度相似；不要用「是否」「如何」「请介绍」这类书面语开头。

输出格式：只输出 JSON 数组，不要 markdown 代码块，不要解释。
[{"text":"两个人维护，还要能接内网知识库，选哪个平台省心？","intent":"决策","weight":3,"keyword":"私有化部署","constraint":"人力"}]`;
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

/** 字符二元组 Jaccard 相似度，用于挡近重复 */
export function similarity(a, b) {
  const A = charBigrams(a);
  const B = charBigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
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

export function auditKeywords(items, { brandName = "", limit = 16 } = {}) {
  const out = [];
  const rejected = [];
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
    if (out.some((x) => x.term === term)) {
      rejected.push({ term, reason: "重复" });
      continue;
    }
    out.push({
      term,
      type: String(it?.type || "品类").slice(0, 8),
      intentHint: INTENTS.includes(it?.intentHint) ? it.intentHint : "决策",
      why: String(it?.why || "").slice(0, 60),
    });
    if (out.length >= limit) break;
  }
  return { accepted: out, rejected };
}

/**
 * 问题质检：长度、问句、品牌词、软件类本地词、近重复、意图合法
 * 返回 accepted / rejected（带原因，可回灌重试）/ stats
 */
export function auditPrompts(items, { brandName = "", localService = true, existing = [], limit = 40 } = {}) {
  const accepted = [];
  const rejected = [];
  const canon = (t) => (brandName ? normalizeText(t).split(brandName).join("") : normalizeText(t));
  const seen = (existing || []).map((t) => normalizeText(t));
  let brandHits = 0;

  for (const it of Array.isArray(items) ? items : []) {
    let text = normalizeText(it?.text).slice(0, 80);
    // 疑问句但漏了问号：补上，不当作无效问题剔除
    if (text && !/[？?]$/.test(text) && /(吗|呢|么|多少|几|怎么|如何|哪|是否|能不能|要不要|行不行|够不够|好不好|会不会)$/.test(text)) {
      text += "？";
    }
    if (text.length < 8) {
      rejected.push({ text, reason: "过短（<8 字）" });
      continue;
    }
    if (text.length > 45) {
      rejected.push({ text, reason: "过长（>45 字）" });
      continue;
    }
    if (!/[？?]$/.test(text)) {
      rejected.push({ text, reason: "不是问句" });
      continue;
    }
    if (!localService && /(附近|同城|到店|上门|周边|离我)/.test(text)) {
      rejected.push({ text, reason: "软件产品不适用本地服务词" });
      continue;
    }
    if (seen.some((t) => similarity(canon(t), canon(text)) > 0.82)) {
      rejected.push({ text, reason: "与已有问题近重复" });
      continue;
    }
    const intent = INTENTS.includes(it?.intent) ? it.intent : "决策";
    const hasBrand = Boolean(brandName) && text.includes(brandName);
    if (intent === "口碑" && /(挺稳|很好用|特别好|口碑不错|听说.{0,8}(好|稳|强)|都说好)/.test(text)) {
      rejected.push({ text, reason: "口碑类预设了正面结论" });
      continue;
    }
    if (hasBrand && intent !== "口碑") {
      rejected.push({ text, reason: "含品牌名（仅口碑类允许）" });
      continue;
    }
    if (hasBrand && brandHits >= 3) {
      rejected.push({ text, reason: "品牌词问题已达上限 3 条" });
      continue;
    }
    if (hasBrand) brandHits += 1;

    seen.push(text);
    accepted.push({
      text,
      intent,
      weight: INTENT_WEIGHT[intent] || 3,
      keyword: String(it?.keyword || "").slice(0, 20),
      constraint: String(it?.constraint || "").slice(0, 12),
    });
    if (accepted.length >= limit) break;
  }

  const intentCount = {};
  for (const p of accepted) intentCount[p.intent] = (intentCount[p.intent] || 0) + 1;
  const brandRatio = accepted.length ? brandHits / accepted.length : 0;

  return {
    accepted,
    rejected,
    stats: {
      total: Array.isArray(items) ? items.length : 0,
      accepted: accepted.length,
      rejected: rejected.length,
      brandHits,
      brandRatio: Number(brandRatio.toFixed(3)),
      intents: intentCount,
      intentCoverage: Object.keys(intentCount).length,
    },
  };
}
