import test from "node:test";
import assert from "node:assert/strict";
import {
  isLocalService,
  auditKeywords,
  auditMatrix,
  similarity,
  parseJsonLoose,
  patternOf,
  DIMENSIONS,
  DIMENSION_INTENT,
} from "./prompt-gen.js";

const softwareBrand = { name: "AgentFlow", city: "", industry: "AI Agent 平台", intro: "零代码 Agent 构建平台" };
const softwareFacts = [{ attr: "部署方式", value: "自托管 / Docker 一键" }];
const localBrand = { name: "和序装饰", city: "南京", industry: "家装", intro: "住宅整装" };
const localFacts = [{ attr: "门店数量", value: "4 家" }, { attr: "服务区域", value: "南京主城六区" }];

test("七个维度与意图映射固定", () => {
  assert.equal(DIMENSIONS.length, 7);
  assert.deepEqual(
    DIMENSIONS.map((d) => d.key),
    ["平台选型", "功能对比", "应用场景", "技术实现", "迁移替换", "成本预算", "口碑风险"]
  );
  assert.equal(DIMENSION_INTENT["技术实现"], "本地");
  assert.equal(DIMENSION_INTENT["口碑风险"], "口碑");
  assert.equal(DIMENSION_INTENT["平台选型"], "决策");
});

test("软件品牌判为非本地服务，家装判为本地服务", () => {
  assert.equal(isLocalService(softwareBrand, softwareFacts), false);
  assert.equal(isLocalService(localBrand, localFacts), true);
});

test("矩阵质检：维度映射意图、剔泛问与本地服务词", () => {
  const matrix = [
    {
      keyword: "私有化部署",
      dimension: "技术实现",
      questions: ["只放通 443 端口，内网能跑起来吗？", "本地模型接入一般怎么打通？"],
    },
    {
      keyword: "私有化部署",
      dimension: "口碑风险",
      questions: ["半夜跑挂了，有人响应吗？", "听说挺稳，两个人扛得住吗？"],
    },
    {
      keyword: "智能客服",
      dimension: "应用场景",
      questions: ["附近有哪些公司能做智能客服？"],
    },
    {
      keyword: "智能客服",
      dimension: "不存在的维度",
      questions: ["这条应该被拒绝吗？"],
    },
  ];
  const out = auditMatrix(matrix, { brandName: "AgentFlow", localService: false });
  const texts = out.accepted.map((q) => q.text);
  assert.ok(texts.includes("只放通 443 端口，内网能跑起来吗？"));
  assert.ok(texts.includes("半夜跑挂了，有人响应吗？"));
  assert.ok(!texts.some((t) => t.includes("一般怎么打通")));
  assert.ok(!texts.some((t) => t.includes("附近")));
  assert.ok(!texts.some((t) => t.includes("听说挺稳")));

  const byDim = Object.fromEntries(out.accepted.map((q) => [q.dimension, q.intent]));
  assert.equal(byDim["技术实现"], "本地");
  assert.equal(byDim["口碑风险"], "口碑");
  assert.ok(out.rejected.some((r) => r.reason.includes("维度不合法")));
});

test("矩阵质检：同一问法占比过高会被裁剪", () => {
  const a = ["两个人维护这套够用吗？", "预算三万投一年够用吗？", "客服排班接工单够用吗？"];
  const b = ["8G 内存跑工作流够用吗？", "内网隔离调模型够用吗？", "迁移旧流程后够用吗？"];
  const out = auditMatrix(
    [
      { keyword: "零代码平台", dimension: "平台选型", questions: a },
      { keyword: "私有化部署", dimension: "平台选型", questions: b },
    ],
    { brandName: "AgentFlow", localService: false }
  );
  const capped = out.accepted.filter((q) => patternOf(q.text) === "够不够").length;
  assert.ok(capped <= Math.max(3, Math.ceil(out.accepted.length * 0.3)) + 1);
  assert.ok(out.rejected.some((r) => r.reason.includes("重复过多")));
});

test("矩阵质检：覆盖统计包含关键词、维度与格子数", () => {
  const matrix = [
    { keyword: "私有化部署", dimension: "技术实现", questions: ["只放通 443 端口，内网能跑起来吗？"] },
    { keyword: "私有化部署", dimension: "成本预算", questions: ["五个人按人头算，一年多少钱？"] },
    { keyword: "智能客服", dimension: "应用场景", questions: ["客服两个人轮班，能接工单吗？"] },
  ];
  const out = auditMatrix(matrix, { brandName: "AgentFlow", localService: false });
  assert.equal(out.coverage.keywords, 2);
  assert.equal(out.coverage.dimensions, 3);
  assert.equal(out.coverage.cells, 3);
  assert.equal(out.stats.accepted, 3);
  assert.equal(out.stats.brandRatio, 0);
});

test("矩阵质检：品牌名只允许出现在口碑风险类，最多 3 条", () => {
  const matrix = [
    { keyword: "开源平台", dimension: "口碑风险", questions: ["AgentFlow 更新勤不勤？", "AgentFlow 售后响应快吗？", "AgentFlow 踩坑多吗？"] },
    { keyword: "开源平台", dimension: "功能对比", questions: ["AgentFlow 和 Dify 差在哪？"] },
  ];
  const out = auditMatrix(matrix, { brandName: "AgentFlow", localService: false });
  const branded = out.accepted.filter((q) => q.text.includes("AgentFlow"));
  assert.ok(branded.every((q) => q.dimension === "口碑风险"));
  assert.ok(branded.length <= 3);
  assert.ok(out.rejected.some((r) => r.reason.includes("品牌名")));
});

test("关键词质检：类型上限、品牌名与重复", () => {
  const out = auditKeywords(
    [
      { term: "私有化部署", type: "合规" },
      { term: "AgentFlow", type: "品类" },
      { term: "私有化部署", type: "场景" },
      { term: "客服机器人", type: "场景" },
      { term: "开源部署", type: "合规" },
      { term: "本地模型", type: "合规" },
      { term: "内网隔离", type: "合规" },
      { term: "数据出境", type: "合规" },
    ],
    { brandName: "AgentFlow", softLimit: 3 }
  );
  assert.ok(out.accepted.every((k) => k.term !== "AgentFlow"));
  assert.equal(out.accepted.filter((k) => k.type === "合规").length, 3);
  assert.ok(out.rejected.some((r) => r.reason.includes("上限")));
});

test("相似度与解析容错", () => {
  assert.ok(similarity("有人踩过部署的坑吗？", "有人踩过部署坑吗？") > 0.6);
  assert.deepEqual(parseJsonLoose('```json\n{"matrix":[]}\n```'), { matrix: [] });
  assert.equal(parseJsonLoose("完全不是 JSON"), null);
});
