import test from "node:test";
import assert from "node:assert/strict";
import {
  isLocalService,
  auditPrompts,
  auditKeywords,
  similarity,
  parseJsonLoose,
} from "./prompt-gen.js";

const softwareBrand = { name: "AgentFlow", city: "", industry: "AI Agent 平台", intro: "零代码 Agent 构建平台" };
const softwareFacts = [{ attr: "部署方式", value: "自托管 / Docker 一键" }];
const localBrand = { name: "和序装饰", city: "南京", industry: "家装", intro: "住宅整装" };
const localFacts = [{ attr: "门店数量", value: "4 家" }, { attr: "服务区域", value: "南京主城六区" }];

test("软件品牌被判为非本地服务，家装判为本地服务", () => {
  assert.equal(isLocalService(softwareBrand, softwareFacts), false);
  assert.equal(isLocalService(localBrand, localFacts), true);
});

test("相似度能识别近重复，区分不同问题", () => {
  assert.ok(similarity("有人踩过部署的坑吗？", "有人踩过部署坑吗？") > 0.6);
  assert.ok(similarity("数据能不能不出内网？", "两个人维护选哪个平台？") < 0.2);
});

test("只差品牌名的两条问题算重复（比较前剥离品牌名）", () => {
  const out = auditPrompts(
    [
      { text: "有人踩过部署的坑吗？容易卡在哪？", intent: "口碑" },
      { text: "有人踩过 AgentFlow 部署的坑吗？容易卡在哪？", intent: "口碑" },
    ],
    { brandName: "AgentFlow", localService: false }
  );
  assert.equal(out.accepted.length, 1);
  assert.ok(out.rejected.some((r) => r.reason.includes("近重复")));
});

test("质检剔除品牌名、本地服务词、近重复与过长问题", () => {
  const items = [
    { text: "AgentFlow 自己部署一套要多少钱？", intent: "决策" },
    { text: "附近有哪些便宜的客服机器人平台？", intent: "本地" },
    { text: "两个人在维护，还要接内网知识库，选哪个平台？", intent: "决策", keyword: "私有化部署" },
    { text: "两个人在维护，还要接内网知识库，选哪个平台好？", intent: "决策" },
    { text: "预算一年 5000，能私有化部署吗？", intent: "决策", constraint: "预算" },
    { text: "太短？", intent: "认知" },
  ];
  const out = auditPrompts(items, { brandName: "AgentFlow", localService: false });
  const reasons = out.rejected.map((r) => r.reason).join(" | ");
  assert.ok(reasons.includes("含品牌名"));
  assert.ok(reasons.includes("本地服务词"));
  assert.ok(reasons.includes("近重复"));
  assert.ok(reasons.includes("过短"));
  assert.equal(out.accepted.length, 2);
  assert.equal(out.stats.brandHits, 0);
});

test("口碑类允许品牌名，但最多 3 条", () => {
  const items = [
    { text: "AgentFlow 靠谱吗，有没有人用过？", intent: "口碑" },
    { text: "AgentFlow 出问题有人管吗？", intent: "口碑" },
    { text: "AgentFlow 更新勤不勤？", intent: "口碑" },
    { text: "AgentFlow 值得买吗？", intent: "口碑" },
  ];
  const out = auditPrompts(items, { brandName: "AgentFlow", localService: false });
  assert.equal(out.stats.brandHits, 3);
  assert.ok(out.rejected.some((r) => r.reason.includes("上限")));
});

test("缺问号的疑问句自动补问号，不误杀", () => {
  const out = auditPrompts(
    [
      { text: "预算三万以内，零代码平台够用吗", intent: "决策" },
      { text: "两个人维护，能接内网知识库吗", intent: "决策" },
    ],
    { brandName: "AgentFlow", localService: false }
  );
  assert.equal(out.accepted.length, 2);
  assert.ok(out.accepted.every((p) => p.text.endsWith("？")));
});

test("口碑类不得预设正面结论", () => {
  const out = auditPrompts(
    [
      { text: "听说这平台挺稳，两个人扛得住吗？", intent: "口碑" },
      { text: "出问题有人在维护吗，版本更新勤不勤？", intent: "口碑" },
    ],
    { brandName: "AgentFlow", localService: false }
  );
  assert.equal(out.accepted.length, 1);
  assert.ok(out.rejected.some((r) => r.reason.includes("正面结论")));
});

test("关键词质检挡掉品牌名与重复", () => {
  const out = auditKeywords(
    [
      { term: "私有化部署", type: "痛点" },
      { term: "AgentFlow", type: "品类" },
      { term: "私有化部署", type: "场景" },
      { term: "客服机器人", type: "场景" },
    ],
    { brandName: "AgentFlow" }
  );
  assert.deepEqual(out.accepted.map((k) => k.term), ["私有化部署", "客服机器人"]);
  assert.equal(out.rejected.length, 2);
});

test("解析模型输出：容忍代码块与前后说明", () => {
  assert.deepEqual(parseJsonLoose('[{"text":"a？"}]'), [{ text: "a？" }]);
  assert.deepEqual(parseJsonLoose('```json\n[{"text":"b？"}]\n```'), [{ text: "b？" }]);
  assert.deepEqual(parseJsonLoose('好的，结果如下：\n[{"text":"c？"}]\n以上。'), [{ text: "c？" }]);
  assert.equal(parseJsonLoose("完全不是 JSON"), null);
});
