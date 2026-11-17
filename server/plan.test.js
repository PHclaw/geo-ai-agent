import test from "node:test";
import assert from "node:assert/strict";
import { buildPlanSlots, normalizePlanOptions, KNOWLEDGE_TOPICS } from "./plan.js";

const articles = [
  { id: "a1", title: "GEO 文章一" },
  { id: "a2", title: "GEO 文章二" },
];

test("养号阶段前 N 条都是纯知识，且不带品牌/数字", () => {
  const { slots } = buildPlanSlots({ warmupCount: 4, ratio: 3, weeks: 2, intervalDays: 2, channels: ["知乎"], startDate: "2026-11-09" }, articles);
  assert.ok(slots.length >= 4);
  for (const s of slots.slice(0, 4)) {
    assert.equal(s.kind, "knowledge");
    assert.equal(s.stage, "warmup");
    assert.equal(s.contentId, "");
    assert.ok(!/\d/.test(s.title));
    assert.ok(!/AgentFlow|和序/.test(s.title));
  }
});

test("养号之后按比例穿插 GEO 文章，且关联真实文章", () => {
  const { slots } = buildPlanSlots({ warmupCount: 4, ratio: 3, weeks: 4, intervalDays: 2, channels: ["知乎"], startDate: "2026-11-09" }, articles);
  const mixed = slots.slice(4);
  const geo = mixed.filter((s) => s.kind === "geo");
  assert.ok(geo.length >= 2);
  for (const g of geo) {
    assert.equal(g.stage, "mixed");
    assert.ok(articles.some((a) => a.id === g.contentId));
  }
  assert.equal(mixed[3].kind, "geo");
});

test("日期按间隔递增，多渠道互不串扰", () => {
  const { slots } = buildPlanSlots({ warmupCount: 2, ratio: 2, weeks: 1, intervalDays: 3, channels: ["知乎", "小红书"], startDate: "2026-11-09" }, articles);
  const zh = slots.filter((s) => s.channel === "知乎");
  assert.equal(zh[0].date, "2026-11-09");
  assert.equal(zh[1].date, "2026-11-12");
  assert.equal(slots.filter((s) => s.channel === "小红书").length, zh.length);
});

test("参数被约束在合理范围，非法输入不产生异常", () => {
  const o = normalizePlanOptions({ warmupCount: 999, ratio: 0, weeks: -3, intervalDays: 999, channels: ["", "  "], startDate: "bad" });
  assert.equal(o.warmupCount, 20);
  assert.equal(o.ratio, 1);
  assert.equal(o.weeks, 1);
  assert.equal(o.intervalDays, 14);
  assert.equal(o.channels.length, 3);
  assert.match(o.startDate, /^\d{4}-\d{2}-\d{2}$/);
});

test("知识选题库不含数字与绝对化用语", () => {
  for (const t of KNOWLEDGE_TOPICS) {
    assert.ok(!/\d/.test(t));
    assert.ok(!/最好|唯一|100%|保证|免费/.test(t));
  }
});
