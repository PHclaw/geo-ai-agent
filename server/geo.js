/* ============================================================
   GEO 计算与生成引擎（纯函数，无 IO，便于单测）
   AVI = 100 × Σ(w × s) / Σw，s = 位次分 × 准确度系数
   ============================================================ */

const INTENT_WEIGHT = { 认知: 1, 比较: 2, 决策: 3, 口碑: 3, 本地: 3 };

const BANK = {
  家装: {
    认知: [
      "{city}装修一般需要多长时间？",
      "半包和全包的区别到底是什么？",
      "装修顺序是怎样的，先做哪一步？",
      "老房翻新和全屋重装有什么区别？",
      "装修预算一般怎么分配比较合理？",
      "装修公司一般怎么收费？",
    ],
    比较: [
      "全包和半包怎么选更好？",
      "{comA}和{comB}哪个更适合老房翻新？",
      "{brand}和{comA}的区别在哪？",
      "整装套餐和清包哪个更省钱？",
      "局部改造和整体翻新怎么取舍？",
    ],
    决策: [
      "{city}装修公司哪家口碑比较好？",
      "{city}老房翻新大概要多少钱？",
      "{city}装修公司怎么选才不踩坑？",
      "{city}全包装修公司推荐几家？",
      "老房翻新找装修公司还是找施工队？",
    ],
    口碑: [
      "{brand}靠谱吗，有没有坑？",
      "{brand}的施工质量怎么样？",
      "{brand}增项多吗？",
      "{brand}售后和质保怎么样？",
      "装修最容易被坑的地方有哪些？",
    ],
    本地: [
      "{area}附近有哪些靠谱的装修公司？",
      "{area}装修公司推荐一下？",
      "{city}{area}老房改造找谁？",
      "{city}哪家装修公司门店可以看样板间？",
      "{area}装修大概多少钱一平？",
    ],
  },
  _default: {
    认知: ["{industry}一般怎么选？", "{industry}的常见误区有哪些？", "{industry}服务流程是怎样的？"],
    比较: ["{brand}和{comA}哪个好？", "{industry}不同方案怎么对比？", "{comA}和{comB}哪家更合适？"],
    决策: ["{city}{industry}哪家比较靠谱？", "{city}{industry}大概多少钱？", "{city}{industry}推荐几家？"],
    口碑: ["{brand}怎么样，口碑如何？", "{brand}服务态度怎么样？", "{brand}有没有坑？"],
    本地: ["{area}附近有哪些{industry}商家？", "{city}{area}{industry}推荐？", "{city}哪家{industry}可以到店咨询？"],
  },
};

// 区域名只在已知城市下使用；未知城市置空，模板里的「{area}附近」会自然变成「附近」
const AREAS_BY_CITY = {
  南京: ["河西", "江宁", "浦口", "鼓楼", "雨花台", "栖霞"],
  上海: ["徐汇", "静安", "浦东", "闵行", "杨浦"],
  北京: ["朝阳", "海淀", "丰台", "西城", "通州"],
  广州: ["天河", "越秀", "海珠", "番禺"],
  深圳: ["南山", "福田", "宝安", "龙岗"],
};

function areasOf(city) {
  const key = String(city || "").replace(/市$/, "").trim();
  return AREAS_BY_CITY[key] || [""];
}

function fill(tpl, ctx) {
  return tpl
    .replaceAll("{city}", ctx.city || "本地")
    .replaceAll("{area}", ctx.area ?? "")
    .replaceAll("{brand}", ctx.brand)
    .replaceAll("{industry}", ctx.industry || "服务")
    .replaceAll("{comA}", ctx.comA || "同行")
    .replaceAll("{comB}", ctx.comB || "另一家");
}

/** 生成提问矩阵：{ text, intent, weight }[] */
export function generatePrompts(brand, competitors = [], count = 40) {
  const bank = BANK[brand.industry] || BANK._default;
  const context = {
    city: brand.city,
    brand: brand.name,
    industry: brand.industry,
    comA: competitors[0]?.name,
    comB: competitors[1]?.name,
  };

  const out = [];
  const seen = new Set();
  const intents = Object.keys(bank);
  const areas = areasOf(brand.city);

  // 先每类各来一条，再轮转补齐，保证意图分布均衡
  const cursors = Object.fromEntries(intents.map((i) => [i, 0]));
  let guard = 0;
  while (out.length < count && guard < count * 12) {
    for (const intent of intents) {
      if (out.length >= count) break;
      const pool = bank[intent];
      const idx = cursors[intent]++;
      const area = areas[idx % areas.length];

      // 本地类需要区域轮换，其他类在模板用尽后加城市/区域变体
      let tpl = pool[idx % pool.length];
      const round = Math.floor(idx / pool.length);
      if (round > 0 && intent !== "本地") {
        tpl = pool[(idx + round) % pool.length];
      }

      const text = fill(tpl, { ...context, area });
      if (seen.has(text)) continue;
      seen.add(text);
      out.push({ text, intent, weight: INTENT_WEIGHT[intent] ?? 1 });
    }
    guard += 1;
  }
  return out;
}

