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

function mockAnswer(promptText, platform, ctx) {
  const { brand, facts, competitors } = ctx;
  const seed = hash01(`${promptText}|${platform.key}`);
  const bias = platform.bias;

  const mentioned = seed < 0.45 * bias + 0.08;
  const rankRoll = hash01(`${promptText}|${platform.key}|rank`);

  const priceFact = facts.find((f) => f.attr.includes("价格区间"));
  const range = priceFact ? priceFact.value : "面议";
  const durFact = facts.find((f) => f.attr === "工期");
  const duration = durFact ? durFact.value : "以合同为准";

  const comps = competitors.map((c) => c.name);
  const selfSlot = mentioned ? (rankRoll < 0.14 ? 1 : rankRoll < 0.3 ? 2 : rankRoll < 0.46 ? 3 : 5) : 0;

  let idx = 1;
  const list = [];
  const total = 4 + (hash01(promptText) > 0.5 ? 1 : 0);
  for (let i = 1; i <= total; i++) {
    if (i === selfSlot) {
      list.push(`${idx++}. **${brand.name}**：${brand.city}本地门店 ${ctx.storeCount} 家，整装报价 ${range}，工期 ${duration}。`);
    } else {
      const c = comps[(i + idx) % Math.max(1, comps.length)];
      list.push(`${idx++}. ${c || "本地其他机构"}：可参考同类方案，具体以现场量房为准。`);
    }
  }

  const cites = ["njhouse.com", "zhihu.com", "xiaohongshu.com", brand.city + "本地门户"];
  const usedCites = cites.slice(0, 2 + Math.floor(hash01(promptText + "c") * 2));

  const head = mentioned
    ? `${brand.city}地区可参考以下几家，按口碑与报价透明度排序：`
    : `${brand.city}地区可参考以下几家：`;

  const accuracy = (() => {
    const conflict = facts.filter((f) => f.status === "conflict");
    if (conflict.length && mentioned && hash01(promptText + "acc") < 0.3) return 0.7;
    return 1;
  })();

  return {
    answer: `${head}\n${list.join("\n")}\n\n说明：以上价格为常规区间，实际以量房与施工方案为准。\n信息来源：${usedCites.join("、")}`,
    accuracy,
    source: "mock",
  };
}

/* ---------------- 真实调用（含重试） ---------------- */

const SYSTEM_PROMPT = (name, ctx) =>
  `你是${name}的中文助手，回答用户关于「${ctx.brand.industry || "本地服务"}」的选择问题。` +
  `要求：列出 3-5 家具体的本地商家或方案，给出价格区间、工期等可核实信息，并在末尾标注信息来源。` +
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
