/* ============================================================
   切片：把页面文本切成 300–600 字的语义块，带出处与重叠
   目标不是"切得均匀"，而是"每片都能独立被引用"
   ============================================================ */

const SENT_RE = /[^。！？；\n]+[。！？；\n]?/g;

function splitSentences(text) {
  const out = String(text || "").match(SENT_RE) || [];
  return out.map((s) => s.trim()).filter(Boolean);
}

const charCount = (s) => String(s || "").replace(/\s/g, "").length;

/** 框线字符密集的块（README 里的 ASCII 架构图）对检索是噪声，直接丢弃 */
function isGraphicBlock(s) {
  const t = String(s || "");
  if (!t.length) return true;
  const box = (t.match(/[─│┌┐└┘├┤┬┴┼═║╔╗╚╝▶◀▲▼]/g) || []).length;
  return box / t.length > 0.08;
}

/**
 * @param pages [{ page, titlePath, text }]
 * @returns [{ seq, page, titlePath, text, chars }]
 */
export function chunkPages(pages, { size = 520, overlap = 90 } = {}) {
  const chunks = [];
  let seq = 0;

  for (const p of pages) {
    const sentences = splitSentences(p.text);
    if (!sentences.length) continue;

    let buf = [];
    let len = 0;

    const flush = () => {
      if (!buf.length) return;
      const text = buf.join("").trim();
      if (charCount(text) >= 20 && !isGraphicBlock(text)) {
        chunks.push({
          seq: seq++,
          page: p.page,
          titlePath: p.titlePath || "",
          text,
          chars: charCount(text),
        });
      }
    };

    for (const s of sentences) {
      if (len + s.length > size && buf.length) {
        flush();
        // 保留末尾若干句作为重叠，避免答案被切断在边界
        const tail = [];
        let tailLen = 0;
        for (let i = buf.length - 1; i >= 0 && tailLen < overlap; i--) {
          tail.unshift(buf[i]);
          tailLen += buf[i].length;
        }
        buf = tail;
        len = tailLen;
      }
      buf.push(s);
      len += s.length;
    }
    flush();
  }

  return chunks;
}
