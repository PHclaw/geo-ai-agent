/* ============================================================
   文档文本抽取：把各种格式统一成 [{ page, titlePath, text }]
   这里只负责"拿到文字"，不做结构化（结构化交给切片 + 事实卡）
   ============================================================ */
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import mammoth from "mammoth";
import XLSX from "xlsx";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

export const SUPPORTED = ["pdf", "docx", "xlsx", "xls", "csv", "pptx", "txt", "md", "jpg", "jpeg", "png", "webp", "gif"];
export const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp", "gif"];

export function extOf(name) {
  return String(extname(name || "")).replace(".", "").toLowerCase();
}

export function isSupported(name) {
  return SUPPORTED.includes(extOf(name));
}

// 去掉“非内容”的行：Word 操作提示、点线分隔、页码。
// 这些一旦入库，会被检索命中并当成知识引用（真实案例：docx 里的“右键更新域”提示被当成产品说明）。
function stripNoise(text) {
  return String(text || "")
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (/^提示\s*[:：]/.test(t) && /(更新域|页码|目录|空格|回车)/.test(t)) return false;
      if (/^[·.…\-—_=*~]{6,}$/.test(t)) return false;
      if (/^(第\s*)?\d+\s*(\/\s*\d+)?\s*页$/.test(t)) return false;
      if (/^(目\s*录|contents)$/i.test(t)) return false;
      return true;
    })
    .join("\n");
}

const tidy = (s) =>
  stripNoise(
    String(s || "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t\u00a0]+/g, " ")
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/* ---------------- 纯文本 / Markdown ---------------- */
async function fromText(filePath) {
  const raw = tidy(await readFile(filePath, "utf8"));
  const sections = [];
  let title = "";
  let buf = [];

  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) sections.push({ titlePath: title, text });
    buf = [];
  };

  raw.split("\n").forEach((line) => {
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      flush();
      title = h[2].trim();
      return;
    }
    buf.push(line);
  });
  flush();

  // 短节合并：每节太短会导致切片碎片化，失去上下文
  // 但问答型小节（标题是疑问句）不能合并 —— 合并后后面的问题会失去自己的标题，
  // 用户问“支持哪些模型”时就再也命中不到了。
  const isQuestion = (t) => /[？?]|吗|什么|怎么|哪些|如何|多少|区别|是否/.test(String(t || ""));
  const merged = [];
  let carry = null;
  for (const s of sections) {
    if (isQuestion(s.titlePath)) {
      if (carry) {
        merged.push(carry);
        carry = null;
      }
      merged.push(s);
      continue;
    }
    if (carry) {
      carry.text += `\n${s.text}`;
      if (carry.text.length >= 260) {
        merged.push(carry);
        carry = null;
      }
    } else if (s.text.length < 160) {
      carry = { titlePath: s.titlePath, text: s.text };
    } else {
      merged.push(s);
    }
  }
  if (carry) merged.push(carry);

  const list = merged.length ? merged : [{ titlePath: "", text: raw }];
  return list.map((s, i) => ({ page: i + 1, titlePath: s.titlePath, text: s.text }));
}

/* ---------------- Word ---------------- */
async function fromDocx(filePath) {
  const { value } = await mammoth.extractRawText({ path: filePath });
  const text = tidy(value);
  if (!text) return [];

  // 按段落聚合到目标长度：一段一片会产生上百个碎片，把真正有用的段落挤出 topK。
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim());
  const TARGET = 600;
  const pages = [];
  let buf = [];
  let len = 0;
  let startSeg = 1;

  const flush = () => {
    if (!buf.length) return;
    const segEnd = startSeg + buf.length - 1;
    pages.push({
      page: pages.length + 1,
      titlePath: `段落 ${startSeg}-${segEnd}`,
      text: buf.join("\n\n"),
    });
    buf = [];
    len = 0;
    startSeg = segEnd + 1;
  };

  for (const b of blocks) {
    if (len + b.length > TARGET && buf.length) flush();
    buf.push(b.trim());
    len += b.trim().length;
  }
  flush();

  return pages;
}

