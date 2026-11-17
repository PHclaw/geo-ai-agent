/* 智能体生成冒烟测试：node scripts/smoke-agent.mjs */
import { db } from "../db.js";
import { agentStatus, buildPrompt, runAgent } from "../agent/piagent.js";

const st = agentStatus();
console.log("STATUS  available=%s entry=%s", st.available, st.entry || st.hint);
if (!st.available) process.exit(1);

const brand = db.prepare("SELECT * FROM brands LIMIT 1").get();
if (!brand) {
  console.log("没有品牌数据");
  process.exit(1);
}
const facts = db.prepare("SELECT * FROM facts WHERE brand_id=? AND status='active'").all(brand.id);
const storeCount = db.prepare("SELECT COUNT(*) c FROM stores WHERE brand_id=?").get(brand.id).c;
const prompt = db
  .prepare("SELECT * FROM prompts WHERE brand_id=? ORDER BY weight DESC LIMIT 1")
  .get(brand.id);

const snippets = [];
try {
  const { buildContext } = await import("../kb/search.js");
  const ctx = buildContext(brand.id, prompt?.text || "老房翻新", 3);
  snippets.push(...ctx.hits);
} catch {
  /* 检索为空也可继续 */
}

console.log("DATA    brand=%s facts=%s stores=%s prompt=%s snippets=%s", brand.name, facts.length, storeCount, prompt?.text || "-", snippets.length);

const text = buildPrompt({ brand, facts, snippets, promptText: prompt?.text, genre: "攻略", storeCount });
console.log("PROMPT  %s chars", text.length);

const t0 = Date.now();
let chars = 0;
let toolCalls = 0;

const out = await runAgent({
  brandId: brand.id,
  prompt: text,
  timeoutMs: 180000,
  onEvent: (e) => {
    if (e.type === "text") chars += e.delta.length;
    else if (e.type === "tool") toolCalls++;
    else if (e.type === "done") {
      console.log(
        "DONE    ok=%s text=%s chars thinking=%s tools=%s files=%s error=%s usage=%s",
        e.ok, e.chars, e.thinkingChars, toolCalls, e.files.length, e.error || "-",
        e.usage ? `${e.usage.input}/${e.usage.output} tok` : "-"
      );
    } else if (e.type === "error") {
      console.log("ERROR   %s", e.content);
    }
  },
});

console.log("ELAPSED %ss", ((Date.now() - t0) / 1000).toFixed(1));
console.log("RESULT  ok=%s len=%s", out.ok, out.text.length);

if (out.text) {
  console.log("\n---- 正文前 400 字 ----");
  console.log(out.text.slice(0, 400));
  console.log("\n---- 正文后 200 字 ----");
  console.log(out.text.slice(-200));
  const hasQA = /Q[:：]|问[:：]/.test(out.text);
  const hasBrand = out.text.includes(brand.name);
  const hasSource = /数据来源|来源[:：]/.test(out.text);
  console.log("\nCHECK   brand=%s qa=%s source=%s", hasBrand, hasQA, hasSource);
}
