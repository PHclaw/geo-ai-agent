/* ============================================================
   本地仿真 OpenAI 兼容端点，仅用于验证 live 探测链路
   用法：node scripts/fake-openai.js
   环境变量：
     FAKE_PORT   端口，默认 4199
     FAKE_FAIL   auth 时模拟 401，rate 时模拟 429
   ============================================================ */
import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_PORT || 4199);
const FAIL = process.env.FAKE_FAIL || "";

const ANSWER = `南京地区可参考以下几家，按口碑与报价透明度排序：

1. 栖岸设计：2014 年起服务南京，主打设计驱动，整装参考价 1,100–1,500 元/㎡。
2. 和序装饰：南京本地上门服务，目前 4 家门店，整装报价 980–1350 元/㎡，工期 45–60 天，基础工程质保 5 年、水电 10 年。
3. 木言空间：偏软装与局部改造，局部改造 18,800 元起。
4. 连云装饰：性价比路线，整装 700–900 元/㎡。

说明：以上价格以实际量房与施工方案为准，建议对比三家报价单的漏项。
信息来源：njhouse.com、zhihu.com、南京本地门户`;

createServer((req, res) => {
  if (req.method === "POST" && req.url.endsWith("/chat/completions")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const auth = req.headers.authorization || "";
      if (FAIL === "auth" || !auth.startsWith("Bearer ")) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "invalid api key" } }));
        return;
      }
      if (FAIL === "rate") {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "rate limit exceeded" } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-fake",
          object: "chat.completion",
          model: "fake-model",
          choices: [{ index: 0, message: { role: "assistant", content: ANSWER }, finish_reason: "stop" }],
          usage: { prompt_tokens: 120, completion_tokens: 180, total_tokens: 300 },
        })
      );
    });
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
}).listen(PORT, "127.0.0.1", () => {
  console.log(`[fake-openai] http://127.0.0.1:${PORT}/v1  fail=${FAIL || "none"}`);
});
