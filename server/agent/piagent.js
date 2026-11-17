/* ============================================================
   智能体接入层（参考 alphalens backend/app/services/piagent.py）
   - 用子进程调用 pi CLI，--mode json 拿 JSON-lines 事件流
   - 提示词写一次性文件传参，避开命令行长度与转义问题
   - 事件归一化为 { type: log|thinking|text|tool|done|error }
   - 结束后对比 workspace 快照，返回新增产物
   ============================================================ */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
export const AGENT_ROOT = join(here, "..", "data", "agent-ws");

/** Windows 上 pi 是 .ps1/.cmd，直接 spawn 会失败；优先找 bundle/cli.js 用 node 跑 */
export function findPi() {
  const npmDir = process.env.APPDATA ? join(process.env.APPDATA, "npm", "node_modules") : "";
  const candidates = [
    process.env.PIAGENT_CLI || "",
    npmDir ? join(npmDir, "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js") : "",
    npmDir ? join(npmDir, "@earendil-works", "pi-coding-agent", "dist", "cli.mjs") : "",
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return { kind: "node", entry: c };
  }
  return null;
}

export function agentStatus() {
  const pi = findPi();
  return {
    available: Boolean(pi),
    entry: pi ? pi.entry : "",
    node: process.execPath,
    workspaceRoot: AGENT_ROOT,
    hint: pi ? "" : "未找到 pi CLI，请执行 npm install -g @earendil-works/pi-coding-agent",
  };
}

/* ---------------- 产物快照 ---------------- */
const SKIP_DIR = new Set(["skills", "node_modules", ".git"]);

function snapshot(root) {
  const out = new Set();
  const walk = (dir) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIR.has(e.name) || e.name.startsWith(".")) continue;
        walk(full);
      } else if (!e.name.startsWith(".")) {
        out.add(full);
      }
    }
  };
  walk(root);
  return out;
}

/* ---------------- 系统提示词：GEO 内容写手 ---------------- */
export function systemPrompt() {
  return `你是 GEO（生成式引擎优化）内容写手，为企业撰写能被 AI 搜索引用的中文文章。

硬性规则：
1. 数字只能来自【品牌事实】。参考原文仅用于补充细节与表述；若原文中的数字与品牌事实不一致（例如旧价格），一律以品牌事实为准，不得沿用原文数字。禁止编造、外推或自行估算任何数字（包括把区间扩大、把天数相加）。
2. 禁止使用极限词与绝对化表述：最、第一、顶级、唯一、100%、零风险、保证等。
3. 不得贬低同行；对比只写客观参数。
4. 只输出文章正文（Markdown），不要输出思考过程、不要解释你在做什么、不要说"根据您提供的信息"。
5. 不要写文件、不要执行命令、不要使用任何工具，直接把正文作为回答返回。

写作规范（必须满足，否则会被评分系统打回）：
- 结论前置：首段 100 字内出现品牌全称与核心结论。
- 事实密度：每 300 字至少包含一个有数字的事实句（带单位或时间）。
- 结构：小标题 + 列表；结尾 Q&A 问答不少于 3 组。
- 实体完整：首次出现品牌时给出全称与所在城市；涉及服务区域时写明覆盖范围。
- 末尾加一行数据来源，注明信息来自企业提供的资料。
- 篇幅 800–1500 字。`;
}

