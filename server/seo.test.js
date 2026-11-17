import test from "node:test";
import assert from "node:assert/strict";
import { hostOf, matchPosition, searchConfig, querySerp, queryIndexed } from "./seo.js";

const ORIGIN = "http://159.75.21.251:3000";

test("hostOf 解析域名并忽略端口，非法地址返回空", () => {
  assert.equal(hostOf(`${ORIGIN}/templates`), "159.75.21.251");
  assert.equal(hostOf("https://blog.csdn.net/x"), "blog.csdn.net");
  assert.equal(hostOf("not a url"), "");
});

test("matchPosition 只认目标域名，同名项目不算曝光", () => {
  const items = [
    { url: "https://other.com/agentflow", title: "另一个同名项目" },
    { url: `${ORIGIN}/`, title: "AgentFlow" },
    { url: "https://blog.csdn.net/post", title: "介绍文章" },
  ];
  assert.equal(matchPosition(items, ORIGIN), 2);
  assert.equal(matchPosition([{ url: "https://other.com/agentflow" }], ORIGIN), 0);
});

test("未配置搜索 Key 时不编造排名或收录数", async () => {
  const key = process.env.GEO_SEO_SEARCH_KEY;
  const base = process.env.GEO_SEO_SEARCH_BASE;
  delete process.env.GEO_SEO_SEARCH_KEY;
  delete process.env.GEO_SEO_SEARCH_BASE;
  try {
    assert.equal(searchConfig().live, false);
    const serp = await querySerp("AgentFlow");
    assert.equal(serp.available, false);
    assert.equal(serp.reason, "unconfigured");
    assert.deepEqual(serp.items, []);
    const indexed = await queryIndexed(ORIGIN);
    assert.equal(indexed.count, null);
    assert.equal(indexed.source, "unconfigured");
  } finally {
    if (key !== undefined) process.env.GEO_SEO_SEARCH_KEY = key;
    if (base !== undefined) process.env.GEO_SEO_SEARCH_BASE = base;
  }
});
