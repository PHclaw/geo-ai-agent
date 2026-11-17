/* ============================================================
   Markdown → 单文件 HTML（公众号/门户可直接粘贴）
   - 内联样式，不依赖外部 CSS
   - 图片转 data URI 内联，保证单文件可分发
   ============================================================ */
import { readFile } from "node:fs/promises";

const esc = (s) =>
  String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function inline(text) {
  return esc(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#1d1d1f">$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em style="color:#86868b;font-style:normal;font-size:13px">$2</em>');
}

/**
 * @param resolveImage async (url) => dataUri | null
 */
export async function renderHtml({ title, brandName, body, resolveImage, flags = {} }) {
  const blocks = String(body || "").split(/\n{2,}/);
  const out = [];

  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;

    if (/^---+$/.test(block)) {
      out.push('<hr style="border:none;border-top:1px solid #e5e5e7;margin:24px 0" />');
      continue;
    }

    const img = block.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (img) {
      const uri = resolveImage ? await resolveImage(img[2]) : null;
      if (uri) {
        out.push(
          `<figure style="margin:22px 0;text-align:center">` +
            `<img src="${uri}" alt="${esc(img[1])}" style="width:100%;max-width:100%;border-radius:10px;border:1px solid #e5e5e7" />` +
            `<figcaption style="margin-top:8px;font-size:12px;color:#86868b;line-height:1.6">${esc(img[1])}</figcaption></figure>`
        );
      } else {
        out.push(`<p style="color:#86868b;font-size:13px">［图片：${esc(img[1])}］</p>`);
      }
      continue;
    }

    const h = block.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lv = h[1].length;
      const style =
        lv === 1
          ? "font-size:22px;font-weight:600;line-height:1.5;margin:0 0 20px;color:#1d1d1f"
          : lv === 2
            ? "font-size:18px;font-weight:600;line-height:1.6;margin:28px 0 12px;color:#1d1d1f"
            : "font-size:16px;font-weight:600;line-height:1.6;margin:22px 0 10px;color:#1d1d1f";
      out.push(`<h${lv === 1 ? 1 : 2} style="${style}">${inline(h[2])}</h${lv === 1 ? 1 : 2}>`);
      continue;
    }

    const lines = block.split("\n");

    // 表格
    const tableRows = lines.filter((l) => l.trim().startsWith("|"));
    if (tableRows.length >= 2 && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(tableRows[1])) {
      const cells = (row) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((s) => s.trim());
      const head = cells(tableRows[0]);
      const rows = tableRows.slice(2).map(cells);
      out.push(
        `<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">` +
          `<thead><tr>${head
            .map(
              (c) =>
                `<th style="border:1px solid #e5e5e7;background:#fafafb;padding:8px 10px;text-align:left;font-weight:600">${inline(c)}</th>`
            )
            .join("")}</tr></thead><tbody>${rows
            .map(
              (r) =>
                `<tr>${r
                  .map((c) => `<td style="border:1px solid #e5e5e7;padding:8px 10px;vertical-align:top">${inline(c)}</td>`)
                  .join("")}</tr>`
            )
            .join("")}</tbody></table>`
      );
      continue;
    }

    // 列表
    if (lines.every((l) => /^\s*([-*]|\d+[.、])\s+/.test(l))) {
      const ordered = /^\s*\d+[.、]\s+/.test(lines[0]);
      const items = lines.map((l) => `<li style="margin:6px 0">${inline(l.replace(/^\s*([-*]|\d+[.、])\s+/, ""))}</li>`);
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag} style="margin:12px 0;padding-left:22px;color:#2b2b2e">${items.join("")}</${tag}>`);
      continue;
    }

    out.push(
      `<p style="margin:14px 0;line-height:1.9">${lines.map((l) => inline(l)).join("<br />")}</p>`
    );
  }

  const warn =
    flags.complianceBlocked > 0
      ? `<div style="margin:0 0 18px;padding:10px 14px;border-radius:8px;background:#fff4e5;color:#8a4b00;font-size:13px;line-height:1.7">⚠ 这篇还有 ${flags.complianceBlocked} 处禁用词未修改，请勿直接对外发布。</div>`
      : "";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:32px 14px;background:#f5f5f7">
<section style="max-width:720px;margin:0 auto;background:#ffffff;border-radius:14px;padding:34px 30px;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;font-size:16px;line-height:1.9;color:#2b2b2e">
<div style="font-size:12px;color:#86868b;letter-spacing:0.04em;margin-bottom:14px">${esc(brandName || "")}</div>
${warn}
${out.join("\n")}
<div style="margin-top:30px;padding-top:14px;border-top:1px solid #e5e5e7;font-size:12px;color:#86868b;line-height:1.7">
数据来源：企业提供的事实卡与资料；实际以现场与合同为准。
</div>
</section>
</body>
</html>`;
}

/** 把站内图片地址解析成 data URI；png=true 时把 SVG 转 PNG（公众号不支持 SVG） */
export function makeImageResolver({ figuresDir, kbLookup, png = false }) {
  return async (url) => {
    try {
      if (url.startsWith("/api/figures/")) {
        const name = url.replace("/api/figures/", "");
        if (!/^[a-f0-9]{24}\.svg$/.test(name)) return null;
        const buf = await readFile(`${figuresDir}/${name}`);
        if (!png) return `data:image/svg+xml;base64,${buf.toString("base64")}`;
        const sharpMod = (await import("sharp")).default;
        const out = await sharpMod(buf, { density: 200 }).png().toBuffer();
        return `data:image/png;base64,${out.toString("base64")}`;
      }
      if (url.startsWith("/api/kb/files/")) {
        const id = url.replace("/api/kb/files/", "");
        const f = kbLookup ? kbLookup(id) : null;
        if (!f || !f.path) return null;
        const buf = await readFile(f.path);
        const mime = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
        const ct = mime[f.ext];
        if (!ct) return null;
        return `data:${ct};base64,${buf.toString("base64")}`;
      }
    } catch {
      return null;
    }
    return null;
  };
}
