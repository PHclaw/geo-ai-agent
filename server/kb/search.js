/* ============================================================
   检索：BM25 + 中文 bigram（零依赖、离线、可复现）
   - 中文按二元组切分，英文/数字按词
   - 每个品牌一个内存索引，文档变更时失效重建
   - P2 再接向量检索做混合排序（RRF 融合），本层接口不变
   ============================================================ */
import { db } from "../db.js";

const K1 = 1.5;
const B = 0.75;
/** 标题命中加权上限（+120%）：小标题往往就是答案本身 */
const TITLE_BOOST = 1.2;

const STOP = new Set([
  "的", "了", "和", "是", "在", "有", "我", "你", "他", "这", "那", "就", "都", "而", "及", "与",
  "请", "们", "一个", "什么", "怎么", "如何", "哪些", "哪个", "可以", "需要", "进行", "以及",
]);

const CJK = /[\u4e00-\u9fff]/;
const ALNUM = /[a-zA-Z0-9]/;

/** 中文 bigram + 英文/数字词 */
export function tokenize(text) {
  const s = String(text || "").toLowerCase();
  const tokens = [];
  let cjkRun = "";

  const flushCjk = () => {
    if (cjkRun.length === 1) tokens.push(cjkRun);
    for (let i = 0; i + 1 < cjkRun.length; i++) tokens.push(cjkRun.slice(i, i + 2));
    cjkRun = "";
  };

  let word = "";
  const flushWord = () => {
    if (word.length >= 2 && !STOP.has(word)) tokens.push(word);
    word = "";
  };

  for (const ch of s) {
    if (CJK.test(ch)) {
      flushWord();
      cjkRun += ch;
    } else if (ALNUM.test(ch)) {
      flushCjk();
      word += ch;
    } else {
      flushCjk();
      flushWord();
    }
  }
  flushCjk();
  flushWord();

  return tokens.filter((t) => !STOP.has(t));
}

/* ---------------- 索引 ---------------- */
const cache = new Map(); // brandId -> index

export function invalidate(brandId) {
  if (brandId) cache.delete(brandId);
  else cache.clear();
}

function build(brandId) {
  const rows = db
    .prepare("SELECT id, doc_id, page, title_path, text, chars FROM kb_chunks WHERE brand_id=?")
    .all(brandId);

  const postings = new Map(); // term -> Map(chunkId -> tf)
  const lengths = new Map();
  const docs = new Map();
  let totalLen = 0;

  for (const r of rows) {
    docs.set(r.id, r);
    const toks = tokenize(r.text);
    lengths.set(r.id, toks.length || 1);
    totalLen += toks.length || 1;

    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const [t, c] of tf) {
      if (!postings.has(t)) postings.set(t, new Map());
      postings.get(t).set(r.id, c);
    }
  }

  const index = {
    brandId,
    docs,
    postings,
    lengths,
    avgLen: rows.length ? totalLen / rows.length : 1,
    N: rows.length,
  };
  cache.set(brandId, index);
  return index;
}

export function getIndex(brandId) {
  return cache.get(brandId) || build(brandId);
}

/* ---------------- 检索 ---------------- */
export function search(brandId, query, { topK = 8, docIds = null, minScore = 0.1, perDoc = 3 } = {}) {
  const idx = getIndex(brandId);
  if (!idx.N) return { hits: [], total: 0, indexSize: 0 };

  const qTokens = [...new Set(tokenize(query))];
  if (!qTokens.length) return { hits: [], total: 0, indexSize: idx.N };

  const scores = new Map();
  for (const t of qTokens) {
    const posting = idx.postings.get(t);
    if (!posting) continue;
    const df = posting.size;
    const idf = Math.log(1 + (idx.N - df + 0.5) / (df + 0.5));
    for (const [chunkId, tf] of posting) {
      const len = idx.lengths.get(chunkId) || 1;
      const denom = tf + K1 * (1 - B + (B * len) / idx.avgLen);
      const s = idf * ((tf * (K1 + 1)) / denom);
      scores.set(chunkId, (scores.get(chunkId) || 0) + s);
    }
  }

  // 标题加权：小标题命中往往就是答案（如「#### 支持哪些大模型？」），
  // 纯 BM25 会把长文档里泛泛提到关键词的段落排到前面。
  const boosted = [];
  for (const [chunkId, base] of scores) {
    const d = idx.docs.get(chunkId);
    const titleToks = new Set(tokenize(d.title_path || ""));
    let boost = 0;
    if (titleToks.size) {
      const hit = qTokens.filter((t) => titleToks.has(t)).length;
      boost = TITLE_BOOST * (hit / qTokens.length);
    }
    boosted.push([chunkId, base * (1 + boost)]);
  }
  boosted.sort((a, b) => b[1] - a[1]);

  // 单一文档限流：长文档（如 1MB 的 docx）否则会占满整个 topK
  const perDocCount = new Map();
  const picked = [];
  for (const [chunkId, score] of boosted) {
    if (score < minScore) continue;
    const d = idx.docs.get(chunkId);
    if (!d) continue;
    if (docIds && !docIds.includes(d.doc_id)) continue;
    const used = perDocCount.get(d.doc_id) || 0;
    if (used >= perDoc) continue;
    perDocCount.set(d.doc_id, used + 1);
    picked.push([chunkId, score]);
    if (picked.length >= topK) break;
  }

  const hits = picked.map(([chunkId, score]) => {
    const d = idx.docs.get(chunkId);
    return {
      chunkId,
      docId: d.doc_id,
      page: d.page,
      titlePath: d.title_path,
      chars: d.chars,
      score: Math.round(score * 100) / 100,
      text: d.text,
    };
  });

  return { hits, total: scores.size, indexSize: idx.N };
}

/** 供生成链路调用：取 topK 段落拼成上下文，带出处标记 */
export function buildContext(brandId, query, topK = 6) {
  const { hits } = search(brandId, query, { topK });
  const docs = new Map();
  hits.forEach((h) => {
    if (!docs.has(h.docId)) {
      const r = db.prepare("SELECT name FROM kb_documents WHERE id=?").get(h.docId);
      docs.set(h.docId, r ? r.name : "未命名文档");
    }
    h.docName = docs.get(h.docId);
  });
  return {
    hits,
    context: hits
      .map((h, i) => `【片段 ${i + 1}｜${h.docName}｜${h.titlePath || `第 ${h.page} 页`}】\n${h.text}`)
      .join("\n\n"),
  };
}
