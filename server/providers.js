/* ============================================================
   模型 Provider 层
   - 读取 server/.env（不引第三方依赖）
   - 每个平台独立配置 base / model / key
   - 统一调用 OpenAI 兼容的 /chat/completions
   - 连通性自检供前端展示
   ============================================================ */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** 极简 .env 解析：KEY=VALUE，支持 # 注释与引号 */
export function loadEnv() {
  const file = join(here, ".env");
  if (!existsSync(file)) return false;
  const text = readFileSync(file, "utf8");
  text.split(/\r?\n/).forEach((line) => {
    const s = line.trim();
    if (!s || s.startsWith("#")) return;
    const i = s.indexOf("=");
    if (i < 0) return;
    const k = s.slice(0, i).trim();
    let v = s.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  });
  return true;
}

/**
 * 平台清单
 * bias 仅用于 mock 引擎的差异模拟，真实调用不参与
 * caveat 会被如实展示在界面上
 */
export const PROVIDERS = [
  {
    key: "deepseek",
    name: "DeepSeek",
    vendor: "深度求索",
    defaultBase: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    envPrefix: "DEEPSEEK",
    web: "https://chat.deepseek.com/",
    bias: 0.88,
    caveat: "",
  },
  {
    key: "kimi",
    name: "Kimi",
    vendor: "月之暗面",
    defaultBase: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
    envPrefix: "KIMI",
    web: "https://kimi.moonshot.cn/",
    bias: 0.72,
    caveat: "",
  },
  {
    key: "qwen",
    name: "通义 / 夸克",
    vendor: "阿里云百炼",
    defaultBase: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    envPrefix: "QWEN",
    web: "https://tongyi.aliyun.com/qianwen/",
    bias: 0.6,
    caveat: "",
  },
  {
    key: "doubao",
    name: "豆包",
    vendor: "火山方舟",
    defaultBase: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-pro-32k",
    envPrefix: "DOUBAO",
    web: "https://www.doubao.com/chat/",
    bias: 1.0,
    caveat: "方舟需先在控制台创建推理接入点，MODEL 填接入点 ID（ep-xxx）",
  },
  {
    key: "wenxin",
    name: "文心 / 百度",
    vendor: "百度千帆",
    defaultBase: "https://qianfan.baidubce.com/v2",
    defaultModel: "ernie-4.0-8k",
    envPrefix: "WENXIN",
    web: "https://yiyan.baidu.com/",
    bias: 0.55,
    caveat: "千帆 v2 支持 OpenAI 兼容协议，需开通对应模型",
  },
  {
    key: "yuanbao",
    name: "腾讯元宝",
    vendor: "腾讯混元",
    defaultBase: "https://api.hunyuan.cloud.tencent.com/v1",
    defaultModel: "hunyuan-turbos-latest",
    envPrefix: "YUANBAO",
    web: "https://yuanbao.tencent.com/chat",
    bias: 0.8,
    caveat: "元宝 C 端无公开 API，此处用混元模型近似，答案风格与 C 端元宝存在差异",
  },
];

export function providerConfig(p) {
  const prefix = `GEO_${p.envPrefix}`;
  const key = process.env[`${prefix}_KEY`] || "";
  const base = process.env[`${prefix}_BASE`] || p.defaultBase;
  const model = process.env[`${prefix}_MODEL`] || p.defaultModel;
  return { key, base, model, live: Boolean(key) };
}

/** 供前端展示：哪些平台已配置 */
export function providerStatus() {
  return PROVIDERS.map((p) => {
    const c = providerConfig(p);
    return {
      key: p.key,
      name: p.name,
      vendor: p.vendor,
      model: c.model,
      base: c.base,
      live: c.live,
      web: process.env[`GEO_${p.envPrefix}_WEB`] || p.web || "",
      caveat: p.caveat,
    };
  });
}

export function providerMode() {
  const live = PROVIDERS.filter((p) => providerConfig(p).live).length;
  if (live === 0) return "mock";
  if (live === PROVIDERS.length) return "live";
  return "mixed";
}

/**
 * 调用一个平台
 * 失败分类：timeout / auth / rate / http / empty，便于重试策略与前端提示
 */
export async function callProvider(p, { system, user, timeoutMs = 60000 }) {
  const c = providerConfig(p);
  if (!c.live) {
    const err = new Error(`${p.name} 未配置 API Key`);
    err.kind = "unconfigured";
    throw err;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${c.base.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.key}` },
      body: JSON.stringify({
        model: c.model,
        temperature: 0.7,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: ctrl.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      const kind = res.status === 401 || res.status === 403 ? "auth" : res.status === 429 ? "rate" : "http";
      const err = new Error(`${p.name} HTTP ${res.status}: ${text.slice(0, 180)}`);
      err.kind = kind;
      err.status = res.status;
      throw err;
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      const err = new Error(`${p.name} 返回非 JSON：${text.slice(0, 120)}`);
      err.kind = "http";
      throw err;
    }

    const answer = data?.choices?.[0]?.message?.content || "";
    if (!answer.trim()) {
      const err = new Error(`${p.name} 返回空内容`);
      err.kind = "empty";
      throw err;
    }
    return { answer, usage: data?.usage || null, model: data?.model || c.model };
  } catch (e) {
    if (e.name === "AbortError") {
      const err = new Error(`${p.name} 请求超时（${Math.round(timeoutMs / 1000)}s）`);
      err.kind = "timeout";
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** 连通性自检：发一个极小请求，返回耗时与模型回显 */
export async function testProvider(key) {
  const p = PROVIDERS.find((x) => x.key === key);
  if (!p) return { ok: false, error: "未知平台", kind: "unknown" };
  const started = Date.now();
  try {
    const out = await callProvider(p, {
      system: "你是连通性测试助手，只需回答两个字：可用。",
      user: "请回答：可用",
      timeoutMs: 20000,
    });
    return { ok: true, ms: Date.now() - started, model: out.model, sample: out.answer.slice(0, 40) };
  } catch (e) {
    return { ok: false, ms: Date.now() - started, error: String(e.message || e), kind: e.kind || "unknown" };
  }
}
