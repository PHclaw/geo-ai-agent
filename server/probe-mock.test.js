import test from "node:test";
import assert from "node:assert/strict";
import { mockAnswer } from "./probe.js";

const softwareCtx = {
  brand: { name: "AgentFlow", city: "", industry: "AI Agent 平台", site_url: "https://agentflow.example.com" },
  facts: [
    { attr: "订阅价格-Pro", value: "¥29/月", status: "active" },
    { attr: "部署方式", value: "自托管 / Docker 一键", status: "active" },
  ],
  competitors: [],
  storeCount: 0,
};

const localCtx = {
  brand: { name: "和序装饰", city: "南京", industry: "家装", site_url: "" },
  facts: [
    { attr: "价格区间（整装）", value: "980–1350 元/㎡", status: "active" },
    { attr: "工期", value: "45–60 天", status: "active" },
  ],
  competitors: [{ name: "栖岸设计" }, { name: "连云装饰" }],
  storeCount: 4,
};

const PLATFORM = { key: "deepseek", bias: 1 };

test("软件品牌不再出现家装话术", () => {
  for (const q of ["AgentFlow 自己部署一套大概要花多少钱？", "配 Ollama 本地模型，数据全部留在本地吗？"]) {
    const { answer } = mockAnswer(q, PLATFORM, softwareCtx);
    for (const word of ["量房", "整装", "工期", "门店", "njhouse"]) {
      assert.ok(!answer.includes(word), `不应出现「${word}」：${answer}`);
    }
  }
});

test("提及品牌时会带出事实卡口径，缺失时写公开资料有限", () => {
  const ctx = { ...softwareCtx, brand: { ...softwareCtx.brand, name: "某某平台" } };
  const answers = Array.from({ length: 30 }, (_, i) => mockAnswer(`问题 ${i}`, PLATFORM, ctx).answer);
  const withBrand = answers.filter((a) => a.includes("**某某平台**"));
  assert.ok(withBrand.length > 0, "至少部分样本应提及品牌");
  assert.ok(withBrand.every((a) => a.includes("¥29/月")), "提及品牌时应带出价格事实");

  const empty = Array.from({ length: 20 }, (_, i) =>
    mockAnswer(`问题 ${i}`, PLATFORM, { ...ctx, facts: [] }).answer
  ).filter((a) => a.includes("**某某平台**"));
  assert.ok(empty.every((a) => a.includes("公开资料有限")), "没有事实卡时不能编数字");
});

test("城市为空时不以「地区」开头，但仍保留品牌名", () => {
  const answers = Array.from({ length: 20 }, (_, i) => mockAnswer(`适合什么团队 ${i}`, PLATFORM, softwareCtx).answer);
  assert.ok(answers.every((a) => !a.startsWith("地区")));
  assert.ok(answers.some((a) => a.includes("AgentFlow")));
  assert.ok(answers.every((a) => a.includes("信息来源：")));
});

test("引用不再写死家装站，优先品牌官网", () => {
  const { answer } = mockAnswer("怎么选", PLATFORM, softwareCtx);
  assert.ok(!answer.includes("njhouse.com"));
  assert.ok(answer.includes("agentflow.example.com") || answer.includes("zhihu.com"));
});

test("本地行业仍可使用竞品名与城市", () => {
  const { answer } = mockAnswer("南京装修哪家好", PLATFORM, localCtx);
  assert.ok(answer.includes("和序装饰") || answer.includes("栖岸设计"));
  assert.ok(answer.includes("南京") || answer.includes("家装"));
  assert.ok(!answer.includes("量房"));
});
