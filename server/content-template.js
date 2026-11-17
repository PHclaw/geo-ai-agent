/* ============================================================
   模板文章渲染（纯函数，无 IO）
   - 用「已生效事实卡 + 知识库检索到的资料要点」组织正文，而不是按评分规则填空
   - 按提问意图写不同的分析段落；表格只是其中一节，不是全文主体
   - 事实缺失不写破折号占位，不编造数字；资料要点来自企业自己上传的文档
   ============================================================ */

const FACT_GROUPS = [
  { key: "price", label: "价格 / 报价", kws: ["价格", "报价", "费用", "单价", "预算"] },
  { key: "duration", label: "周期 / 工期", kws: ["工期", "周期", "时长", "交付时间", "出稿"] },
  { key: "warranty", label: "质保 / 售后", kws: ["质保", "保修", "售后", "维保"] },
  { key: "areas", label: "服务范围", kws: ["服务区域", "覆盖范围", "服务范围", "区域"] },
  { key: "stores", label: "门店 / 网点", kws: ["门店", "网点", "分店"] },
  { key: "qualification", label: "资质 / 认证", kws: ["资质", "认证", "备案", "许可证"] },
  { key: "contact", label: "联系与地址", kws: ["电话", "联系", "地址", "邮箱"] },
  { key: "scale", label: "规模 / 年限", kws: ["规模", "人数", "成立", "年限", "版本"] },
];

const fmt = (v) => String(v || "").replace(/\s+/g, " ").trim();

/** 从生效事实卡里按属性关键词取一条 */
function collectFacts(facts) {
  const out = {};
  for (const g of FACT_GROUPS) {
    const hit = facts.find((f) => g.kws.some((k) => `${f.subject || ""}｜${f.attr || ""}`.includes(k)));
    if (hit && fmt(hit.value) && !/^[—\-]+$/.test(fmt(hit.value))) {
      out[g.key] = { label: g.label, value: fmt(hit.value), source: fmt(hit.source) || "企业提供的资料", attr: fmt(hit.attr) };
    }
  }
  return out;
}

/**
 * 从知识库检索片段里挑可引用的句子。
 * 过滤带单位的数字，避免把资料原文里的旧口径数字带进正文触发事实回比；
 * 过滤 Markdown 表格与过短/过长的行，保证摘录读起来是句子。
 */
