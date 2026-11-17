/* 诊断 spawn 差异：node scripts/debug-spawn.mjs */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { findPi } from "../agent/piagent.js";

const pi = findPi();
console.log("execPath   =", process.execPath);
console.log("NODE_OPTIONS=", process.env.NODE_OPTIONS || "-");
console.log("CI         =", process.env.CI || "-");
console.log("TERM       =", process.env.TERM || "-");
console.log("entry      =", pi?.entry);
console.log("entrySize  =", pi ? (await import("node:fs")).statSync(pi.entry).size : "-");

const ws = join(process.cwd(), "data", "agent-ws", "debug");

function test(label, opts, args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [pi.entry, ...args], opts);
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c.toString("utf8")));
    child.stderr.on("data", (c) => (err += c.toString("utf8")));
    const timer = setTimeout(() => {
      child.kill();
      console.log("[%s] TIMEOUT %ss out=%s err=%s", label, timeoutMs / 1000, out.length, err.slice(0, 80) || "-");
      resolve();
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      const lines = out.split("\n").filter(Boolean).length;
      console.log("[%s] close code=%s lines=%s outLen=%s err=%s", label, code, lines, out.length, err.slice(0, 100) || "-");
      resolve();
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      console.log("[%s] spawn error: %s", label, e.message);
      resolve();
    });
  });
}

const args = ["-p", "回答两个字：可用", "--mode", "json", "--no-skills"];

await test("1 windowsHide", { cwd: ws, windowsHide: true }, args);
await test("2 noHide", { cwd: ws }, args);
await test("3 envClean", { cwd: ws, windowsHide: true, env: { ...process.env, NODE_OPTIONS: "" } }, args);
await test("4 shell", { cwd: ws, shell: true }, args);