/* ---------------- 答案解析 ---------------- */

const LIST_RE = /(?:^|\n)\s*(?:(\d{1,2})[.、)）]|([一二三四五六七八九十])[、.])\s*/g;
const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

function listOrder(answer) {
  const order = [];
  let m;
  LIST_RE.lastIndex = 0;
  while ((m = LIST_RE.exec(answer)) !== null) {
    order.push(m[1] ? Number(m[1]) : CN_NUM[m[2]] || 0);
  }
  return order;
}

/** 解析一条 AI 回答：是否提及、位次、竞品提及、准确度 */
export function analyzeAnswer(answer, brand, competitors = []) {
  const text = String(answer || "");
  const aliases = [brand.name, ...String(brand.alias || "").split(/[、,，\s]+/).filter(Boolean)];
  const hitIndex = aliases.findIndex((a) => a && text.includes(a));
  const mentioned = hitIndex >= 0;

  let position = 0;
  if (mentioned) {
    const order = listOrder(text);
    // 以答案中出现的品牌顺序推断位次
    const namesInAnswer = [];
    const names = [...aliases.map((a) => ({ name: a, self: true })), ...competitors.map((c) => ({ name: c.name, self: false }))];
    const found = names
      .map((n) => ({ ...n, at: text.indexOf(n.name) }))
      .filter((n) => n.at >= 0)
      .sort((a, b) => a.at - b.at);

    // 去重（品牌别名可能命中多个）
    const uniq = [];
    found.forEach((f) => {
      const dup = uniq.some((u) => (u.self && f.self) || (!u.self && !f.self && u.name === f.name));
      if (!dup) uniq.push(f);
    });

    const selfRank = uniq.findIndex((u) => u.self);
    position = selfRank >= 0 ? selfRank + 1 : order.length ? order[0] : 0;
    if (position > 20) position = 3;
  }

  const compMentioned = competitors.filter((c) => text.includes(c.name)).length;

  // 准确度：与事实卡比对关键数字（价格类）
  let accuracy = 1;
  const priceFacts = [];
  return { mentioned, position, compMentioned, accuracy: priceFacts.length ? accuracy : accuracy };
}

/** 单条得分：位次分 m × 准确度 a */
export function scoreOf(mention, position, accuracy) {
  if (!mention) return 0;
  let m;
  if (position === 1) m = 1.0;
  else if (position >= 2 && position <= 3) m = 0.85;
  else if (position >= 4 && position <= 10) m = 0.7;
  else m = 0.4;
  const a = typeof accuracy === "number" ? Math.max(0, Math.min(1, accuracy)) : 1;
  return +(m * a).toFixed(4);
}

