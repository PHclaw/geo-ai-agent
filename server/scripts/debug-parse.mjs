/* 排查 cheerio 解析：node scripts/debug-parse.mjs */
import { load } from "cheerio";

for (const url of ["https://example.com", "https://geolook.cc"]) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const html = await res.text();
  const $ = load(html);

  const h1 = $("h1").map((_, el) => $(el).text().trim()).get();
  const p = $("p").map((_, el) => $(el).text().replace(/\s+/g, " ").trim()).get();

  console.log("\n[%s] status=%s ct=%s htmlLen=%s", url, res.status, res.headers.get("content-type"), html.length);
  console.log("  html 片段: %s", html.replace(/\s+/g, " ").slice(0, 160));
  console.log("  h1 元素数=%s  文本=%j", $("h1").length, h1);
  console.log("  p 元素数=%s  首段=%s", $("p").length, (p[0] || "").slice(0, 40));
  console.log("  body 纯文本长度=%s", $("body").text().replace(/\s+/g, "").length);
  console.log("  script 数=%s  div#root=%s", $("script").length, $("#root").length);
}
