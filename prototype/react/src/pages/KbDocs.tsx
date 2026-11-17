import { useRef, useState } from "react";
import { Badge, Card, CardHead, Drawer, Note, cn, td, trHover } from "../components/ui";
import {
  deleteKbDoc,
  fetchKbChunks,
  fetchKbDocs,
  fetchKbStats,
  searchKb,
  uploadKbDoc,
  useApi,
  useSession,
  type KbChunk,
  type KbDoc,
  type KbHit,
} from "../api";

const ACCEPT = ".pdf,.docx,.xlsx,.xls,.csv,.pptx,.txt,.md,.jpg,.jpeg,.png,.webp,.gif";
const FORMAT_HINT = "PDF / Word(.docx) / Excel / CSV / PPT(.pptx) / TXT / Markdown / 图片(jpg/png/webp/gif)";

const STATUS: Record<string, { text: string; tone: "ok" | "warn" | "bad" | "default" | "info" }> = {
  ready: { text: "已索引", tone: "ok" },
  processing: { text: "处理中", tone: "warn" },
  empty: { text: "无文本", tone: "warn" },
  failed: { text: "解析失败", tone: "bad" },
  image: { text: "图片素材", tone: "info" },
};

const kb = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export default function KbDocs() {
  const { brandId, brand, loading: meLoading } = useSession();
  const { data: docs, loading, reload: reloadDocs } = useApi(brandId ? () => fetchKbDocs(brandId) : null, [brandId]);
  const { data: stats, reload: reloadStats } = useApi(brandId ? () => fetchKbStats(brandId) : null, [brandId]);

  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<KbHit[] | null>(null);
  const [meta, setMeta] = useState<{ matched: number; indexSize: number } | null>(null);
  const [detail, setDetail] = useState<{ doc: KbDoc; chunks: KbChunk[] } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const list = docs || [];
  const s = stats || { documents: 0, ready: 0, chars: 0, chunks: 0 };

  function flash(m: string) {
    setToast(m);
    window.setTimeout(() => setToast(null), 3200);
  }

  async function refresh() {
    await Promise.all([reloadDocs(), reloadStats()]);
  }

  async function handleFiles(files: FileList | null) {
    if (!files || !files.length || !brandId) return;
    setBusy(true);
    for (const f of Array.from(files)) {
      try {
        const out = await uploadKbDoc(brandId, f);
        flash(
          out.warning
            ? `${out.name}：${out.warning}`
            : `${out.name} 已入库：${out.pages} 页 / ${out.chunks} 个切片 / ${out.chars} 字（${out.ms}ms）`
        );
      } catch (e) {
        flash(e instanceof Error ? e.message : `${f.name} 上传失败`);
      }
    }
    setBusy(false);
    await refresh();
  }

  async function doSearch() {
    if (!brandId || !query.trim()) return flash("请输入要检索的问题");
    setSearching(true);
    try {
      const out = await searchKb(brandId, query.trim(), 8);
      setHits(out.hits);
      setMeta({ matched: out.matched, indexSize: out.indexSize });
      if (!out.hits.length) flash("没有命中片段：可能是切片太少，或问题与文档无关");
    } catch (e) {
      flash(e instanceof Error ? e.message : "检索失败");
    } finally {
      setSearching(false);
    }
  }

  async function openChunks(d: KbDoc) {
    try {
      const out = await fetchKbChunks(d.id);
      setDetail({ doc: out.document, chunks: out.chunks });
    } catch (e) {
      flash(e instanceof Error ? e.message : "读取切片失败");
    }
  }

  async function remove(d: KbDoc) {
    if (!window.confirm(`删除《${d.name}》及其 ${d.chunks} 个切片？已发布内容不受影响，但之后生成将无法检索到它`)) return;
    try {
      await deleteKbDoc(d.id);
      flash("已删除");
      await refresh();
    } catch (e) {
      flash(e instanceof Error ? e.message : "删除失败");
    }
  }

  if (meLoading || loading) {
    return <div className="grid place-items-center py-24 text-[12.5px] text-ink3">正在读取文档库…</div>;
  }

  return (
    <div className="enter flex flex-col gap-3.5">
      <Note tone="info" title="这一层是给 AI 用的：">
        上传的资料会被抽取、切片并建索引；生成内容时按问题检索出最相关的片段作为依据。与「事实卡」分工不同——事实卡管
        <b className="mx-1">数字口径不能错</b>
        ，文档管
        <b className="mx-1">有料可引</b>
        。
      </Note>

      {/* 概览 */}
      <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <Card className="p-4!">
          <div className="text-[10.5px] font-semibold tracking-[0.07em] text-ink3 uppercase">文档</div>
          <div className="tnum mt-1.5 text-[26px] leading-none font-semibold">
            {s.documents}
            <small className="ml-1 text-[11.5px] font-medium text-ink3">份 · 可用 {s.ready}</small>
          </div>
        </Card>
        <Card className="p-4!">
          <div className="text-[10.5px] font-semibold tracking-[0.07em] text-ink3 uppercase">可检索切片</div>
          <div className="tnum mt-1.5 text-[26px] leading-none font-semibold">
            {s.chunks}
            <small className="ml-1 text-[11.5px] font-medium text-ink3">个</small>
          </div>
        </Card>
        <Card className="p-4!">
          <div className="text-[10.5px] font-semibold tracking-[0.07em] text-ink3 uppercase">已索引字数</div>
          <div className="tnum mt-1.5 text-[26px] leading-none font-semibold">
            {kb(s.chars)}
            <small className="ml-1 text-[11.5px] font-medium text-ink3">字</small>
          </div>
        </Card>
      </section>

      {/* 上传 */}
      <Card>
        <CardHead title="上传资料" sub={`支持 ${FORMAT_HINT}；单文件 ≤ 20MB`} right={<Badge tone="info">{brand?.name || ""}</Badge>} />
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void handleFiles(e.dataTransfer.files);
          }}
          onClick={() => fileRef.current?.click()}
          className={cn(
            "mt-3 cursor-pointer rounded-xl border-2 border-dashed px-4 py-8 text-center transition-all duration-200",
            dragging ? "border-accent bg-accent/4" : "border-hair bg-[#fbfbfc] hover:border-accent/40 hover:bg-white"
          )}
        >
          <div className="text-[13px] font-medium">{busy ? "上传解析中…" : "把文件拖到这里，或点击选择"}</div>
          <div className="mt-1 text-[11px] text-ink3">上传后自动抽取文本 → 切片 → 建索引，通常几秒内完成</div>
          {busy && <div className="mt-2 text-[11px] text-accent">解析中，请稍候（大文件需要几秒）</div>}
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="mt-2.5 flex flex-wrap gap-3 text-[10.5px] text-ink3">
          <span>· 扫描版 PDF 抽不到文字（需要 OCR，暂不支持）</span>
          <span>· 老的 .ppt / .doc 请另存为 .pptx / .docx</span>
          <span>· 同内容文件会自动去重</span>
        </div>
      </Card>

      {/* 检索调试 */}
      <Card>
        <CardHead
          title="检索调试"
          sub="模拟生成时的检索：输入客户会问的问题，看能取到哪几段原文"
          right={
            meta && (
              <span className="text-[11.5px] text-ink3">
                命中 {meta.matched} 片 · 索引 {meta.indexSize} 片
              </span>
            )
          }
        />
        <div className="mt-3 flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void doSearch()}
            placeholder="例如：老房翻新大概多少钱 / 河西店电话是多少"
            className="h-10 flex-1 rounded-lg border border-hair bg-[#fbfbfc] px-3 text-[12.5px] outline-none focus:border-accent/60 focus:bg-white focus:ring-3 focus:ring-accent/12"
          />
          <button
            onClick={() => void doSearch()}
            disabled={searching}
            className={cn(
              "shrink-0 rounded-lg px-4 text-[12.5px] font-medium text-white",
              searching ? "bg-accent/60" : "bg-accent hover:bg-[#0077ed]"
            )}
          >
            {searching ? "检索中" : "检索"}
          </button>
        </div>

        {hits !== null && (
          <div className="mt-3 flex flex-col gap-2">
            {hits.map((h, i) => (
              <div key={h.chunkId} className="rounded-xl border border-hair2 bg-[#fafafb] px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-ink3">
                  <Badge tone="info">#{i + 1}</Badge>
                  <span className="font-medium text-ink2">{h.docName}</span>
                  <span>{h.titlePath || `第 ${h.page} 页`}</span>
                  <span className="ml-auto">
                    相关度 <b className="tnum text-ink">{h.score}</b> · {h.chars} 字
                  </span>
                </div>
                <div className="mt-1.5 line-clamp-3 text-[12px] leading-relaxed text-[#2b2b2e]">{h.text}</div>
              </div>
            ))}
            {!hits.length && <div className="py-6 text-center text-[12px] text-ink3">没有命中</div>}
          </div>
        )}
      </Card>

      {/* 文档列表 */}
      <Card flush>
        <div className="px-[18px] pt-[15px]">
          <CardHead
            title="文档库"
            sub="点「切片」可以看 AI 实际会读到什么（切片质量决定答案质量）"
            right={<Badge tone="info">{list.length} 份</Badge>}
          />
        </div>
        <div className="mt-3 w-full overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {["文件", "类型", "页/切片", "字数", "状态", "上传时间", ""].map((h) => (
                  <th
                    key={h}
                    className="border-y border-hair bg-[#fafafb]/70 px-3.5 py-2.5 text-left text-[10px] font-semibold tracking-[0.07em] whitespace-nowrap text-ink3 uppercase"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((d) => {
                const st = STATUS[d.status] || STATUS.processing;
                return (
                  <tr key={d.id} className={trHover}>
                    <td className={cn(td, "max-w-[280px] truncate font-medium text-ink")}>
                      {d.status === "image" ? (
                        <a href={`/api/kb/files/${d.id}`} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
                          {d.name}
                        </a>
                      ) : (
                        d.name
                      )}
                    </td>
                    <td className={cn(td, "uppercase")}>{d.ext}</td>
                    <td className={cn(td, "tnum")}>
                      {d.pages} / {d.chunks}
                    </td>
                    <td className={cn(td, "tnum")}>{kb(d.chars)}</td>
                    <td className={td}>
                      <Badge tone={st.tone}>{st.text}</Badge>
                      {d.error && <div className="mt-0.5 max-w-[220px] truncate text-[10px] text-[#9a4a00]">{d.error}</div>}
                    </td>
                    <td className={cn(td, "tnum")}>{new Date(d.createdAt).toLocaleString("zh-CN", { hour12: false })}</td>
                    <td className={cn(td, "text-right whitespace-nowrap")}>
                      <button onClick={() => void openChunks(d)} className="rounded-full border border-hair bg-white px-2.5 py-1 text-[11.5px] hover:bg-[#f6f6f7]">
                        切片
                      </button>
                      <button onClick={() => void remove(d)} className="ml-1.5 text-[11.5px] text-ink3 hover:text-bad">
                        删除
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!list.length && (
                <tr>
                  <td colSpan={7} className="px-3.5 py-12 text-center text-[12px] text-ink3">
                    还没有文档。把产品手册、报价单、门店清单、资质文件传上来，生成时才有依据可引。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 切片抽屉 */}
      <Drawer
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.doc.name || ""}
        sub={detail ? `${detail.chunks.length} 个切片 · 共 ${detail.doc.chars} 字` : ""}
        footer={
          <button onClick={() => setDetail(null)} className="rounded-full border border-hair bg-white px-3.5 py-1.5 text-[12.5px] hover:bg-[#f6f6f7]">
            关闭
          </button>
        }
      >
        {detail && (
          <div className="flex flex-col gap-2">
            {detail.chunks.map((c) => (
              <div key={c.id} className="rounded-xl border border-hair2 bg-[#fafafb] px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-ink3">
                  <Badge>#{c.seq}</Badge>
                  <span>{c.titlePath || `第 ${c.page} 页`}</span>
                  <span className="ml-auto">{c.chars} 字</span>
                </div>
                <div className="mt-1.5 text-[12px] leading-relaxed whitespace-pre-wrap text-[#2b2b2e]">{c.text}</div>
              </div>
            ))}
            {!detail.chunks.length && <div className="py-6 text-center text-[12px] text-ink3">没有切片</div>}
          </div>
        )}
      </Drawer>

      <div
        className={cn(
          "fixed bottom-6 left-1/2 z-[200] -translate-x-1/2 rounded-full bg-[rgba(28,28,30,0.94)] px-4 py-2.5 text-[12px] text-white backdrop-blur-md transition-all duration-400",
          toast ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3.5 opacity-0"
        )}
      >
        {toast}
      </div>
    </div>
  );
}