/** 汇总一次探测（内部函数，返回单一集合的指标） */
function aggregate(runResults, prompts) {
  const byPrompt = new Map();
  for (const r of runResults) {
    if (!byPrompt.has(r.prompt_id)) byPrompt.set(r.prompt_id, []);
    byPrompt.get(r.prompt_id).push(r);
  }

  let num = 0;
  let den = 0;
  let mentioned = 0;
  let first = 0;
  let accuracySum = 0;
  let accuracyCount = 0;
  let selfMentions = 0;
  let compMentions = 0;

  const byPlatform = new Map();
  const byIntent = new Map();
  // 结果来源分布：live 真实调用 / mock 模拟 / error 失败
  const sources = { live: 0, mock: 0, error: 0 };
  const srcByPlatform = new Map();

  // 先统计来源（含 error），error 样本不参与指标计算（PRD 8.1：报错排除分母）
  runResults.forEach((r) => {
    const s = sources[r.source] !== undefined ? r.source : "mock";
    sources[s] += 1;
    const k = r.platform;
    if (!srcByPlatform.has(k)) srcByPlatform.set(k, { live: 0, mock: 0, error: 0 });
    srcByPlatform.get(k)[s] += 1;
  });

  const validResults = runResults.filter((r) => (r.source || "mock") !== "error");

  for (const p of prompts) {
    const list = (byPrompt.get(p.id) || []).filter((r) => (r.source || "mock") !== "error");
    if (!list.length) continue;
    const scores = list.map((r) => scoreOf(r.mention, r.position, r.accuracy));
    const s = scores.reduce((a, b) => a + b, 0) / scores.length;
    num += p.weight * s;
    den += p.weight;

    list.forEach((r) => {
      if (r.mention) {
        mentioned += 1;
        if (r.position >= 1 && r.position <= 3) first += 1;
        // 识别准确率只统计「被提及」的答案，未提及不等于说错
        accuracySum += r.accuracy;
        accuracyCount += 1;
      }
      selfMentions += r.mention ? 1 : 0;
      compMentions += r.comp_mentions || 0;

      const pk = r.platform;
      const srcCount = srcByPlatform.get(pk) || { live: 0, mock: 0, error: 0 };
      if (!byPlatform.has(pk))
        byPlatform.set(pk, {
          platform: pk, num: 0, den: 0, n: 0, mentioned: 0, first: 0,
          live: srcCount.live, mock: srcCount.mock, error: srcCount.error,
        });
      const ps = byPlatform.get(pk);
      ps.num += scoreOf(r.mention, r.position, r.accuracy);
      ps.den += 1;
      ps.n += 1;
      if (r.mention) ps.mentioned += 1;
      if (r.mention && r.position >= 1 && r.position <= 3) ps.first += 1;

      const ik = p.intent;
      if (!byIntent.has(ik)) byIntent.set(ik, { intent: ik, num: 0, den: 0 });
      const is = byIntent.get(ik);
      is.num += scoreOf(r.mention, r.position, r.accuracy);
      is.den += 1;
    });
  }

  const total = validResults.length || 1;
  const avi = den ? Math.round((100 * num) / den) : 0;
  const sov = selfMentions + compMentions ? Math.round((selfMentions / (selfMentions + compMentions)) * 1000) / 10 : 0;

  // 平台行：包括“全失败”的平台，让数据缺失在界面上可见
  const platformRows = [...byPlatform.values()].map((p) => ({
    platform: p.platform,
    avi: p.den ? Math.round((100 * p.num) / p.den) : 0,
    mentionRate: Math.round((p.mentioned / (p.n || 1)) * 1000) / 10,
    firstRate: Math.round((p.first / (p.n || 1)) * 1000) / 10,
    samples: p.n,
    source: p.live > 0 ? "live" : p.mock > 0 ? "mock" : "error",
    live: p.live,
    mock: p.mock,
    error: p.error,
  }));
  for (const [k, c] of srcByPlatform) {
    if (!byPlatform.has(k)) {
      platformRows.push({
        platform: k,
        avi: 0,
        mentionRate: 0,
        firstRate: 0,
        samples: 0,
        source: "error",
        live: c.live,
        mock: c.mock,
        error: c.error,
      });
    }
  }

  return {
    avi,
    mentionRate: Math.round((mentioned / total) * 1000) / 10,
    firstRate: Math.round((first / total) * 1000) / 10,
    accuracy: Math.round((accuracySum / (accuracyCount || 1)) * 1000) / 10,
    sov,
    sources,
    byPlatform: platformRows,
    byIntent: [...byIntent.values()].map((p) => ({
      intent: p.intent,
      avi: p.den ? Math.round((100 * p.num) / p.den) : 0,
    })),
  };
}

/* ---------------- 证据等级与双轨指标 ----------------
   A = C 端网页/App 实测（可作交付依据）
   B = 带联网搜索的 API（近似，仅供参考）
   C = 裸模型 API（只反映参数化记忆）
   M = 模拟数据（不可用于任何结论）
----------------------------------------------------- */

export function gradeOf(row) {
  if (row.channel === "cend") return "A";
  if (row.channel === "api_search") return "B";
  if (row.channel === "api_raw") return "C";
  if (row.channel === "mock") return "M";
  // 兼容旧数据：按 source 推定
  if (row.source === "live") return "C";
  return "M";
}

export function channelOf(row) {
  if (row.channel) return row.channel;
  return row.source === "live" ? "api_raw" : "mock";
}

/** 对外的汇总入口：整体 + 按证据等级拆开 */
export function summarize(runResults, prompts) {
  const base = aggregate(runResults, prompts);

  const buckets = { A: [], B: [], C: [], M: [] };
  runResults.forEach((r) => {
    const g = gradeOf(r);
    (buckets[g] || (buckets[g] = [])).push(r);
  });

  const aviByGrade = {};
  const countByGrade = {};
  Object.keys(buckets).forEach((g) => {
    const rows = buckets[g] || [];
    countByGrade[g] = rows.length;
    aviByGrade[g] = rows.length ? aggregate(rows, prompts).avi : null;
  });

  return { ...base, aviByGrade, countByGrade };
}

