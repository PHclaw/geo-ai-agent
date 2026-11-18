/* ============================================================
   Agent 工作台：一句话 → 意图、参数与可编辑字段（纯函数，无 IO）
   - 只做确定性规则匹配，不调用任何模型
   - 参数分「用户给的」与「默认的」，默认项要在界面上标出来让人改
   - 识别不到具体动作时走知识库问答（chat），不硬拦成预设
   ============================================================ */

export const AGENT_PRESETS = [
  {
    key: "produce",
    label: "内容生产",
    hint: "按提问意图生成一篇文章并入库",
    example: "给 AgentFlow 生成一篇比较类文章",
  },
  {
    key: "schedule",
    label: "发布排期",
    hint: "生成养号 + GEO 穿插计划（只落计划，不代发）",
    example: "按 4 条养号、3:1 穿插生成 4 周排期",
  },
  {
    key: "placement",
    label: "媒体投放",
    hint: "按预算给出媒体组合建议，不下单",
    example: "1 万元预算，投 AI 行业媒体",
  },
  {
    key: "analyze",
    label: "GEO 数据分析",
    hint: "汇总 AI 可见度、SEO 曝光与缺口",
    example: "看一下现在的 AI 可见度和缺口",
  },
  {
    key: "profile",
    label: "品牌建档",
    hint: "带着品牌信息去建档向导",
    example: "新建品牌：星野咖啡，杭州，精品咖啡",
  },
];

/** 寒暄与能力询问：不该走知识库检索，直接给引导 */
const GREET_RE =
  /^(?:你好|您好|hi|hello|嗨|在吗|早上好|晚上好|谢谢|感谢|你是谁|你能做什么|你会什么|你怎么用|怎么用|有什么用|能干什么|介绍一下你)[\s!！。~?？]*$/i;

/** 顺序有意义：越具体的动作越先匹配 */
const RULES = [
  { intent: "schedule", re: /(排期|排班|发布计划|发布节奏|养号|穿插)/ },
  { intent: "placement", re: /(投放|预算|买量|媒体组合|投哪些媒体|投媒体|投放计划)/ },
  { intent: "profile", re: /(建档|新建品牌|录入品牌|品牌资料|补充品牌|创建品牌)/ },
  { intent: "analyze", re: /(分析|诊断|可见度|avi|排名|曝光|缺口|竞品|现状|表现)/i },
  { intent: "produce", re: /(写|生成|创作|出稿|文章|稿子|攻略|内容)/ },
];

const GENRE_RULES = [
  { re: /(比较|对比|选型|vs|差异|哪个好)/i, genre: "比较", promptIntent: "比较" },
  { re: /(推荐|排行|榜单|哪家)/, genre: "推荐", promptIntent: "比较" },
  { re: /(口碑|评价|怎么样|靠谱吗)/, genre: "口碑", promptIntent: "口碑" },
  { re: /(本地|附近|同城|服务区域)/, genre: "本地", promptIntent: "本地" },
  { re: /(怎么选|如何|核验|注意|避坑|清单)/, genre: "攻略", promptIntent: "决策" },
];

function pickGenre(text) {
  const hit = GENRE_RULES.find((r) => r.re.test(text));
  if (hit) return { genre: hit.genre, promptIntent: hit.promptIntent };
  return { genre: "攻略", promptIntent: "认知" };
}

