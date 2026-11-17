/* ============================================================
   数据图：把事实卡画成 SVG（不调模型，零成本、可复现）
   理念：AI 引用时看的是文字与数字，所以图的价值在"把数字结构化"，
         alt/title/desc 必须写清数字，爬虫读得到。
   ============================================================ */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const FIG_DIR = join(here, "..", "data", "figures");
mkdirSync(FIG_DIR, { recursive: true });

const FONT = `"PingFang SC","Microsoft YaHei","Helvetica Neue",Arial,sans-serif`;
const ACCENT = "#0071e3";
const INK = "#1d1d1f";
const MUTE = "#86868b";
const HAIR = "#e5e5e7";

const esc = (s) =>
  String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** 从事实值里取数字序列，如 "980–1350 元/㎡" -> [980, 1350] */
export function numsOf(value) {
  return (String(value || "").match(/\d+(?:\.\d+)?/g) || []).map(Number);
}

function save(svg, key) {
  const hash = createHash("sha1").update(key + svg).digest("hex").slice(0, 24);
  writeFileSync(join(FIG_DIR, `${hash}.svg`), svg, "utf8");
  return `/api/figures/${hash}.svg`;
}

/* ---------------- 报价区间条 ---------------- */
function priceBar({ brand, priceValue, competitorValues }) {
  const [lo, hi] = numsOf(priceValue);
  if (!Number.isFinite(lo)) return null;

  const all = [lo, hi || lo, ...competitorValues.flatMap(numsOf)].filter((n) => Number.isFinite(n));
  const max = Math.max(2000, Math.ceil(Math.max(...all) / 500) * 500);
  const W = 720;
  const L = 56;
  const R = W - 56;
  const x = (v) => L + ((R - L) * v) / max;

  const ticks = [];
  for (let v = 0; v <= max; v += max / 4) {
    ticks.push(
      `<line x1="${x(v).toFixed(1)}" y1="96" x2="${x(v).toFixed(1)}" y2="102" stroke="${HAIR}" stroke-width="1"/>` +
        `<text x="${x(v).toFixed(1)}" y="120" font-size="11" fill="${MUTE}" text-anchor="middle">${Math.round(v)}</text>`
    );
  }

  const bars = [
    { label: brand.name, lo, hi: hi || lo, color: ACCENT, y: 34 },
    ...competitorValues.slice(0, 3).map((v, i) => {
      const [a, b] = numsOf(v);
      return { label: `对比 ${i + 1}`, lo: a, hi: b || a, color: "#c7c7cc", y: 34 + (i + 1) * 26 };
    }),
  ].filter((b) => Number.isFinite(b.lo));

  const barSvg = bars
    .map((b) => {
      const w = Math.max(6, x(b.hi) - x(b.lo));
      return (
        `<text x="${L}" y="${b.y + 9}" font-size="11.5" fill="${b.label === brand.name ? INK : MUTE}" text-anchor="end">${esc(
          b.label.length > 8 ? b.label.slice(0, 8) : b.label
        )}</text>` +
        `<rect x="${x(b.lo).toFixed(1)}" y="${b.y}" width="${w.toFixed(1)}" height="12" rx="6" fill="${b.color}" opacity="${
          b.color === ACCENT ? 0.95 : 0.7
        }"/>` +
        `<text x="${(x(b.hi) + 8).toFixed(1)}" y="${b.y + 10}" font-size="10.5" fill="${MUTE}">${b.lo}${
          b.hi !== b.lo ? `–${b.hi}` : ""
        }</text>`
      );
    })
    .join("");

  const height = 150 + Math.max(0, bars.length - 1) * 26;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" role="img">
<title>${esc(brand.name)}整装报价区间：${lo}${hi ? `–${hi}` : ""} 元每平方米</title>
<desc>横向条形图，单位元每平方米。${esc(brand.name)}区间 ${lo}${hi ? ` 到 ${hi}` : ""}，与同城对比区间并列展示。</desc>
<rect width="${W}" height="${height}" fill="#ffffff"/>
<text x="${L}" y="20" font-size="12" font-weight="600" fill="${INK}">整装报价区间（元/㎡）</text>
<line x1="${L}" y1="52" x2="${R}" y2="52" stroke="${HAIR}" stroke-width="1"/>${barSvg}
<line x1="${L}" y1="96" x2="${R}" y2="96" stroke="${HAIR}" stroke-width="2"/>${ticks.join("")}
<text x="${L}" y="${height - 12}" font-size="10.5" fill="${MUTE}">数据来源：企业提供的事实卡；区间含常规配置，实际以量房报价为准</text>
</svg>`;

  return { svg, url: save(svg, `price-${brand.name}-${priceValue}`), type: "price" };
}

/* ---------------- 工期流程 ---------------- */
function timeline({ brand, durationValue }) {
  const [lo, hi] = numsOf(durationValue);
  if (!Number.isFinite(lo)) return null;

  const steps = ["拆除清运", "水电改造", "泥木工程", "油漆涂装", "主材安装", "竣工验收"];
  const W = 720;
  const H = 132;
  const pad = 56;
  const gap = (W - pad * 2) / (steps.length - 1);

  const nodes = steps
    .map((s, i) => {
      const cx = pad + gap * i;
      const isLast = i === steps.length - 1;
      return (
        `<circle cx="${cx.toFixed(1)}" cy="64" r="${isLast ? 7 : 5.5}" fill="${isLast ? ACCENT : "#ffffff"}" stroke="${ACCENT}" stroke-width="2"/>` +
        `<text x="${cx.toFixed(1)}" y="90" font-size="10.5" fill="${INK}" text-anchor="middle">${s}</text>` +
        (i < steps.length - 1
          ? `<line x1="${(cx + 8).toFixed(1)}" y1="64" x2="${(cx + gap - 8).toFixed(1)}" y2="64" stroke="${HAIR}" stroke-width="2"/>`
          : "")
      );
    })
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">
<title>${esc(brand.name)}常规工期：${lo}${hi ? ` 到 ${hi}` : ""} 天，共 6 个施工阶段</title>
<desc>施工流程示意图：拆除清运、水电改造、泥木工程、油漆涂装、主材安装、竣工验收，常规总工期 ${lo}${
    hi ? ` 到 ${hi}` : ""
  } 天。</desc>
