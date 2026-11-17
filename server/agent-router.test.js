import test from "node:test";
import assert from "node:assert/strict";
import { routeIntent, describeIntent, AGENT_PRESETS } from "./agent-router.js";

test("内容生产：识别比较意图与匹配的提问意图", () => {
  const r = routeIntent("给 AgentFlow 生成一篇比较类文章");
  assert.equal(r.intent, "produce");
  assert.equal(r.params.genre, "比较");
  assert.equal(r.params.promptIntent, "比较");
});

test("排期优先于生产：带「生成」但核心是排期", () => {
  const r = routeIntent("生成一份 4 周发布排期，4 条养号，3:1 穿插，每 2 天一条");
  assert.equal(r.intent, "schedule");
  assert.equal(r.params.warmupCount, 4);
  assert.equal(r.params.ratio, 3);
  assert.equal(r.params.weeks, 4);
  assert.equal(r.params.intervalDays, 2);
});

test("投放：解析万元预算", () => {
  const r = routeIntent("1.5 万元预算，投 AI 行业媒体");
  assert.equal(r.intent, "placement");
  assert.equal(r.params.budget, 15000);
});

test("投放：缺预算时给默认值", () => {
  const r = routeIntent("帮我做个媒体投放计划");
  assert.equal(r.intent, "placement");
  assert.equal(r.params.budget, 10000);
});

test("分析优先于生产：分析已生成的文章", () => {
  const r = routeIntent("分析一下现在的 AI 可见度和缺口");
  assert.equal(r.intent, "analyze");
});

test("建档：解析名称、城市、行业", () => {
  const r = routeIntent("新建品牌：星野咖啡，杭州，精品咖啡");
  assert.equal(r.intent, "profile");
  assert.equal(r.params.name, "星野咖啡");
  assert.equal(r.params.city, "杭州");
  assert.equal(r.params.industry, "精品咖啡");
});

test("识别不了就返回 unknown，不硬猜", () => {
  const r = routeIntent("今天天气怎么样");
  assert.equal(r.intent, "unknown");
  assert.deepEqual(r.params, {});
});

test("空输入不抛异常", () => {
  assert.equal(routeIntent("").intent, "unknown");
  assert.equal(routeIntent(null).intent, "unknown");
});

test("五个预设指令与描述文案齐备", () => {
  assert.equal(AGENT_PRESETS.length, 5);
  for (const p of AGENT_PRESETS) {
    assert.ok(p.label && p.hint && p.example);
  }
  const desc = describeIntent(routeIntent("生成 4 周排期"));
  assert.ok(desc.includes("不代发"));
});