/* ---------------- Excel / CSV ---------------- */
async function fromSheet(filePath, ext) {
  // CSV 必须先按 UTF-8 读成字符串，否则中文会被当成单字节编码乱码
  let wb;
  if (ext === "csv") {
    const text = await readFile(filePath, "utf8");
    wb = XLSX.read(text, { type: "string" });
  } else {
    wb = XLSX.readFile(filePath, { cellDates: false });
  }
  const pages = [];
  wb.SheetNames.forEach((name, si) => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, raw: false });
    if (!rows.length) return;
    const header = (rows[0] || []).map((h) => String(h ?? "").trim());
    const lines = rows
      .slice(1)
      .map((r) =>
        r
          .map((cell, ci) => {
            const v = String(cell ?? "").trim();
            if (!v) return "";
            const key = header[ci] && header[ci] !== String(ci + 1) ? header[ci] : `列${ci + 1}`;
            return `${key}：${v}`;
          })
          .filter(Boolean)
          .join(" ｜ ")
      )
      .filter(Boolean);
    // 每 30 行一个片段，避免单片过大
    for (let i = 0; i < lines.length; i += 30) {
      pages.push({
        page: si + 1,
        titlePath: `工作表「${name}」第 ${i + 1}-${Math.min(i + 30, lines.length)} 行`,
        text: `${header.filter(Boolean).join(" ｜ ")}\n${lines.slice(i, i + 30).join("\n")}`,
      });
    }
  });
  return pages;
}

/* ---------------- PPTX ---------------- */
function collectText(node, out) {
  if (!node) return;
  if (typeof node === "string") return;
  if (Array.isArray(node)) {
    node.forEach((n) => collectText(n, out));
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === "a:t" || k.endsWith(":t")) {
      if (typeof v === "string" || typeof v === "number") out.push(String(v));
      else if (Array.isArray(v)) v.forEach((x) => typeof x === "string" && out.push(x));
    } else {
      collectText(v, out);
    }
  }
}

async function fromPptx(filePath) {
  const buf = await readFile(filePath);
  const zip = await JSZip.loadAsync(buf);
  const slideFiles = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));
  const parser = new XMLParser({ ignoreAttributes: true, preserveOrder: false, trimValues: true });

  const pages = [];
  for (const f of slideFiles) {
    const xml = await zip.files[f].async("string");
    const out = [];
    collectText(parser.parse(xml), out);
    const text = tidy(out.filter(Boolean).join("\n"));
    const idx = Number(f.match(/slide(\d+)\.xml/)[1]);
    if (text) pages.push({ page: idx, titlePath: `第 ${idx} 页`, text });
  }
  return pages;
}

/* ---------------- PDF ---------------- */
async function fromPdf(filePath) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const buf = await readFile(filePath);
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = tidy(
      content.items
        .map((it) => (it && typeof it.str === "string" ? it.str + (it.hasEOL ? "\n" : "") : ""))
        .join(" ")
    );
    if (text) pages.push({ page: i, titlePath: `第 ${i} 页`, text });
  }
  return pages;
}

/** 统一入口 */
export async function extract(filePath, name) {
  const ext = extOf(name);
  const started = Date.now();
  let pages = [];

  switch (ext) {
    case "jpg":
    case "jpeg":
    case "png":
    case "webp":
    case "gif":
      // 图片不做文本抽取，只作为图库资产（供智能体在正文里引用）
      return {
        pages: [],
        meta: { ext, pages: 0, chars: 0, ms: Date.now() - started, warning: "图片已存入图库，不参与切片", image: true },
      };
    case "txt":
    case "md":
      pages = await fromText(filePath);
      break;
    case "docx":
      pages = await fromDocx(filePath);
      break;
    case "xlsx":
    case "xls":
    case "csv":
      pages = await fromSheet(filePath, ext);
      break;
    case "pptx":
      pages = await fromPptx(filePath);
      break;
    case "pdf":
      pages = await fromPdf(filePath);
      break;
    default:
      throw new Error(`不支持的格式：.${ext}（支持 ${SUPPORTED.join(" / ")}）`);
  }

  const chars = pages.reduce((a, p) => a + p.text.length, 0);
  return {
    pages,
    meta: {
      ext,
      pages: pages.length,
      chars,
      ms: Date.now() - started,
      // 扫描版 PDF 常见：有页但没字
      warning: pages.length === 0 || chars < 50 ? "未抽取到有效文本（可能是扫描版或空文档）" : "",
    },
  };
}