/**
 * 四象限：用两个独立指标交叉出结论，而不是汇成单分
 * aviCend 为 null 表示尚未做 C 端取证——必须诚实标未取证，不能拿 C 级数字顶替
 */
export function quadrantOf({ aviCend, aviModel }, threshold = 50) {
  if (aviCend === null || aviCend === undefined) {
    return {
      key: "unknown",
      label: "尚未取证",
      diagnosis: `目前只有模型倾向（${aviModel ?? 0}），缺 C 端真实呈现数据。模型 API 测不到地理位置、“附近”意图与平台产品层策略，不能当作客户可见度结论交付。`,
      action: "先做一轮 C 端取证（建议 20 条购买意图问题 × 6 平台）",
      tone: "warn",
    };
  }
  const m = aviModel ?? 0;
  const hi = threshold;
  if (aviCend >= hi && m >= hi) {
    return { key: "healthy", label: "健康", diagnosis: `C 端 ${aviCend}、模型倾向 ${m}，两头都站得住。`, action: "把预算转向竞品领先的意图场景", tone: "ok" };
  }
  if (aviCend < hi && m >= hi) {
    return {
      key: "retrieval-gap",
      label: "模型认识你，检索未命中",
      diagnosis: `模型认识你（倾向 ${m}），但用户实际很少看到（C 端 ${aviCend}）——问题出在实时检索没有命中你的可用信源。`,
      action: "优先补外部信源：高 AIW 媒体、可引用段落、爬虫可抓取性，2–8 周可见效",
      tone: "warn",
    };
  }
  if (aviCend >= hi && m < hi) {
    return {
      key: "fragile",
      label: "根基不稳",
      diagnosis: `C 端可见度 ${aviCend} 不错，但模型倾向只有 ${m}——你现在靠实时抓取撑着，平台一改版就会掉。`,
      action: "补长期资产：百科词条、行业媒体、结构化与榜单 mention",
      tone: "warn",
    };
  }
  return {
    key: "absent",
    label: "长期缺失",
    diagnosis: `C 端 ${aviCend}、模型倾向 ${m}，两头都低，品牌在 AI 里基本隐形。`,
    action: "先建知识库与产品库口径 → 生产可引用内容 → 集中投放高权重信源",
    tone: "bad",
  };
}

/** 内容可引用性评分 GEOS（0~100），规则版。六维之和 = 总分 */
export function scoreContent(text, consistency = 10) {
  const t = String(text || "");
  const chars = t.replace(/\s/g, "").length || 1;
  const segments = Math.max(1, Math.floor(chars / 300));
  const factSentences = (t.match(/[^。！？\n]*\d[^。！？\n]*[。！？]/g) || []).length;
  const qa = (t.match(/Q[:：]/g) || []).length;
  // 结论前置：前 160 字内有明确结论标记，或带单位的事实数字；
  // 旧规则只找「元/天/年…」，连「年限」的「年」都算命中，对成段论述反而不给分
  const hasLead = /^[\s\S]{0,160}(结论先行|结论先看|\d+\s*(?:元|天|年|㎡|项|家|%|万))/.test(t);

  const density = Math.min(20, Math.round((factSentences / segments) * 12));
  const structure = Math.min(20, (qa >= 3 ? 12 : qa * 4) + (/[一二三四五六七八九十]、|^\d[.、]/m.test(t) ? 8 : 0));
  const leadScore = hasLead ? 15 : 6;
  // 实体完整：旧规则只认「有限公司 / 装饰 / 门店」，软件与开源项目天然被判低分
  const hasEntityWords = /有限公司|装饰|门店|地址|电话|所属行业|所在城市|品牌全称/.test(t);
  const entity = Math.min(15, (hasEntityWords ? 9 : 4) + (/元|天|¥|\d+\s*年/.test(t) ? 4 : 0));
  const source = Math.min(20, (t.match(/来源|据|20\d\d/g) || []).length * 5);
  // 口径一致：由调用方传入（存在事实卡冲突时应降分），默认满分
  const consistent = Math.max(0, Math.min(10, Math.round(consistency)));

  const geos = Math.min(100, density + structure + leadScore + entity + source + consistent);

  return {
    geos,
    dims: [
      { k: "事实密度", v: density, max: 20 },
      { k: "结构化", v: structure, max: 20 },
      { k: "结论前置", v: leadScore, max: 15 },
      { k: "实体完整", v: entity, max: 15 },
      { k: "数据来源", v: source, max: 20 },
      { k: "口径一致", v: consistent, max: 10 },
    ],
  };
}
