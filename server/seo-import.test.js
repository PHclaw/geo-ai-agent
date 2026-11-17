import test from "node:test";
import assert from "node:assert/strict";
import { computeExposure, normalizeDate, parseCsvRecords } from "./seo-import.js";

test("曝光率只统计有值样本，0 表示未进榜，留空不计入分母", () => {
  assert.deepEqual(computeExposure([1, 0, 25, "", null, 8]), { samples: 4, exposed: 2, rate: 50 });
  assert.deepEqual(computeExposure(["", null]), { samples: 0, exposed: 0, rate: null });
  assert.equal(computeExposure([1, 3, 5, 7, 8, 9, 11, 13], 10).rate, 75);
});

test("normalizeDate 兼容常见导出格式", () => {
  assert.equal(normalizeDate("2026-11-09"), "2026-11-09");
  assert.equal(normalizeDate("2026/11/9"), "2026-11-09");
  assert.equal(normalizeDate("20261109"), "2026-11-09");
  assert.equal(normalizeDate("2026年11月9日"), "2026-11-09");
  assert.equal(normalizeDate("不是日期"), "");
});

test("CSV 兼容中文列名并把百分号 CTR 转成小数", () => {
  const csv = [
    "日期,展现量,点击数,点击率,平均排名,收录数,备注",
    "2026/11/9,1000,35,3.5%,8.2,12,GSC 导出",
    "2026-11-08,800,20,2.5%,10.1,11,",
  ].join("\n");
  const { records, errors } = parseCsvRecords(csv);
  assert.equal(errors.length, 0);
  assert.equal(records.length, 2);
  assert.equal(records[0].date, "2026-11-09");
  assert.equal(records[0].impressions, 1000);
  assert.equal(records[0].clicks, 35);
  assert.equal(records[0].ctr, 0.035);
  assert.equal(records[0].avgPosition, 8.2);
  assert.equal(records[0].indexedPages, 12);
  assert.equal(records[0].note, "GSC 导出");
});

test("CSV 跳过缺日期与无数值的坏行", () => {
  const csv = ["date,impressions", ",500", "2026-11-09,", "2026-11-08,700"].join("\n");
  const { records, errors } = parseCsvRecords(csv);
  assert.equal(records.length, 1);
  assert.equal(records[0].impressions, 700);
  assert.ok(errors.length >= 2);
});
