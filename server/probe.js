/* ============================================================
   探测引擎
   - 平台已配置 Key：真实调用（带重试与失败分类）
   - 未配置：确定性 mock（同一 prompt + 平台结果稳定，便于回归）
   - 每条结果记录 source（live / mock / error），界面上必须可区分
   ============================================================ */
import { db, id, now } from "./db.js";
import { analyzeAnswer, summarize } from "./geo.js";
import { computeBrandMetrics } from "./metrics.js";
import { PROVIDERS, providerConfig, providerMode, callProvider } from "./providers.js";
import { extractHosts } from "./links.js";

export const PLATFORMS = PROVIDERS.map((p) => ({ key: p.key, name: p.name, bias: p.bias }));

export const mode = providerMode;

/* ---------------- 确定性伪随机（mock 用） ---------------- */

function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/* ---------------- mock 生成 ---------------- */

/**
 * 模拟答案：行业无关，只从「生效事实卡」取口径。
 * 早期版本写死了家装话术（整装报价 / 工期 / 量房），对软件类品牌会生成完全无关的回答，
 * 这里改为按事实卡与竞品数据组织，缺失就写「公开信息有限」，不编造。
 */
export function mockAnswer(promptText, platform, ctx) {
  const { brand, facts, competitors } = ctx;
  const seed = hash01(`${promptText}|${platform.key}`);
  const mentioned = seed < 0.45 * platform.bias + 0.08;
  const rankRoll = hash01(`${promptText}|${platform.key}|rank`);

  const usable = (facts || []).filter((f) => !f.status || f.status === "active");
  const pick = (keys) => {
    const f = usable.find((x) => keys.some((k) => String(x.attr || "").includes(k)));
    return f ? `${f.attr}${f.value ? `：${f.value}` : ""}` : "";
  };
  const priceLine = pick(["价格", "报价", "费用", "订阅"]);
  const modeLine = pick(["部署", "版本", "规模", "门店", "团队", "服务区域"]);
  const selfDetail = [priceLine, modeLine].filter(Boolean).join("；");

  const comps = (competitors || []).map((c) => c.name).filter(Boolean);
  const selfSlot = mentioned ? (rankRoll < 0.14 ? 1 : rankRoll < 0.3 ? 2 : rankRoll < 0.46 ? 3 : 5) : 0;

  const subject = brand.industry || "这类方案";
  const scope = brand.city ? `${brand.city}地区` : "";

  let idx = 1;
  const list = [];
  const total = 4 + (hash01(promptText) > 0.5 ? 1 : 0);
  for (let i = 1; i <= total; i++) {
    if (i === selfSlot) {
      list.push(`${idx++}. **${brand.name}**：${selfDetail || "公开资料有限，建议查看官方说明"}。`);
    } else if (comps.length) {
      list.push(`${idx++}. ${comps[(i + idx) % comps.length]}：公开信息有限，建议直接对比其官方参数。`);
    } else {
      list.push(`${idx++}. 同类方案 ${String.fromCharCode(64 + idx)}：公开信息有限，建议按同一口径逐项对比。`);
    }
  }

  const cites = [];
  try {
    const host = brand.site_url ? new URL(String(brand.site_url)).host.replace(/^www\./, "") : "";
    if (host) cites.push(host);
  } catch {
    /* 非法 URL 忽略 */
  }
  cites.push("zhihu.com", "xiaohongshu.com", "github.com");
  const usedCites = cites.slice(0, 2 + Math.floor(hash01(promptText + "c") * 2));

  const head = mentioned
    ? `${scope}看${subject}，按可核验口径整理如下：`
    : `${scope}先按公开信息整理${subject}的常见选择：`;

  const accuracy = (() => {
    const conflict = (facts || []).filter((f) => f.status === "conflict");
    if (conflict.length && mentioned && hash01(promptText + "acc") < 0.3) return 0.7;
    return 1;
  })();

  return {
    answer: `${head}\n${list.join("\n")}\n\n说明：以上为模拟样本，仅用于验证链路与算法，不代表真实 AI 答案。\n信息来源：${usedCites.join("、")}`,
    accuracy,
    source: "mock",
  };
}

/* ---------------- 真实调用（含重试） ---------------- */

const SYSTEM_PROMPT = (name, ctx) =>
  `你是${name}的中文助手，回答用户关于「${ctx.brand.industry || "该品类"}」的选择问题。` +
  `要求：给出 3-5 个具体选项或方案，尽量包含可核实的参数（价格口径、版本、部署方式等），并在末尾标注信息来源。` +
  `不要编造不存在的资质或奖项；如果信息不足，明确说明"公开信息有限"。`;

