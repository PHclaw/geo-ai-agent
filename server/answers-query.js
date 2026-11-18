/* ============================================================
   采集结果浏览（M3）：查询归一化、筛选条件、行映射与 CSV
   - 纯函数，无 IO，便于单测
   - citations 在库里存的是域名数组的 JSON 字符串
   ============================================================ */

export const ANSWER_PAGE_SIZE = 20;
export const ANSWER_MAX_PAGE_SIZE = 100;
export const ANSWER_CSV_LIMIT = 5000;

export function normalizeAnswerQuery(q = {}) {
  const page = Math.max(1, Number(q.page) || 1);
  const rawSize = Number(q.size) || ANSWER_PAGE_SIZE;
  const size = Math.min(ANSWER_MAX_PAGE_SIZE, Math.max(5, rawSize));

  const citedRaw = String(q.cited ?? "").trim().toLowerCase();
  const cited = ["1", "yes", "true"].includes(citedRaw)
    ? 1
    : ["0", "no", "false"].includes(citedRaw)
      ? 0
      : null;

  return {
    page,
    size,
    platform: String(q.platform || "").trim().slice(0, 20),
    keyword: String(q.keyword || "").trim().slice(0, 40),
    from: String(q.from || "").trim().slice(0, 10),
    to: String(q.to || "").trim().slice(0, 10),
    cited,
    // 空 = 最新一轮；all = 全部轮次
    runId: String(q.runId || "").trim().slice(0, 40),
  };
}

/** 组装 WHERE；runId 为空或 all 时不按轮次过滤 */
export function buildAnswerWhere(q, brandId, latestRunId = "") {
  const where = ["r.brand_id = ?"];
  const params = [brandId];

  const runId = q.runId === "all" ? "" : q.runId || latestRunId || "";
  if (runId) {
    where.push("r.run_id = ?");
    params.push(runId);
  }
  if (q.platform) {
    where.push("r.platform = ?");
    params.push(q.platform);
  }
  if (q.keyword) {
    where.push("(p.text LIKE ? OR r.answer LIKE ?)");
    params.push(`%${q.keyword}%`, `%${q.keyword}%`);
  }
  if (q.from) {
    where.push("r.created_at >= ?");
    params.push(q.from);
  }
  if (q.to) {
    where.push("r.created_at <= ?");
    params.push(`${q.to} 23:59:59`);
  }
  if (q.cited === 1) where.push("r.citations <> '[]'");
  if (q.cited === 0) where.push("r.citations = '[]'");

  return { sql: where.join(" AND "), params, runId };
}

/** 兼容字符串数组与对象数组两种历史格式 */
export function parseCitations(raw) {
  let v;
  try {
    v = typeof raw === "string" ? JSON.parse(raw || "[]") : raw;
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x : x?.host || x?.url || ""))
    .map((x) => String(x).trim().toLowerCase())
    .filter(Boolean);
}

export function clipAnswer(text, max = 160) {
  const s = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function toAnswerRow(r, clip = 160) {
  const citations = parseCitations(r.citations);
  return {
    id: r.id,
    runId: r.run_id,
    platform: r.platform,
    promptId: r.prompt_id,
    promptText: r.prompt_text || "",
    intent: r.intent || "",
    answer: clipAnswer(r.answer, clip),
    fullLength: String(r.answer || "").length,
    citations: citations.slice(0, 3),
    citationCount: citations.length,
    cited: citations.length > 0,
    mention: !!r.mention,
    accuracy: r.accuracy,
    position: r.position,
    // 单条来源：live 真实调用 / mock 模拟 / cend 人工取证 / error 调用失败
    source: r.source || "mock",
    createdAt: r.created_at,
  };
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** rows 需含 createdAt / platform / promptText / intent / mention / citations / answer 全文 */
export function toAnswerCsv(rows = []) {
  const header = ["采集时间", "平台", "提问", "意图", "是否提及", "是否引用", "引用域名", "答案全文"];
  const lines = [header.join(",")];
  for (const r of rows) {
    const cited = parseCitations(r.citations);
    lines.push(
      [
        csvCell(r.createdAt),
        csvCell(r.platform),
        csvCell(r.promptText),
        csvCell(r.intent),
        csvCell(r.mention ? "是" : "否"),
        csvCell(cited.length ? "是" : "否"),
        csvCell(cited.join(" | ")),
        csvCell(r.answer),
      ].join(",")
    );
  }
  return lines.join("\r\n");
}
