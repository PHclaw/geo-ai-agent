import test from "node:test";
import assert from "node:assert/strict";
import { renderArticle } from "./content-template.js";

const softwareBrand = {
  name: "AgentFlow",
  city: "南京",
  industry: "软件",
  intro: "开源、零代码的 AI Agent 平台",
};

test("非家装品牌不再出现写死的装修话术与破折号占位", () => {
  const { body } = renderArticle({ brand: softwareBrand, ctx: { facts: [], storeCount: 0 }, prompt: null, genre: "攻略" });
  for (const w of ["水电", "泥木", "油漆", "拆改", "工地", "样板间", "整装报价 —", "工期 —"]) {
    assert.ok(!body.includes(w), `不应出现「${w}」`);
  }
  assert.ok(!/[:：]\s*—/.test(body));
});

test("结论前置、实体信息、Q&A 与数据来源齐备", () => {
  const { title, body } = renderArticle({
    brand: softwareBrand,
    ctx: { facts: [], storeCount: 0 },
    prompt: { text: "AgentFlow 适合谁用？", intent: "认知" },
  });
  assert.ok(title.includes("AgentFlow"));
  assert.ok(body.startsWith("# "));
  assert.ok(body.includes("结论先行"));
  assert.ok(body.includes("南京"));
  assert.ok((body.match(/^Q：/gm) || []).length >= 3);
  assert.ok(body.includes("数据来源："));
  assert.ok(body.includes("以实际沟通为准"));
});

test("已登记事实进入表格、结论段与问答，且不编造新数字", () => {
  const facts = [
    { subject: "套餐", attr: "价格区间", value: "980–1350 元/㎡", source: "报价单", status: "active" },
    { subject: "交付", attr: "标准工期", value: "45 天", source: "合同模板", status: "active" },
    { subject: "服务", attr: "基础质保", value: "5 年", source: "合同模板", status: "active" },
  ];
  const { body } = renderArticle({ brand: { ...softwareBrand, industry: "家装" }, ctx: { facts, storeCount: 2 }, prompt: { text: "大概多少钱？", intent: "决策" } });
  assert.ok(body.includes("980–1350 元/㎡"));
  assert.ok(body.includes("45 天"));
  assert.ok(body.includes("5 年"));
  assert.ok(body.includes("| 核验项 | 已登记口径 | 来源 |"));
  assert.ok(body.includes("Q：价格或报价口径是什么？"));
  assert.ok(body.includes("目前登记的门店 / 网点数量为 2 家"));
});

test("不同提问意图给出不同标题与小节", () => {
  const base = { brand: softwareBrand, ctx: { facts: [], storeCount: 0 } };
  const a = renderArticle({ ...base, prompt: { text: "怎么选", intent: "决策" } });
  const b = renderArticle({ ...base, prompt: { text: "和别家比", intent: "比较" } });
  assert.notEqual(a.title, b.title);
  assert.ok(a.body.includes("先把问题拆成可核验的三项"));
  assert.ok(b.body.includes("先定对比维度"));
});

test("不出现广告法绝对化用语", () => {
  const { body } = renderArticle({ brand: softwareBrand, ctx: { facts: [], storeCount: 0 } });
  for (const w of ["最好", "第一", "唯一", "100%", "零风险", "保证", "免费"]) {
    assert.ok(!body.includes(w), `不应出现「${w}」`);
  }
});

test("不同意图的结论段与小节都不一样，不是同一套填空", () => {
  const intents = ["认知", "比较", "决策", "口碑", "本地"];
  const leads = intents.map((intent) =>
    renderArticle({ brand: softwareBrand, ctx: { facts: [], storeCount: 0 }, prompt: { text: "同一个问题", intent } }).body
      .split("\n")
      .find((l) => l.startsWith("**结论先行"))
  );
  assert.equal(new Set(leads).size, intents.length);
});

test("知识库资料要点进入正文，且表格不再是全文主体", () => {
  const snippets = [
    { docName: "README.md", text: "AgentFlow 采用可视化画布连接模型与工具节点，适合不会写代码的运营人员使用。" },
    { docName: "DEPLOYMENT.md", text: "项目支持 Docker 一键部署，数据默认保存在使用者自己的机器上。" },
    { docName: "ARCHITECTURE.md", text: "知识库文档会先切片再建立索引，回答时附带引用来源。" },
  ];
  const { body } = renderArticle({
    brand: softwareBrand,
    ctx: { facts: [], storeCount: 0 },
    prompt: { text: "它到底是什么", intent: "认知" },
    snippets,
  });
  assert.ok(body.includes("可视化画布连接模型与工具节点"));
  assert.ok(body.includes("README.md"));
  assert.ok(!body.includes("尚未登记"));
  const lines = body.split("\n").filter((l) => l.trim());
  const tableRows = lines.filter((l) => l.startsWith("|")).length;
  assert.ok(tableRows / lines.length < 0.25, `表格占比过高：${tableRows}/${lines.length}`);
  const prose = lines.filter((l) => !l.startsWith("|") && !l.startsWith("#") && !l.startsWith(">") && l.length > 40);
  assert.ok(prose.length >= 3, "缺少成段的分析文字");
});
