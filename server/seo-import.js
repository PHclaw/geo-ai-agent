/* ============================================================
   半自动数据通道：站长平台 CSV 解析 + 人工位次统计
   - 列名兼容中英文（GSC / 百度搜索资源平台导出）
   - 数值列留空不写 0；坏行跳过并返回行号
   ============================================================ */
import Papa from "papaparse";

const HEADERS = {
  date: ["date", "日期", "统计日期", "day"],
  indexedPages: ["indexedPages", "indexed_pages", "收录页面数", "收录数", "收录"],
  impressions: ["impressions", "展现量", "展示量", "展示次数", "曝光量"],
  clicks: ["clicks", "点击", "点击数", "点击次数", "点击量"],
  ctr: ["ctr", "点击率"],
  avgPosition: ["avgPosition", "avg_position", "平均排名", "平均位次", "排名"],
  exposureRate: ["exposureRate", "exposure_rate", "曝光率"],
  note: ["note", "备注", "说明"],
};

/** 兼容 2026-11-09 / 2026/11/9 / 20261109 / 2026年11月9日 */
export function normalizeDate(v) {
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
  if (!m) m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return "";
  return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
}

function toNumber(v) {
  if (v === undefined || v === null || String(v).trim() === "") return undefined;
  const n = Number(String(v).replace(/[,，%％\s]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function pick(row, names) {
  for (const n of names) {
    if (row[n] !== undefined && String(row[n]).trim() !== "") return row[n];
  }
  return undefined;
}

/** 曝光率：只统计有值的样本；0 表示未进前 N，留空表示未检测（不计入分母） */
export function computeExposure(values, topN = 20) {
  const samples = values
    .map((v) => (v === null || v === undefined || v === "" ? null : Number(v)))
    .filter((v) => v !== null && Number.isFinite(v));
  const exposed = samples.filter((v) => v > 0 && v <= topN).length;
  return {
    samples: samples.length,
    exposed,
    rate: samples.length ? Number(((exposed / samples.length) * 100).toFixed(1)) : null,
  };
}

/** 解析 CSV 文本为按天的记录；返回 { records, errors } */
export function parseCsvRecords(csv) {
  const parsed = Papa.parse(String(csv || ""), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => String(h).trim().replace(/^\uFEFF/, ""),
  });
  const records = [];
  const errors = [];

  parsed.data.forEach((row, i) => {
    const line = i + 2;
    const rawDate = pick(row, HEADERS.date);
    if (!rawDate) {
      errors.push(`第 ${line} 行缺少日期列`);
      return;
    }
    const date = normalizeDate(rawDate);
    if (!date) {
      errors.push(`第 ${line} 行日期格式无法识别：${rawDate}`);
      return;
    }
    const rec = { date };
    const numeric = {
      indexedPages: HEADERS.indexedPages,
      impressions: HEADERS.impressions,
      clicks: HEADERS.clicks,
      ctr: HEADERS.ctr,
      avgPosition: HEADERS.avgPosition,
      exposureRate: HEADERS.exposureRate,
    };
    for (const [key, names] of Object.entries(numeric)) {
      const n = toNumber(pick(row, names));
      if (n !== undefined) rec[key] = key === "ctr" && n > 1 ? n / 100 : n;
    }
    const note = pick(row, HEADERS.note);
    if (note !== undefined) rec.note = String(note).slice(0, 200);

    if (Object.keys(rec).length < 2) {
      errors.push(`第 ${line} 行没有任何可导入的数值`);
      return;
    }
    records.push(rec);
  });

  return { records, errors };
}