function pickNumber(text, re) {
  const m = String(text).match(re);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function routeIntent(raw) {
  const text = String(raw || "").trim();
  if (!text) return { intent: "greet", label: "对话", params: {}, provided: [], matched: "" };

  if (GREET_RE.test(text)) {
    return { intent: "greet", label: "对话", params: { query: text }, provided: ["query"], matched: text };
  }

  const rule = RULES.find((r) => r.re.test(text));
  if (!rule) {
    return { intent: "chat", label: "自由问答", params: { query: text }, provided: ["query"], matched: "" };
  }

  const params = {};
  const provided = [];
  const set = (key, val) => {
    if (val === null || val === undefined) return;
    params[key] = val;
    provided.push(key);
  };

  if (rule.intent === "produce") {
    const g = pickGenre(text);
    params.genre = g.genre;
    params.promptIntent = g.promptIntent;
    if (GENRE_RULES.some((r) => r.re.test(text))) provided.push("genre", "promptIntent");
  }

  if (rule.intent === "schedule") {
    const warmup = pickNumber(text, /(\d+)\s*条?\s*(?:养号|知识)/);
    const ratio = pickNumber(text, /(\d+)\s*[:：]\s*1/);
    const weeks = pickNumber(text, /(\d+)\s*周/);
    const interval = pickNumber(text, /(?:间隔|每)\s*(\d+)\s*天/);
    params.warmupCount = warmup ?? 4;
    params.ratio = ratio ?? 3;
    params.weeks = weeks ?? 4;
    params.intervalDays = interval ?? 2;
    if (warmup !== null) provided.push("warmupCount");
    if (ratio !== null) provided.push("ratio");
    if (weeks !== null) provided.push("weeks");
    if (interval !== null) provided.push("intervalDays");
  }

  if (rule.intent === "placement") {
    const wan = pickNumber(text, /(\d+(?:\.\d+)?)\s*万/);
    const yuan = pickNumber(text, /(\d+)\s*元/);
    const budget = wan ? Math.round(wan * 10000) : yuan || 10000;
    params.budget = budget;
    if (wan || yuan) provided.push("budget");
  }

  if (rule.intent === "profile") {
    const m = text.match(/(?:新建品牌|建档|创建品牌)[:：]?\s*([^，,；;]+)[，,；;]\s*([^，,；;]+)[，,；;]\s*(.+)$/);
    if (m) {
      set("name", m[1].trim().slice(0, 40));
      set("city", m[2].trim().slice(0, 20));
      set("industry", m[3].trim().slice(0, 40));
    }
  }

  return {
    intent: rule.intent,
    label: AGENT_PRESETS.find((p) => p.key === rule.intent)?.label || rule.intent,
    params,
    provided,
    matched: (text.match(rule.re) || [""])[0],
  };
}

/** 每个意图的可编辑参数；value 为解析值或默认值，provided 决定界面上是否标「默认」 */
export function fieldsFor(intent, params = {}, provided = []) {
  const make = (key, label, type, extra = {}) => {
    const has = params[key] !== undefined && params[key] !== "";
    return {
      key,
      label,
      type,
      value: has ? params[key] : extra.defaultValue ?? "",
      fromUser: provided.includes(key),
      ...extra,
    };
  };

  switch (intent) {
    case "produce":
      return [
        make("genre", "体裁", "select", { options: ["攻略", "比较", "推荐", "口碑", "本地"], defaultValue: "攻略" }),
        make("promptIntent", "提问意图", "select", { options: ["认知", "比较", "决策", "口碑", "本地"], defaultValue: "认知" }),
      ];
    case "schedule":
      return [
        make("warmupCount", "养号条数", "number", { min: 0, max: 20, defaultValue: 4 }),
        make("ratio", "知识 : GEO", "number", { min: 1, max: 9, defaultValue: 3 }),
        make("weeks", "周期（周）", "number", { min: 1, max: 12, defaultValue: 4 }),
        make("intervalDays", "间隔（天）", "number", { min: 1, max: 14, defaultValue: 2 }),
      ];
    case "placement":
      return [make("budget", "预算（元）", "number", { min: 1000, max: 1000000, step: 1000, defaultValue: 10000 })];
    case "profile":
      return [
        make("name", "品牌名", "text"),
        make("city", "城市", "text"),
        make("industry", "行业", "text"),
        make("siteUrl", "官网", "text"),
      ];
    default:
      return [];
  }
}

/** 有副作用的动作（会覆盖未发布计划）在参数不完整时先确认 */
export function needsConfirm(intent, provided, overrides = {}) {
  if (intent !== "schedule") return false;
  const keys = ["warmupCount", "ratio", "weeks", "intervalDays"];
  const anyOverride = Object.keys(overrides).some((k) => keys.includes(k));
  return !anyOverride && !keys.some((k) => provided.includes(k));
}

const STOP_WORDS =
  /(什么|怎么|如何|哪些|哪个|需要|可以|能否|是否|我们|你们|他们|这个|那个|一个|请问|帮我|一下|支持|介绍|说说|准备|方式|情况|相关|内容|主要|一般|整体|具体|东西|事情|时候|问题|方面|部分)/g;

/** 中文取 2-gram（去停用词），英文/数字取整词；英文只作加分，不作硬条件 */
function queryTokens(text) {
  const s = String(text || "").toLowerCase();
  const zh = s.replace(/[^\u4e00-\u9fff]/g, "").replace(STOP_WORDS, "");
  const grams = [];
  for (let i = 0; i < zh.length - 1; i += 1) grams.push(zh.slice(i, i + 2));
  const en = [...s.matchAll(/[a-z][a-z0-9]{2,}/g)].map((m) => m[0]);
  return { grams: [...new Set(grams)], en: [...new Set(en)] };
}

/** 片段可用性：过滤章节标题、编号碎片、引用块、表格与代码块 */
function usableSnippet(text) {
  const s = String(text || "").trim();
  if (s.length < 24) return false;
  if (/^(?:[一二三四五六七八九十]+、|\d+(?:\.\d+)*\s|\d+[）)])/.test(s)) return false;
  if (/^(?:```|>|\||-{3,}|={3,}|#)/.test(s)) return false;
  if (/\|\s*-{3,}/.test(s)) return false;
  return true;
}

/**
 * 问答召回筛选：先按可用性过滤，再要求查询与片段有至少两个实词二元组重叠。
 * 中文 BM25 容易把「需要 / 准备」这类虚词匹配到无关段落，这里做一层确定性校验。
 */
export function selectAnswerHits(query, hits = [], limit = 4) {
  const { grams, en } = queryTokens(query);
  const need = Math.min(2, grams.length);
  return (Array.isArray(hits) ? hits : [])
    .filter((h) => usableSnippet(h?.text))
    .filter((h) => {
      const t = String(h.text).toLowerCase();
      if (grams.length) return grams.filter((g) => t.includes(g)).length >= need;
      if (en.length) return en.some((w) => t.includes(w));
      return true;
    })
    .slice(0, limit);
}

export function describeIntent(r) {
  switch (r.intent) {
    case "produce":
      return `按「${r.params.genre}」体裁、面向「${r.params.promptIntent}」类问题生成一篇模板文章，并做事实回比与合规检查。`;
    case "schedule":
      return `按养号 ${r.params.warmupCount} 条、知识:GEO = ${r.params.ratio}:1、${r.params.weeks} 周、每 ${r.params.intervalDays} 天一条生成排期（只落计划，不代发）。`;
    case "placement":
      return `按 ${r.params.budget} 元预算，从媒体库按 AIW 从高到低给出组合建议，不会自动下单。`;
    case "analyze":
      return "汇总最新的 AI 可见度、SEO 曝光与关键词缺口。";
    case "profile":
      return "把解析到的品牌信息带到建档向导，由你确认后创建。";
    default:
      return "";
  }
}