<rect width="${W}" height="${H}" fill="#ffffff"/>
<text x="${pad}" y="26" font-size="12" font-weight="600" fill="${INK}">施工流程与工期（常规 ${lo}${
    hi ? `–${hi}` : ""
  } 天）</text>
<line x1="${pad}" y1="64" x2="${W - pad}" y2="64" stroke="none"/>${nodes}
<text x="${pad}" y="${H - 10}" font-size="10.5" fill="${MUTE}">数据来源：企业提供的事实卡；遇结构改造或主材延期，工期相应顺延</text>
</svg>`;

  return { svg, url: save(svg, `timeline-${brand.name}-${durationValue}`), type: "timeline" };
}

/* ---------------- 外部入口 ---------------- */
export function buildFigures({ brand, facts, competitors = [] }) {
  const pick = (kw) => facts.find((f) => f.attr.includes(kw) && f.status === "active")?.value || "";
  const priceValue = pick("价格");
  const durationValue = pick("工期");

  const competitorValues = competitors.map((c) => c.price_range || "").filter((v) => numsOf(v).length);

  const out = [];
  if (priceValue) {
    const f = priceBar({ brand, priceValue, competitorValues });
    if (f) out.push({ ...f, caption: `整装报价区间：${priceValue}` });
  }
  if (durationValue) {
    const f = timeline({ brand, durationValue });
    if (f) out.push({ ...f, caption: `常规工期：${durationValue}` });
  }
  return out;
}

/** 在正文中按小节插入图（不依赖模型自觉插图） */
export function injectFigures(body, figures) {
  if (!figures.length) return { body, inserted: [] };
  let text = body;
  const inserted = [];

  const tryAfter = (kw, fig) => {
    if (!fig || inserted.some((i) => i.type === fig.type)) return;
    const md = `\n\n![${fig.caption}](${fig.url})\n\n*数据来源：企业提供的事实卡，实际以量房报价为准*\n\n`;
    const lines = text.split("\n");
    let idx = -1;

    // ① 优先：该关键词所在小节的末尾
    for (let i = 0; i < lines.length; i++) {
      if (/^#{2,4}\s/.test(lines[i]) && lines[i].includes(kw)) {
        idx = i + 1;
        for (let j = i + 1; j < lines.length; j++) {
          if (/^#{1,4}\s/.test(lines[j])) break;
          if (lines[j].trim()) idx = j + 1;
        }
        break;
      }
    }

    // ② 退一步：正文中第一个提到该关键词的段落之后（标题命名各写各的）
    if (idx < 0) {
      for (let i = 0; i < lines.length; i++) {
        if (!/^#{1,6}\s/.test(lines[i]) && lines[i].includes(kw) && lines[i].trim().length > 12) {
          idx = i + 1;
          break;
        }
      }
    }

    if (idx > 0) {
      lines.splice(idx, 0, md.trimEnd());
      text = lines.join("\n");
      inserted.push({ type: fig.type, after: lines[idx - 1]?.slice(0, 20) || "" });
    }
  };

  tryAfter("报价", figures.find((f) => f.type === "price"));
  if (!inserted.some((i) => i.type === "price")) tryAfter("价格", figures.find((f) => f.type === "price"));
  if (!inserted.some((i) => i.type === "price")) tryAfter("多少", figures.find((f) => f.type === "price"));
  tryAfter("工期", figures.find((f) => f.type === "timeline"));

  // 实在找不到相关小节，才放到文末（仍在数据来源之前），并保留图注
  figures.forEach((fig) => {
    if (inserted.some((i) => i.type === fig.type)) return;
    const md = `\n\n![${fig.caption}](${fig.url})\n\n*数据来源：企业提供的事实卡，实际以量房报价为准*\n\n`;
    const srcIdx = text.lastIndexOf("数据来源");
    text = srcIdx > 0 ? text.slice(0, srcIdx) + md.trim() + "\n\n" + text.slice(srcIdx) : text + md;
    inserted.push({ type: fig.type, after: "文末" });
  });

  return { body: text, inserted };
}
