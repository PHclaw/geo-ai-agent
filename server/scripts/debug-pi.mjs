/* 排查 pi 调用差异：node scripts/debug-pi.mjs */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { findPi } from "../agent/piagent.js";

const pi = findPi();
if (!pi) {
  console.log("no pi");
  process.exit(1);
}

const ws = join(process.cwd(), "data", "agent-ws", "debug");
mkdirSync(ws, { recursive: true });
const promptFile = join(ws, "p.txt");
writeFileSync(promptFile, "请写一句关于南京老房翻新的话，不超过 30 字。", "utf8");

// cwd 必须是干净目录：pi 启动时会扫描工作目录，放在大目录会卡住
async function runInWs(label, args, timeoutMs = 60000) {
  const t0 = Date.now();
  const child = spawn(process.execPath, [pi.entry, ...args], { cwd: ws, windowsHide: true });
  let lines = 0;
  let text = "";
  let buf = "";
  let stderr = "";

  child.stdout.on("data", (c) => {
    buf += c.toString("utf8");
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      lines++;
      try {
        const ev = JSON.parse(line);
        const a = ev.assistantMessageEvent || {};
        if (a.type === "text_delta" && a.delta) text += a.delta;
      } catch {
        /* ignore */
      }
    }
  });
  child.stderr.on("data", (c) => (stderr += c.toString("utf8")));

  const timer = setTimeout(() => child.kill(), timeoutMs);
  const code = await new Promise((r) => child.on("close", r));
  clearTimeout(timer);

  console.log(
    "[%s] code=%s lines=%s text=%s elapsed=%ss stderr=%s",
    label, code, lines, text.length, ((Date.now() - t0) / 1000).toFixed(1), stderr.trim().slice(0, 100) || "-"
  );
  if (text) console.log("    text: %s", text.slice(0, 60));
  return text;
}

await runInWs("A 最简", ["-p", "回答两个字：可用", "--mode", "json", "--no-skills"]);
await runInWs("B 带系统提示", ["-p", "回答两个字：可用", "--mode", "json", "--no-skills", "--system-prompt", "你是助手，只回答问题。"]);
await runInWs("C 读文件", ["-p", `请读取文件 ${promptFile} 的内容并严格执行；不要提及文件路径。`, "--mode", "json", "--no-skills"]);
