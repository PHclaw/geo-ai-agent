import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAnswerQuery,
  buildAnswerWhere,
  parseCitations,
  clipAnswer,
  toAnswerRow,
  toAnswerCsv,
} from "./answers-query.js";

test("分页参数被约束在合理范围", () => {
  assert.equal(normalizeAnswerQuery({}).page, 1);
  assert.equal(normalizeAnswerQuery({ page: -3 }).page, 1);
  assert.equal(normalizeAnswerQuery({ size: 1 }).size, 5);
  assert.equal(normalizeAnswerQuery({ size: 999 }).size, 100);
});

test("引用筛选支持多种写法，未知值视为全部", () => {
  assert.equal(normalizeAnswerQuery({ cited: "yes" }).cited, 1);
  assert.equal(normalizeAnswerQuery({ cited: "0" }).cited, 0);
  assert.equal(normalizeAnswerQuery({ cited: "maybe" }).cited, null);
});

test("筛选条件可组合且参数顺序一致", () => {
  const q = normalizeAnswerQuery({
    platform: "deepseek",
    keyword: "装修",
    from: "2026-11-01",
    to: "2026-11-12",
    cited: "1",
  });
  const { sql, params, runId } = buildAnswerWhere(q, "brand-1", "run-9");
  assert.ok(sql.includes("r.brand_id = ?"));
  assert.ok(sql.includes("r.run_id = ?"));
  assert.ok(sql.includes("r.platform = ?"));
  assert.ok(sql.includes("p.text LIKE ?"));
  assert.ok(sql.includes("r.created_at >= ?"));
  assert.ok(sql.includes("r.created_at <= ?"));
  assert.ok(sql.includes("r.citations <> '[]'"));
  assert.equal(runId, "run-9");
  assert.equal(params[0], "brand-1");
  assert.equal(params[1], "run-9");
  assert.equal(params[2], "deepseek");
  assert.equal(params[3], "%装修%");
  assert.equal(params[4], "%装修%");
  assert.equal(params.at(-2), "2026-11-01");
  assert.equal(params.at(-1), "2026-11-12 23:59:59");
});

test("runId=all 时不按轮次过滤", () => {
  const q = normalizeAnswerQuery({ runId: "all" });
  const { sql, runId } = buildAnswerWhere(q, "b1", "run-9");
  assert.ok(!sql.includes("r.run_id = ?"));
  assert.equal(runId, "");
});

test("引用解析兼容字符串数组、对象数组与坏数据", () => {
  assert.deepEqual(parseCitations('["njhouse.com","zhihu.com"]'), ["njhouse.com", "zhihu.com"]);
  assert.deepEqual(parseCitations('[{"host":"Njhouse.com"}]'), ["njhouse.com"]);
  assert.deepEqual(parseCitations("not-json"), []);
  assert.deepEqual(parseCitations("{}"), []);
  assert.deepEqual(parseCitations("[]"), []);
});

test("摘要截断不破坏中文", () => {
  const long = "甲".repeat(50);
  assert.equal(clipAnswer(long, 10).length, 11);
  assert.ok(clipAnswer(long, 10).endsWith("…"));
  assert.equal(clipAnswer("  短  文本 ", 10), "短 文本");
});

test("行映射带出引用数与是否被引用", () => {
  const row = toAnswerRow({
    id: "a1",
    run_id: "r1",
    platform: "deepseek",
    prompt_id: "p1",
    prompt_text: "南京装修公司推荐",
    intent: "比较",
    answer: "甲".repeat(300),
    citations: '["njhouse.com"]',
    mention: 1,
    accuracy: 0.9,
    position: 3,
    created_at: "2026-11-12T07:25:00Z",
  });
  assert.equal(row.citationCount, 1);
  assert.equal(row.cited, true);
  assert.equal(row.mention, true);
  assert.equal(row.fullLength, 300);
  assert.ok(row.answer.endsWith("…"));
});

test("CSV 转义逗号、引号与换行", () => {
  const csv = toAnswerCsv([
    {
      createdAt: "2026-11-12T07:25:00Z",
      platform: "deepseek",
      promptText: '有"引号",也有逗号',
      intent: "比较",
      mention: 1,
      citations: '["njhouse.com"]',
      answer: "第一行\n第二行",
    },
  ]);
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "采集时间,平台,提问,意图,是否提及,是否引用,引用域名,答案全文");
  assert.ok(lines[1].includes('"有""引号"",也有逗号"'));
  assert.ok(lines[1].includes('"第一行\n第二行"') || lines.slice(1).join("\r\n").includes("第二行"));
  assert.ok(lines[1].includes("njhouse.com"));
});