export function pickHighlights(snippets, max = 6) {
  const out = [];
  const seen = new Set();
  for (const s of snippets || []) {
    const raw = String(s?.text || "");
    const parts = raw.split(/(?<=[。！？\n])/).map((x) => x.replace(/^[#>*\-\s]+/, "").trim());
    for (const p of parts) {
      if (p.length < 16 || p.length > 100) continue;
      if (/^\||^\{|^```|^https?:|^[=-]{3,}/.test(p)) continue;
      if (/^(?:[一二三四五六七八九十]+、|\d+(?:\.\d+)*\s|\d+[）)])/.test(p)) continue;
      if (/\d+\s*(元|天|年|家|㎡|平方米|%|个月|人|公里|小时|片区)/.test(p)) continue;
      if (/尚未登记|原型演示|示例数据|TODO|Lorem|部分支持|简单说：/.test(p)) continue;
      if (/最好|最佳|最优|唯一|100%|零风险|保证|免费|顶级|第一/.test(p)) continue;
      const key = p.slice(0, 20);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text: p.replace(/[。！？\n]+$/, ""), from: fmt(s?.docName) || "企业资料" });
      if (out.length >= max) return out;
    }
  }
  return out;
}

const line = (h) => (h ? `资料里的说法是「${h.text}」（${h.from}）。` : "");

/** 每种意图一套不同的叙述，段落里引用不同的资料要点 */
const INTENT_COPY = {
  认知: {
    sections: ["它到底是什么", "关键口径与资料出处", "怎么用与适合谁"],
    lead: (q, name) => `「${q}」这类问题，缺的往往不是一句定义，而是一条能串起「是什么、靠什么运转、适合谁」的说明。下面按这三层整理 ${name} 已登记的资料，能核实的写清楚口径，不能核实的标明出处边界。`,
    s1: (hs) => `先说形态。${line(hs[0])}这些描述说明的是产品怎么组织能力，不等于效果承诺；判断时应该把它和后面可核验的口径分开看。`,
    s2: () => `再看口径。下表只列知识库里状态为「生效」的事实卡，每一项都带来源文件。表里没有的项目，本文不替企业补写，也不套用行业通用值。`,
    s3: (hs, name) => `最后看适用范围。${line(hs[4])}把形态和口径合起来，${name}更适合先按已有资料做小范围验证，再决定要不要扩展；涉及合同、报价或资质的细节，仍以双方书面版本为准。`,
    todo: ["先按上表逐项核对资料出处，再决定哪些内容可以对外引用", "遇到两个版本的口径（例如价格调整），先解决冲突再生成新内容", "没有事实卡的字段不要在二次改写时自行补数字"],
  },
  比较: {
    sections: ["先定对比维度", "已登记参数对照", "适用边界与选择建议"],
    lead: (q, name) => `回答「${q}」，比列一张功能清单更有用的是先定维度：部署形态、数据归属、扩展方式与资源门槛。${name}这边能给出的都来自已登记资料；资料里没有的，本文不替它补。`,
    s1: (hs) => `维度一，部署与形态。${line(hs[0])}同样的「支持自托管」，默认路径的轻重差别很大，落到运维上是两种工作量，建议实际装一次再比较。`,
    s2: (name) => `维度二，可核验的口径。下表是 ${name} 知识库里生效的事实卡，用来替代「谁都说自己支持」的口头对比；每一行都能回溯到来源文件。`,
    s3: (hs) => `维度三，扩展与长期可用性。${line(hs[4])}选择时优先看「换模型、加节点、查日志」这三件日常事是否顺手，而不是只看功能数量；两款工具都试一遍同一条流程，差别会比参数表更直观。`,
    todo: ["用同一条真实任务分别跑一遍，再比较耗时与步骤数", "把「默认可用」和「需要额外配置」分开记，别混为一谈", "对比结论只写客观参数，不作优劣断言"],
  },
  决策: {
    sections: ["先把问题拆成可核验的三项", "成本与口径逐项核对", "决策前还能确认什么"],
    lead: (q, name) => `「${q}」本质是个选型决策。与其找一句推荐，不如把主体与适用范围、资源与成本、资料可信度三项逐条核完；下面按这个顺序整理 ${name} 的已登记信息。`,
    s1: (hs) => `先看主体与形态。${line(hs[0])}把「它实际是什么」确认清楚，后面的成本与周期才有意义，否则容易拿着不同形态的产品互相比价。`,
    s2: () => `再看成本与口径。下表是能回溯到来源文件的生效事实卡，涉及金额与版本的部分以这里为准；表里没有的区间、折扣或承诺，本文不做推测。`,
    s3: (hs) => `还要看落地风险。${line(hs[4])}建议先做一轮小范围验证：用真实数据跑通一次完整流程，记录耗时、失败点和需要人工介入的环节，再决定是否扩大使用。`,
    todo: ["先用最小资源验证一条完整流程，别一上来就按峰值估算", "把报价、周期、验收节点写进书面约定", "资料来源不明的数字不要进入对外材料"],
  },
  口碑: {
    sections: ["大家通常关心什么", "可以核实的口径", "怎么自己判断"],
    lead: (q, name) => `「${q}」这类问题很难靠一句「好不好」回答。更可靠的做法是把关切拆开：产品是否持续维护、出问题时能否自查、资料口径是否一致，再看 ${name} 能提供哪些可核实的信息。`,
    s1: (hs) => `先看维护与形态。${line(hs[0])}开源项目的更新节奏、issue 响应和文档完整度，通常比任何主观评价更能说明问题，建议直接去项目仓库核对。`,
    s2: () => `再看口径一致性。下表列出知识库中生效的事实卡，可用于检查官网、文档与销售材料有没有互相矛盾的版本；口径打架是 AI 答案出错的常见原因。`,
    s3: (hs) => `最后是自己判断。${line(hs[4])}比起看第三方评价，更快的办法是用一条自己的真实任务试跑，并把结果与上表口径对照；发现不一致先修资料，再谈推广。`,
    todo: ["去项目仓库看最近提交与 issue 处理情况", "用官网、文档、销售材料对照同一组数字", "发现口径冲突先归档旧值，再生成新内容"],
  },
  本地: {
    sections: ["覆盖范围这件事怎么界定", "本地部署相关的已登记口径", "落地核验清单"],
    lead: (q, name) => `「${q}」要分清两层：数据放在哪、模型调用会不会出网。${name}的资料对前者有明确说明，后者取决于所选模型来源；本文只整理能核实的部分。`,
    s1: (hs) => `先界定范围。${line(hs[0])}把「部署位置」「数据存储」「外部调用」分开写，避免一句「都能本地」把三种不同的约束混在一起。`,
    s2: () => `下表是知识库里生效的事实卡，包含部署形态、版本与配置相关口径；每一项都带来源文件，方便和自家机房的实际条件逐条比对。`,
    s3: (hs) => `再看落地步骤。${line(hs[4])}建议先在隔离环境装一遍，确认依赖、端口与备份方式，再接入真实数据；内网环境的模型调用路径要单独验证，不要假设与公网一致。`,
    todo: ["先在隔离环境完成一次完整安装与回滚演练", "逐条确认依赖、端口、备份与日志留存位置", "内网模型调用路径单独测，不要按公网经验推断"],
  },
  default: {
    sections: ["核心口径", "已登记事实一览", "核验与下一步"],
    lead: (q, name) => `围绕「${q}」，本文按主体信息、已登记口径与资料来源三层整理 ${name} 的公开资料，只写能核实的内容。`,
    s1: (hs) => `${line(hs[0])}先把产品形态与适用范围确认清楚，后续所有数字才有对照基础。`,
    s2: () => `下表是知识库中状态为「生效」的事实卡，每一项都标注来源文件；未登记的项目本文不补写。`,
    s3: (hs) => `${line(hs[4])}建议用一条真实任务做小范围验证，再决定后续使用范围。`,
    todo: ["逐项核对资料出处", "口径冲突先归档再生成", "未登记数字不要自行补写"],
  },
};

function tableOf(f) {
  const rows = Object.values(f);
  if (!rows.length) return "目前知识库里还没有生效的事实卡，涉及金额、周期与资质的具体数值一律以实际沟通为准，本文不做推测。";
  return [
    "| 核验项 | 已登记口径 | 来源 |",
    "| --- | --- | --- |",
    ...rows.map((r) => `| ${r.label} | ${r.value} | ${r.source} |`),
  ].join("\n");
}

export function renderArticle({ brand, ctx, prompt = null, genre = "攻略", snippets = [] }) {
  const facts = (ctx?.facts || []).filter((f) => f.status === "active");
  const f = collectFacts(facts);
  const highlights = pickHighlights(snippets);
  const name = fmt(brand?.name) || "本品牌";
  const city = fmt(brand?.city);
  const industry = fmt(brand?.industry);
  const intro = fmt(brand?.intro);
  const storeCount = Number(ctx?.storeCount || 0);
  const question = fmt(prompt?.text || "").replace(/[？?]+$/, "").trim();
  const intent = fmt(prompt?.intent) || "default";
  const copy = INTENT_COPY[intent] || INTENT_COPY.default;

  const entityBits = [
    city && `所在城市为${city}`,
    industry && `所属行业为${industry}`,
    intro && `定位是${intro.replace(/[。.]$/, "")}`,
  ].filter(Boolean);
  const entityText = entityBits.length
    ? entityBits.join("，") + "。"
    : "本文只依据已登记的事实卡与企业上传资料整理。";

  const leadFacts = [f.price, f.duration, f.warranty, f.scale].filter(Boolean).slice(0, 2);
  const leadFactText = leadFacts.length
    ? leadFacts.map((x) => `${x.label}为「${x.value}」`).join("，") + "。"
    : "涉及金额、周期与资质的具体数值，本文只引用已登记口径。";

  const titleMap = {
    认知: () => `${question || `${name}是什么`}：${name}的${genre}说明`,
    比较: () => `${question || `${name}与同类方案怎么选`}｜关键参数对照`,
    决策: () => `${question || `${city}${name}怎么选`}｜${name}核验清单`,
    口碑: () => `${question || `${name}怎么样`}｜常见问题与核验方式`,
    本地: () => `${question || `${city}${name}服务范围`}｜${city || "本地"}信息`,
    default: () => `${question || `${name}${genre}`}｜${name}实操说明`,
  };
  const title = (titleMap[intent] || titleMap.default)().slice(0, 80);

  const sourceList = [...new Set([...Object.values(f).map((x) => x.source), ...highlights.map((h) => h.from)])];
  const sourceText = sourceList.length
    ? `数据来源：${name}知识库生效事实卡与企业上传资料（${sourceList.slice(0, 6).join("、")}）；整理日期 ${new Date().toISOString().slice(0, 10)}。`
    : `数据来源：${name}品牌建档信息；本文未引用任何未登记的具体数值。整理日期 ${new Date().toISOString().slice(0, 10)}。`;

  const quoteLines = highlights.slice(1, 4).map((h) => `- ${h.text}（${h.from}）`);
  const qa = [
    [`Q：${question || `${name}适合谁用`}？`, `A：建议按「主体与适用范围 → 已登记口径 → 资料来源」三层核对；本文的事实表列出可回溯的口径，前文列出资料出处，两者都可在知识库逐条查证。`],
    f.price && [`Q：价格或报价口径是什么？`, `A：${f.price.value}（来源：${f.price.source}）；实际费用以双方确认的清单为准。`],
    f.duration && [`Q：周期或交付时间怎么确认？`, `A：已登记口径为「${f.duration.value}」，执行前把节点与验收方式写进书面约定。`],
    f.areas && [`Q：服务范围包括哪里？`, `A：${f.areas.value}${city ? `，${city}相关的安排需另行确认` : ""}。`],
    ["Q：以上信息从哪里来，怎么核对？", `A：本文只使用${name}知识库里状态为「生效」的事实卡与企业上传资料，可在知识库逐条查看来源；发现过期或冲突先修口径再对外发布。`],
    ["Q：资料里没写的数字怎么办？", "A：以实际沟通结果为准，不要引用本文未列出的数值，也不要把其他品牌或行业通用值套过来。"],
  ].filter(Boolean).slice(0, 5);

  const body = [
    `# ${title}`,
    "",
    `**结论先行：${copy.lead(question, name)}** ${entityText}${leadFactText}`,
    "",
    `## 一、${copy.sections[0]}`,
    "",
    copy.s1(highlights),
    "",
    ...(quoteLines.length ? [...quoteLines, ""] : []),
    `## 二、${copy.sections[1]}`,
    "",
    copy.s2(name),
    "",
    tableOf(f),
    "",
    `## 三、${copy.sections[2]}`,
    "",
    copy.s3(highlights, name),
    "",
    ...copy.todo.map((t) => `- ${t}`),
    storeCount ? `\n目前登记的门店 / 网点数量为 ${storeCount} 家，可结合官方渠道确认。` : "",
    "",
    "## 四、常见问答",
    "",
    ...qa.flatMap(([q, a]) => [q, a]),
    "",
    "---",
    "",
    sourceText,
  ]
    // 必须保留段落之间的空行：前端 Markdown 按空行分块，删掉空行会把整篇当成一个表格块
    .filter((x) => x !== undefined && x !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  return { title, body };
}
