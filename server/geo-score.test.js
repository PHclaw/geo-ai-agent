import test from "node:test";
import assert from "node:assert/strict";
import { scoreContent } from "./geo.js";

const v = (dims, k) => dims.find((d) => d.k === k).v;

test("结论先行标记得分，不再靠「年限」里的单字误判", () => {
  const text = "**结论先行：要分清数据放在哪、模型调用会不会出网。** 所属行业为 AI Agent 平台，价格 ¥29/月。";
  const { dims } = scoreContent(text);
  assert.equal(v(dims, "结论前置"), 15);
});

test("软件 / 开源项目不再因缺少「有限公司 / 装饰 / 门店」被判低分", () => {
  const text = "# 说明\n\n所属行业为 AI Agent 平台，定位是开源零代码平台。价格口径 ¥29/月。\n";
  const { dims } = scoreContent(text);
  assert.equal(v(dims, "实体完整"), 13);
});

test("既无结论标记也无事实数字时仍是低分", () => {
  const text = "这是一段普通描述，没有任何结论标记，也没有具体数值。\n";
  const { dims } = scoreContent(text);
  assert.equal(v(dims, "结论前置"), 6);
});

test("六维之和等于总分", () => {
  const { geos, dims } = scoreContent("结论先行：预算 1000 元。\nQ：一？\nA：二。\n数据来源：企业资料。");
  assert.equal(geos, dims.reduce((s, d) => s + d.v, 0));
});