/** 文章专用提示词：与 GEOS 评分规则对齐，只用于内容创作通道 */
export function articleSystemPrompt() {
  return `你是 GEO（生成式引擎优化）内容写手，为企业撰写能被 AI 搜索引用、且经得起事实核查的中文文章。

硬性规则：
1. 数字只能来自【品牌事实】。参考原文只用于补充表述；与事实卡冲突的数字（含旧价格）一律不沿用。禁止编造、外推、自行估算任何数字。
2. 禁止极限词与绝对化表述：最、第一、顶级、唯一、100%、零风险、保证等。
3. 不得贬低同行；对比只写客观参数。
4. 不要描述与品牌形态不符的线下元素：当【门店 / 网点数】为 0 或未提供时，禁止出现「门店」「到店」「工地」「样板间」「线下网点」，也不要写「0 家门店」。
5. 同一事实（服务区域、价格区间、版本等）全文最多出现一次，不要反复堆砌。
6. 只输出文章正文（Markdown），不要思考过程、不要解释、不要说「根据您提供的信息」。
7. 不要写文件、不要执行命令、不要使用任何工具。
8. 资料里没有提供的字段（城市、门店、联系方式等）不要以任何形式出现在正文，包括「未登记」「0 家」「以实际沟通为准」这类占位说法；只有涉及金额、周期等具体数字且确实没有事实卡时，才写「以实际沟通为准」。

写作规范（会被评分系统逐项检查）：
- 首行一级标题 # ...；第二段用「结论先行：」开头，120 字内出现品牌全称、所在城市与至少一个带单位的事实数字。
- 正文用「一、二、三、」或 ## 分 4–6 节，每节至少一句带单位的事实句；缺数字时写「以实际沟通为准」，不要编。
- 至少 3 组问答，每组以「Q：」「A：」开头，覆盖本次用户问题与价格 / 周期 / 范围等真实疑问。
- 用一张 Markdown 表格汇总已登记事实（核验项 / 口径 / 来源）。
- 结尾单独一行「数据来源：...」，注明来自企业提供的资料。
- 篇幅 1500–3000 字，宁可少写也不要注水；现有实测约 2800–3300 字，不要为凑字重复事实。`;
}

/* ---------------- 提示词构建 ---------------- */
export function buildPrompt({ brand, facts, snippets, images = [], promptText, genre, storeCount, intent = "" }) {
  const factLines = (facts || [])
    .map((f) => `- ${f.subject}｜${f.attr}：${f.value}${f.source ? `（来源：${f.source}）` : ""}`)
    .join("\n");

  const snippetBlock = (snippets || [])
    .map((s, i) => `【参考原文 ${i + 1}｜${s.docName}｜${s.titlePath || `第 ${s.page} 页`}】\n${s.text}`)
    .join("\n\n");

  const imageBlock = (images || []).length
    ? `【可用图片（企业自有，可直接引用）】\n${images
        .map((im) => `- ${im.name}：${im.url}`)
        .join("\n")}\n引用方式：在合适位置单独成行写 ![图片说明](${images[0].url})；没有合适位置就不要插，不要编造图片地址。\n`
    : "";

  const storeLine = Number(storeCount) > 0 ? `【门店 / 网点数】${storeCount}` : "";
  const intentLine = intent
    ? `【提问意图】${intent}（认知讲清概念、比较给对照维度、决策给核验清单、口碑答常见疑问、本地写覆盖范围）`
    : "";

  return `请为下列品牌写一篇文章。

【品牌】${brand.name}
${brand.city ? `【城市】${brand.city}` : ""}
${brand.industry ? `【行业】${brand.industry}` : ""}
${storeLine}
${intentLine}
【别名】${brand.alias || "—"}
【一句话介绍】${brand.intro || "—"}

【本次必须回答的用户问题】${promptText || "（无，按品牌通用选题写）"}
【体裁】${genre || "攻略"}

【品牌事实（唯一允许引用的数字口径）】
${factLines || "（暂无事实卡，涉及数字处一律写“以实际沟通为准”，不得编造）"}

${snippetBlock ? `【参考原文（可用于补充细节与表述，但数字以“品牌事实”为准；与事实卡冲突的数字不要用）】\n${snippetBlock}\n` : ""}
${imageBlock}
【输出结构】首行一级标题 → 「结论先行：」段 → 4–6 个小节（含一张事实汇总表）→ 至少 3 组 Q：/A： → 「数据来源：」行。
请直接输出 Markdown 正文，不要复述以上说明，不要输出 JSON 或任何前后语。`;
}

