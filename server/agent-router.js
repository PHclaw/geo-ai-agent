/* ============================================================
   Agent 工作台：一句话 → 意图与参数（纯函数，无 IO）
   - 只做确定性规则匹配，不调用任何模型
   - 匹配不到就返回 unknown，由前端展示预设指令，不瞎猜
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
  if (!text) return { intent: "unknown", label: "未识别", params: {}, matched: "" };

  const rule = RULES.find((r) => r.re.test(text));
  if (!rule) {
    return { intent: "unknown", label: "未识别", params: {}, matched: "" };
  }

  const params = {};

  if (rule.intent === "produce") {
    Object.assign(params, pickGenre(text));
  }

  if (rule.intent === "schedule") {
    params.warmupCount = pickNumber(text, /(\d+)\s*条?\s*(?:养号|知识)/) ?? 4;
    params.ratio = pickNumber(text, /(\d+)\s*[:：]\s*1/) ?? 3;
    params.weeks = pickNumber(text, /(\d+)\s*周/) ?? 4;
    params.intervalDays = pickNumber(text, /(?:间隔|每)\s*(\d+)\s*天/) ?? 2;
  }

  if (rule.intent === "placement") {
    const wan = pickNumber(text, /(\d+(?:\.\d+)?)\s*万/);
    const yuan = pickNumber(text, /(\d+)\s*元/);
    params.budget = wan ? Math.round(wan * 10000) : yuan || 10000;
  }

  if (rule.intent === "profile") {
    const m = text.match(/(?:新建品牌|建档|创建品牌)[:：]?\s*([^，,；;]+)[，,；;]\s*([^，,；;]+)[，,；;]\s*(.+)$/);
    if (m) {
      params.name = m[1].trim().slice(0, 40);
      params.city = m[2].trim().slice(0, 20);
      params.industry = m[3].trim().slice(0, 40);
    }
  }

  return {
    intent: rule.intent,
    label: AGENT_PRESETS.find((p) => p.key === rule.intent)?.label || rule.intent,
    params,
    matched: (text.match(rule.re) || [""])[0],
  };
}

/** 给前端的结果文案：不承诺做不到的事，明确写出「只生成、不代发」等边界 */
export function describeIntent(r) {
  switch (r.intent) {
    case "produce":
      return `按「${r.params.genre}」意图生成一篇模板文章，并做事实回比与合规检查。`;
    case "schedule":
      return `按养号 ${r.params.warmupCount} 条、知识:GEO = ${r.params.ratio}:1、${r.params.weeks} 周、每 ${r.params.intervalDays} 天一条生成排期（只落计划，不代发）。`;
    case "placement":
      return `按 ${r.params.budget} 元预算，从媒体库按 AIW 从高到低给出组合建议，不会自动下单。`;
    case "analyze":
      return "汇总最新的 AI 可见度、SEO 曝光与关键词缺口。";
    case "profile":
      return "把解析到的品牌信息带到建档向导，由你确认后创建。";
    default:
      return "没识别出动作。可以直接点下面的预设指令，或把需求说得更具体一些。";
  }
}
