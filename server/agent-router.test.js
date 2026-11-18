import test from "node:test";
import assert from "node:assert/strict";
import {
  routeIntent,
  describeIntent,
  fieldsFor,
  needsConfirm,
  selectAnswerHits,
  AGENT_PRESETS,
} from "./agent-router.js";

test("内容生产：识别比较意图与匹配的提问意图", () => {
  const r = routeIntent("给 AgentFlow 生成一篇比较类文章");
  assert.equal(r.intent, "produce");
  assert.equal(r.params.genre, "比较");
  assert.equal(r.params.promptIntent, "比较");
  assert.ok(r.provided.includes("genre"));
});

test("排期优先于生产，并区分用户给的和默认的", () => {
  const r = routeIntent("按 4 条养号、3:1 穿插生成 4 周排期");
  assert.equal(r.intent, "schedule");
  assert.equal(r.params.warmupCount, 4);
  assert.ok(r.provided.includes("warmupCount"));
  assert.ok(!r.provided.includes("intervalDays"), "未写间隔时应记为默认值");

  const fields = fieldsFor(r.intent, r.params, r.provided);
  const warm = fields.find((f) => f.key === "warmupCount");
  const gap = fields.find((f) => f.key === "intervalDays");
  assert.equal(warm.fromUser, true);
  assert.equal(gap.fromUser, false);
  assert.equal(gap.value, 2);
});

test("排期：没给任何参数时要求先确认", () => {
  const r = routeIntent("帮我做个发布排期");
  assert.equal(r.intent, "schedule");
  assert.equal(needsConfirm(r.intent, r.provided, {}), true);
  assert.equal(needsConfirm(r.intent, r.provided, { weeks: 6 }), false);
});

test("投放：解析万元预算，未给预算时标默认", () => {
  const a = routeIntent("1.5 万元预算，投 AI 行业媒体");
  assert.equal(a.intent, "placement");
  assert.equal(a.params.budget, 15000);
  assert.ok(a.provided.includes("budget"));

  const b = routeIntent("帮我做个媒体投放计划");
  assert.equal(b.params.budget, 10000);
  assert.ok(!b.provided.includes("budget"));
  const fields = fieldsFor(b.intent, b.params, b.provided);
  assert.equal(fields[0].fromUser, false);
});

test("分析优先于生产：分析已生成的文章", () => {
  const r = routeIntent("分析一下现在的 AI 可见度和缺口");
  assert.equal(r.intent, "analyze");
});

test("建档：解析名称、城市、行业，并给出可编辑字段", () => {
  const r = routeIntent("新建品牌：星野咖啡，杭州，精品咖啡");
  assert.equal(r.intent, "profile");
  assert.equal(r.params.name, "星野咖啡");
  const fields = fieldsFor(r.intent, r.params, r.provided);
  assert.equal(fields.find((f) => f.key === "name").fromUser, true);
  assert.equal(fields.find((f) => f.key === "siteUrl").value, "");
});

test("寒暄与能力询问先走对话，不做知识库检索", () => {
  for (const text of ["你好", "您好！", "你能做什么", "怎么用", "hello"]) {
    assert.equal(routeIntent(text).intent, "greet", text);
  }
});

test("非任务输入走自由问答，不再拦成预设", () => {
  const r = routeIntent("AgentFlow 支持哪些部署方式");
  assert.equal(r.intent, "chat");
  assert.equal(r.params.query, "AgentFlow 支持哪些部署方式");
});

test("空输入也不抛异常（按对话引导处理）", () => {
  assert.equal(routeIntent("").intent, "greet");
  assert.equal(routeIntent(null).intent, "greet");
});

test("五个预设指令与描述文案齐备", () => {
  assert.equal(AGENT_PRESETS.length, 5);
  for (const p of AGENT_PRESETS) assert.ok(p.label && p.hint && p.example);
  assert.ok(describeIntent(routeIntent("生成 4 周排期")).includes("不代发"));
});

test("问答召回：过滤章节标题碎片，并拒绝无关查询", () => {
  const hits = [
    { text: "4.3 工作流执行模型4.4 关键设计取舍五、部署与配置5.1 环境要求5.2 三种部署方式", docName: "A" },
    { text: "项目支持 Docker 一键部署，数据默认保存在使用者自己的机器上，适合不出内网的环境。", docName: "B" },
    { text: "只想把后端跑起来、不想装数据库和一堆重型依赖时，用一键脚本。", docName: "C" },
  ];
  const ok = selectAnswerHits("AgentFlow 支持哪些部署方式", hits);
  assert.deepEqual(ok.map((h) => h.docName), ["B"]);

  const none = selectAnswerHits("火星移民需要准备什么", hits);
  assert.equal(none.length, 0);
});