async function liveAnswer(promptText, platform, ctx) {
  const p = PROVIDERS.find((x) => x.key === platform.key);
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const out = await callProvider(p, {
        system: SYSTEM_PROMPT(p.name, ctx),
        user: promptText,
        timeoutMs: 60000,
      });
      return { answer: out.answer, accuracy: 1, source: "live" };
    } catch (e) {
      lastErr = e;
      // 鉴权/未配置类错误重试无意义
      if (e.kind === "auth" || e.kind === "unconfigured") break;
      await new Promise((r) => setTimeout(r, 600 * attempt));
    }
  }
  throw lastErr;
}

/* ---------------- 执行一次探测 ---------------- */

export function loadContext(brandId) {
  const brand = db.prepare("SELECT * FROM brands WHERE id = ?").get(brandId);
  const facts = db.prepare("SELECT * FROM facts WHERE brand_id = ?").all(brandId);
  const competitors = db.prepare("SELECT * FROM competitors WHERE brand_id = ?").all(brandId);
  const storeCount = db.prepare("SELECT COUNT(*) AS c FROM stores WHERE brand_id = ?").get(brandId).c;
  return { brand, facts, competitors, storeCount };
}

export function createRun({ brandId, platforms, sample = 1 }) {
  const list = platforms && platforms.length ? platforms : PROVIDERS.map((p) => p.key);
  const prompts = db.prepare("SELECT * FROM prompts WHERE brand_id = ?").all(brandId);
  const total = prompts.length * list.length * Math.max(1, sample);

  const runId = id();
  db.prepare(
    `INSERT INTO probe_runs (id, brand_id, status, total, done, mode, platforms, started_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(runId, brandId, "running", total, 0, mode(), list.join(","), now());

  executeRun(runId, brandId, prompts, list, Math.max(1, sample)).catch((e) => {
    db.prepare("UPDATE probe_runs SET status='failed', error=?, finished_at=? WHERE id=?").run(
      String(e.message || e),
      now(),
      runId
    );
  });

  return { runId, total };
}

async function executeRun(runId, brandId, prompts, platformKeys, sample) {
  const ctx = loadContext(brandId);
  let done = 0;

  for (const prompt of prompts) {
    for (const pkey of platformKeys) {
      const platform = PLATFORMS.find((p) => p.key === pkey) || PLATFORMS[0];
      const cfg = providerConfig(PROVIDERS.find((p) => p.key === platform.key));

      for (let s = 0; s < sample; s++) {
        let answer = "";
        let accuracy = 1;
        let source = cfg.live ? "live" : "mock";
        let channel = cfg.live ? "api_raw" : "mock";
        let grade = cfg.live ? "C" : "M";
        let errKind = "";

        try {
          const out = cfg.live
            ? await liveAnswer(prompt.text, platform, ctx)
            : mockAnswer(prompt.text, platform, ctx);
          answer = out.answer;
          accuracy = out.accuracy;
          source = out.source;
          if (!cfg.live) await new Promise((r) => setTimeout(r, 4));
        } catch (e) {
          errKind = e.kind || "error";
          answer = `[探测失败:${errKind}] ${String(e.message || e).slice(0, 300)}`;
          accuracy = 0;
          source = "error";
        }

        const parsed = analyzeAnswer(answer, ctx.brand, ctx.competitors);
        const finalAccuracy = parsed.mentioned ? accuracy : 0;

        db.prepare(
          `INSERT INTO probe_results
             (id, run_id, brand_id, prompt_id, platform, answer, citations, position, mention, comp_mentions, accuracy, sentiment,
              created_at, source, err_kind, channel, grade)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).run(
          id(), runId, brandId, prompt.id, platform.key, answer, JSON.stringify(extractHosts(answer)),
          parsed.position, parsed.mentioned ? 1 : 0, parsed.compMentioned, finalAccuracy,
          "neutral", now(), source, errKind, channel, grade
        );

        done += 1;
        if (done % 3 === 0 || done === prompts.length * platformKeys.length * sample) {
          db.prepare("UPDATE probe_runs SET done=? WHERE id=?").run(done, runId);
        }
      }
    }
  }

  const rows = db.prepare("SELECT * FROM probe_results WHERE run_id = ?").all(runId);
  const summary = summarize(rows, prompts);

  // 双轨指标统一交给 metrics 层写入，避免两处算法不一致
  computeBrandMetrics(brandId);

  db.prepare("UPDATE probe_runs SET status='done', done=?, finished_at=? WHERE id=?").run(rows.length, now(), runId);

  return summary;
}

export function runSummary(runId) {
  const run = db.prepare("SELECT * FROM probe_runs WHERE id = ?").get(runId);
  if (!run) return null;
  const rows = db.prepare("SELECT * FROM probe_results WHERE run_id = ?").all(runId);
  const prompts = db.prepare("SELECT * FROM prompts WHERE brand_id = ?").all(run.brand_id);
  const summary = rows.length ? summarize(rows, prompts) : null;
  return { run, summary };
}
