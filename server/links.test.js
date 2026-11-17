import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLink, extractHosts } from "./links.js";

test("normalizeLink 补协议、保留端口并拒绝非 HTTP 协议", () => {
  assert.equal(normalizeLink("example.com/a"), "https://example.com/a");
  assert.equal(normalizeLink("http://159.75.21.251:3000"), "http://159.75.21.251:3000/");
  assert.equal(normalizeLink(""), "");
  assert.equal(normalizeLink("javascript:alert(1)"), "");
  assert.equal(normalizeLink("data:text/html,x"), "");
});

test("extractHosts 能同时识别完整 URL 与裸域名", () => {
  const hosts = extractHosts(
    "信息来源：njhouse.com、知乎，详见 https://blog.csdn.net/post?id=1 与 www.example.com/article"
  );
  assert.ok(hosts.includes("njhouse.com"));
  assert.ok(hosts.includes("blog.csdn.net"));
  assert.ok(hosts.includes("www.example.com"));
  assert.equal(extractHosts("").length, 0);
});