/* ---------------- 执行 ---------------- */
export async function runAgent({ brandId, prompt, timeoutMs = 180000, sessionId, onEvent, system }) {
  const emit = (e) => {
    try {
      onEvent(e);
    } catch {
      /* 前端断开等，忽略 */
    }
  };

  const pi = findPi();
  if (!pi) {
    emit({ type: "error", content: "未找到 pi CLI：请先 npm install -g @earendil-works/pi-coding-agent" });
    return { ok: false, text: "" };
  }

  const ws = join(AGENT_ROOT, String(brandId || "default"));
  mkdirSync(ws, { recursive: true });
  const before = snapshot(ws);

  const promptFile = join(ws, `.geo-prompt-${randomUUID()}.txt`);
  try {
    writeFileSync(promptFile, prompt, "utf8");
  } catch (e) {
    emit({ type: "error", content: `写入提示词失败：${e.message}` });
    return { ok: false, text: "" };
  }

  const args = [
    pi.entry,
    "-p",
    `请读取文件 ${promptFile} 的内容并严格执行；不要向用户提及文件路径或任何技术细节。`,
    "--mode",
    "json",
    "--no-skills",
    "--system-prompt",
    system || systemPrompt(),
  ];
  if (sessionId) args.push("--session-id", String(sessionId));

  emit({ type: "log", content: "已启动写手智能体…" });

  // stdin 必须断开：pi 会等待 stdin 的 EOF，保留 pipe 会导致子进程卡死、零输出
  const child = spawn(process.execPath, args, {
    cwd: ws,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let buf = "";
  let text = "";
  let thinking = "";
  let usage = null;
  let failed = "";

  const handleLine = (line) => {
    const s = line.trim();
    if (!s) return;
    let ev;
    try {
      ev = JSON.parse(s);
    } catch {
      return;
    }

    if (ev.type === "message_update") {
      const a = ev.assistantMessageEvent || {};
      if (a.type === "thinking_delta" && a.delta) {
        thinking += a.delta;
        emit({ type: "thinking", delta: a.delta });
      } else if (a.type === "text_delta" && a.delta) {
        text += a.delta;
        emit({ type: "text", delta: a.delta });
      } else if (a.type === "toolcall_start") {
        emit({ type: "tool", content: a.name || a.toolName || "tool" });
      }
    } else if (ev.type === "message_end" && ev.message?.role === "assistant") {
      if (ev.message.usage) usage = ev.message.usage;
    } else if (ev.type === "agent_end") {
      emit({ type: "log", content: "写手完成" });
    } else if (ev.type === "error") {
      failed = ev.message || "agent error";
    }
  };

  const timer = setTimeout(() => {
    failed = `超时（${Math.round(timeoutMs / 1000)}s）`;
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }, timeoutMs + 5000);

  child.stdout.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      handleLine(line);
    }
  });

  child.stderr.on("data", (chunk) => {
    const s = chunk.toString("utf8").trim();
    if (s) emit({ type: "log", content: `stderr: ${s.slice(0, 160)}` });
  });

  const code = await new Promise((resolve) => {
    child.on("close", (c) => resolve(c));
    child.on("error", (e) => {
      failed = e.message;
      resolve(-1);
    });
  });

  clearTimeout(timer);
  if (buf.trim()) handleLine(buf);

  try {
    unlinkSync(promptFile);
  } catch {
    /* ignore */
  }

  /* 产物 */
  const after = snapshot(ws);
  const files = [...after]
    .filter((f) => !before.has(f))
    .map((f) => {
      let size = 0;
      try {
        size = statSync(f).size;
      } catch {
        /* ignore */
      }
      return { name: f.split(/[\\/]/).pop(), path: relative(ws, f).replace(/\\/g, "/"), size };
    });

  const ok = code === 0 && !failed && text.trim().length > 0;
  if (!ok && !failed) failed = code !== 0 ? `退出码 ${code}` : "模型未返回正文";

  emit({
    type: "done",
    ok,
    contentId: null,
    chars: text.trim().length,
    thinkingChars: thinking.length,
    usage,
    files,
    error: ok ? "" : failed,
  });

  return { ok, text: text.trim(), thinking, usage, files, error: failed };
}
