import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Bar, Card, CardHead, Drawer, Kpi, Meter, Note, cn, td, trHover } from "../components/ui";
import AgentPanel from "../components/AgentPanel";
import Markdown from "../components/Markdown";
import {
  fetchContents,
  fetchPrompts,
  fetchContent,
  generateContents,
  updateContentStatus,
  exportContentHtml,
  useApi,
  useSession,
  type GeneratedContent,
  type GeosDim,
} from "../api";

const GENRES = ["攻略", "问答", "对比", "清单", "本地"] as const;

const STATUS_META: Record<string, { text: string; tone: "ok" | "warn" | "default" }> = {
  draft: { text: "草稿", tone: "default" },
  review: { text: "待审核", tone: "warn" },
  published: { text: "已发布", tone: "ok" },
};

const selectCls =
  "h-8 w-full rounded-lg border border-hair bg-white px-2.5 text-[12.5px] text-ink outline-none focus:border-accent/60 focus:ring-3 focus:ring-accent/12";

export default function Content() {
  const { brandId, brand, loading: meLoading } = useSession();
  const { data: contents, loading, error, reload } = useApi(brandId ? () => fetchContents(brandId) : null, [brandId]);
  const { data: prompts } = useApi(brandId ? () => fetchPrompts(brandId) : null, [brandId]);

  const [genre, setGenre] = useState<string>("攻略");
  const [count, setCount] = useState<string>("3");
  const [targetPrompt, setTargetPrompt] = useState<string>("");
  const [filter, setFilter] = useState<"全部" | "待审核" | "已发布">("全部");
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<(GeneratedContent & { dims: GeosDim[] }) | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);

  const list = contents || [];
  const rows = useMemo(() => {
    if (filter === "全部") return list;
    if (filter === "待审核") return list.filter((c) => c.status === "review");
    return list.filter((c) => c.status === "published");
  }, [list, filter]);

  const kpi = useMemo(() => {
    const avg = list.length ? Math.round(list.reduce((a, c) => a + c.geos, 0) / list.length) : 0;
    return {
      total: list.length,
      avg,
      review: list.filter((c) => c.status === "review").length,
      published: list.filter((c) => c.status === "published").length,
      pass: list.filter((c) => c.geos >= 70).length,
    };
  }, [list]);

  const promptOptions = useMemo(() => (prompts || []).slice(0, 30), [prompts]);

  function flash(m: string) {
    setToast(m);
    window.setTimeout(() => setToast(null), 2600);
  }

  async function downloadHtml(format: "svg" | "png" = "svg") {
    if (!detail) return;
    try {
      const { blob, filename } = await exportContentHtml(detail.id, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      flash(format === "png" ? "已导出公众号版（图已转 PNG）" : "已导出 HTML（图片已内联）");
    } catch (e) {
      flash(e instanceof Error ? e.message : "导出失败");
    }
  }

  async function generate() {
    if (busy || !brandId) return;
    setBusy(true);
    try {
      const out = await generateContents(brandId, {
        genre,
        count: targetPrompt ? 1 : Number(count),
        promptId: targetPrompt || undefined,
      });
      flash(`已生成 ${out.count} 篇草稿，GEOS 均分 ${Math.round(out.items.reduce((a, i) => a + i.geos, 0) / out.items.length)}`);
      await reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "生成失败");
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(c: GeneratedContent) {
    setDetailLoading(true);
    setDetail({ ...c, dims: [] });
    try {
      const full = await fetchContent(c.id);
      setDetail(full);
    } catch {
      flash("加载详情失败");
    } finally {
      setDetailLoading(false);
    }
  }

  async function advance(c: GeneratedContent) {
    const next = c.status === "draft" ? "review" : c.status === "review" ? "published" : null;
    if (!next) return;
    try {
      await updateContentStatus(c.id, next);
      flash(next === "review" ? "已提交审核" : "已标记发布");
      await reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "操作失败");
    }
  }

  if (meLoading || (loading && !contents)) {
    return <div className="grid place-items-center py-24 text-[12.5px] text-ink3">正在读取内容…</div>;
  }

  if (error) {
    return (
      <Card>
        <CardHead title="加载失败" sub={error} />
      </Card>
    );
  }

  return (
    <div className="enter flex flex-col gap-3.5">
      <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="内容总数" value={String(kpi.total)} unit="篇" delta={`${brand?.name || ""}`} deltaTone="flat" sub="含草稿与已发布" />
        <Kpi label="GEOS 均分" value={String(kpi.avg)} unit="/100" delta={`${kpi.pass} 篇达标`} deltaTone={kpi.avg >= 70 ? "up" : "down"} sub="发布门槛 70" />
        <Kpi label="待审核" value={String(kpi.review)} unit="篇" delta="需人工确认" deltaTone="flat" sub="审核后才可发布" />
        <Kpi label="已发布" value={String(kpi.published)} unit="篇" delta="内容资产" deltaTone="flat" sub="可作为投放素材" />
      </section>

      <section className="grid gap-3.5 xl:grid-cols-[280px_minmax(0,1fr)]">
        {/* 生成配置 */}
        <div className="flex flex-col gap-3.5">
          <Card>
            <CardHead title="生成配置" right={<Badge tone="info">事实卡驱动</Badge>} />
            <div className="mt-3 flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">体裁</span>
                <select className={selectCls} value={genre} onChange={(e) => setGenre(e.target.value)}>
                  {GENRES.map((g) => (
                    <option key={g} value={g}>
                      {g === "攻略" ? "深度攻略" : g === "问答" ? "Q&A 问答" : g === "对比" ? "对比评测" : g === "清单" ? "价格清单" : "本地指南"}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">目标问题（可不选）</span>
                <select className={selectCls} value={targetPrompt} onChange={(e) => setTargetPrompt(e.target.value)}>
                  <option value="">自动挑选未覆盖问题</option>
                  {promptOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.text}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">数量</span>
                <select className={selectCls} value={count} onChange={(e) => setCount(e.target.value)} disabled={!!targetPrompt}>
                  <option value="1">1 篇</option>
                  <option value="3">3 篇</option>
                  <option value="5">5 篇</option>
                  <option value="10">10 篇</option>
                </select>
              </label>

              <div className="my-1 h-px bg-hair" />

              {[
                ["事实注入", "生成前读取生效中的事实卡"],
                ["GEOS 评分", "低于 70 会提示补强"],
                ["写入草稿", "生成后可直接提交审核"],
              ].map(([t, s]) => (
                <div key={t} className="flex items-start gap-2">
                  <span className="mt-0.5 grid h-[14px] w-[14px] shrink-0 place-items-center rounded-full bg-good/12 text-[8px] text-[#1a7a45]">
                    ✓
                  </span>
                  <div>
                    <div className="text-[11.5px] text-ink2">{t}</div>
                    <div className="text-[10px] text-ink3">{s}</div>
                  </div>
                </div>
              ))}

              <button
                onClick={generate}
                disabled={busy || !brandId}
                className={cn(
                  "mt-1 w-full rounded-full py-2.5 text-[12.5px] font-medium text-white transition-colors duration-200",
                  busy ? "cursor-wait bg-accent/60" : "bg-accent shadow-[0_4px_14px_rgba(0,113,227,0.24)] hover:bg-[#0077ed]"
                )}
              >
                {busy ? "生成中…" : targetPrompt ? "生成 1 篇" : `批量生成 ${count} 篇`}
              </button>
              <button
                onClick={() => setAgentOpen(true)}
                disabled={!brandId}
                className="w-full rounded-full border border-hair bg-white py-2.5 text-[12.5px] font-medium text-ink hover:bg-[#f6f6f7]"
              >
                智能体写作（流式）
              </button>
              <div className="text-center text-[10.5px] leading-relaxed text-ink3">
                上面是模板拼装（快、可离线）；智能体写作会读事实卡与文档原文成文，耗时更长
              </div>
            </div>
          </Card>

          <Card>
            <CardHead title="写作规范" sub="内置而非开关" />
            <div className="mt-2 flex flex-col gap-2 text-[11px] leading-relaxed text-ink3">
              <div>· 首段 80 字内出现品牌名与核心结论</div>
              <div>· 每 300 字至少 1 个带数字的事实句</div>
              <div>· Q&A 段落占比 ≥ 30%，便于 AI 抽取</div>
              <div>· 关键数据必须标注来源与时间</div>
            </div>
          </Card>
        </div>

        {/* 列表 */}
        <Card flush>
          <div className="px-[18px] pt-[15px]">
            <CardHead
              title="内容列表"
              sub="草稿 → 待审核 → 已发布；点行查看正文与 GEOS 六维"
              right={
                <div className="inline-flex gap-0.5 rounded-[9px] bg-[#ebebef] p-0.5">
                  {(["全部", "待审核", "已发布"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={cn(
                        "h-[26px] rounded-[7px] px-3 text-[11.5px]",
                        filter === f ? "bg-white font-medium text-black shadow-[0_1px_2px_rgba(0,0,0,0.09)]" : "text-[#5a5a5e]"
                      )}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              }
            />
          </div>

          <div className="mt-3 w-full overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {["标题", "体裁", "GEOS", "状态", "创建时间", ""].map((h) => (
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
                {rows.map((c) => {
                  const meta = STATUS_META[c.status] || STATUS_META.draft;
                  return (
                    <tr key={c.id} onClick={() => openDetail(c)} className={cn("cursor-pointer border-b border-hair2", trHover)}>
                      <td className={cn(td, "border-0 max-w-[360px] truncate font-medium text-ink")}>{c.title}</td>
                      <td className={cn(td, "border-0")}>
                        <Badge>{c.genre}</Badge>
                      </td>
                      <td className={cn(td, "border-0")}>
                        <span className="flex items-center gap-2">
                          <span className="w-10">
                            <Bar value={c.geos} thin tone={c.geos >= 85 ? "good" : c.geos >= 70 ? "accent" : "bad"} />
                          </span>
                          <span className="tnum font-semibold text-black">{c.geos}</span>
                        </span>
                      </td>
                      <td className={cn(td, "border-0")}>
                        <Badge tone={meta.tone}>{meta.text}</Badge>
                      </td>
                      <td className={cn(td, "tnum border-0")}>{new Date(c.createdAt).toLocaleDateString("zh-CN")}</td>
                      <td className={cn(td, "border-0 text-right")}>
                        {c.status !== "published" ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void advance(c);
                            }}
                            className="rounded-full border border-hair bg-white px-2.5 py-1 text-[11.5px] hover:bg-[#f6f6f7]"
                          >
                            {c.status === "draft" ? "提交审核" : "标记发布"}
                          </button>
                        ) : (
                          <span className="text-[11.5px] text-ink3">已完成</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!rows.length && (
                  <tr>
                    <td colSpan={6} className="px-3.5 py-12 text-center text-[12px] text-ink3">
                      还没有内容。在左侧选好体裁与数量，点「批量生成」即可。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2 border-t border-hair px-4 py-3 text-[11.5px] text-ink3">
            <span>
              共 {list.length} 篇 · 显示 {rows.length} 篇
            </span>
            <span className="ml-auto">内容写入 SQLite，刷新不丢</span>
          </div>
        </Card>
      </section>

      <Note tone="info" title="内容来源说明：">
        当前为模板生成（读取事实卡拼装 + 规则评分），确保离线可用；配置模型密钥后可切到 LLM 生成，评分逻辑不变。
        <Link to="/media" className="ml-1 underline">
          下一步去分发
        </Link>
      </Note>

      {/* 详情 */}
      <Drawer
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.title || ""}
        sub={detail ? `${detail.genre} · GEOS ${detail.geos} · ${STATUS_META[detail.status]?.text || detail.status}` : ""}
        footer={
          <>
            {detail && detail.status !== "published" && (
              <button
                onClick={() => {
                  void advance(detail);
                  setDetail(null);
                }}
                className="rounded-full bg-accent px-4 py-1.5 text-[12.5px] font-medium text-white hover:bg-[#0077ed]"
              >
                {detail.status === "draft" ? "提交审核" : "标记发布"}
              </button>
            )}
            <button onClick={() => setDetail(null)} className="rounded-full border border-hair bg-white px-3.5 py-1.5 text-[12.5px] hover:bg-[#f6f6f7]">
              关闭
            </button>
          </>
        }
      >
        {detail && (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge tone={detail.geos >= 70 ? "ok" : "bad"}>{detail.geos >= 70 ? "GEOS 达标" : "GEOS 未达标"}</Badge>
              <Badge>{detail.genre}</Badge>
              <Badge tone={STATUS_META[detail.status]?.tone || "default"}>{STATUS_META[detail.status]?.text}</Badge>
            </div>

            <div className="mt-3.5 max-h-[300px] overflow-y-auto rounded-xl border border-hair2 bg-[#fafafb] px-4 py-3.5">
              <Markdown text={detail.body} />
            </div>

            <div className="my-4 h-px bg-hair" />
            <div className="text-[11px] font-semibold tracking-[0.05em] text-ink3 uppercase">GEOS 评分构成</div>
            <div className="mt-2.5 flex flex-col gap-2.5">
              {detailLoading && <div className="text-[11.5px] text-ink3">正在计算…</div>}
              {detail.dims.map((d) => (
                <Meter
                  key={d.k}
                  label={d.k}
                  value={(d.v / d.max) * 100}
                  display={`${d.v}/${d.max}`}
                  tone={d.v / d.max >= 0.9 ? "good" : d.v / d.max >= 0.6 ? "accent" : "warn"}
                />
              ))}
            </div>

            <div className="mt-4">
              <Note tone="warn" title="发布前建议：">
                确认价格与门店信息与知识库一致；若事实卡有冲突，生成的内容不会引用该属性，需要补全后再重生成。
              </Note>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <button
                onClick={() => downloadHtml("svg")}
                className="rounded-full border border-hair bg-white px-3.5 py-2 text-[12px] font-medium hover:bg-[#f6f6f7]"
              >
                导出 HTML（站内）
              </button>
              <button
                onClick={() => downloadHtml("png")}
                className="rounded-full bg-ink px-3.5 py-2 text-[12px] font-medium text-white hover:bg-[#2b2b2e]"
              >
                导出公众号版
              </button>
              <span className="text-[10.5px] leading-relaxed text-ink3">
                单文件、图片已内联；公众号不支持 SVG，所以公众号版会把图转成 PNG
              </span>
            </div>
          </>
        )}
      </Drawer>

      <AgentPanel
        open={agentOpen}
        onClose={() => setAgentOpen(false)}
        onSaved={() => void reload()}
      />

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
