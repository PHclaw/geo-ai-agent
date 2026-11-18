import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Card, CardHead, Kpi, Note, cn, td, trHover } from "../components/ui";
import {
  downloadAnswersCsv,
  fetchAnswer,
  fetchAnswers,
  useApi,
  useSession,
  type AnswerQuery,
} from "../api";

const inputCls =
  "h-9 w-full rounded-lg border border-hair bg-[#fbfbfc] px-2.5 text-[12px] outline-none focus:border-accent/60 focus:bg-white focus:ring-3 focus:ring-accent/12";
const btnCls =
  "h-9 rounded-lg px-4 text-[12px] font-medium text-white bg-accent hover:bg-[#0077ed] disabled:cursor-not-allowed disabled:bg-accent/50";
const ghostCls =
  "h-9 rounded-lg border border-hair bg-white px-3 text-[12px] text-ink2 hover:bg-[#f6f6f7] disabled:cursor-not-allowed disabled:opacity-40";

const PLATFORM_LABEL: Record<string, string> = {
  deepseek: "DeepSeek",
  doubao: "豆包",
  kimi: "Kimi",
  qwen: "通义千问",
  wenxin: "文心一言",
  yuanbao: "腾讯元宝",
};
const platformLabel = (p: string) => PLATFORM_LABEL[p] || p || "—";

const CITE_META: Record<string, { text: string; tone: "ok" | "warn" | "info" | "default" }> = {
  active: { text: "可访问", tone: "ok" },
  broken: { text: "已失效", tone: "warn" },
  unknown: { text: "未巡检", tone: "info" },
  "not-in-ledger": { text: "台账未登记", tone: "default" },
};

export default function Answers() {
  const { brandId } = useSession();
  const [form, setForm] = useState<AnswerQuery>({ page: 1, size: 20 });
  const [applied, setApplied] = useState<AnswerQuery>({ page: 1, size: 20 });
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const listQ = useApi(brandId ? () => fetchAnswers(brandId, applied) : null, [brandId, JSON.stringify(applied)]);
  const detailQ = useApi(selected && brandId ? () => fetchAnswer(brandId, selected) : null, [selected, brandId]);

  const data = listQ.data;
  const detail = detailQ.data;

  function flash(m: string) {
    setToast(m);
    window.setTimeout(() => setToast(null), 3200);
  }

  function apply(next: Partial<AnswerQuery>) {
    const merged: AnswerQuery = { ...form, ...next };
    merged.page = next.page ?? 1;
    setForm(merged);
    setApplied(merged);
    setSelected(null);
  }

  function reset() {
    const empty: AnswerQuery = { page: 1, size: 20 };
    setForm(empty);
    setApplied(empty);
    setSelected(null);
  }

  async function exportCsv() {
    if (!brandId || busy) return;
    setBusy(true);
    try {
      await downloadAnswersCsv(brandId, applied);
      flash("已导出当前筛选结果（CSV）");
    } catch (e) {
      flash(e instanceof Error ? e.message : "导出失败");
    } finally {
      setBusy(false);
    }
  }

  const pageCited = (data?.items || []).filter((x) => x.cited).length;

  return (
    <div className="enter flex flex-col gap-3.5">
      <Note tone="info" title="这里看的是原始答案，不是汇总：">
        每条都保留 AI 回答原文、引用域名与采集时间。未配置模型 Key 时这些是确定性模拟样本（`mode=mock`），只用于验证链路；
        引用域名可以跳到链接台账，核对是否已登记、能否访问。
      </Note>

      <Card>
        <CardHead
          title="筛选"
          sub="平台 / 关键词 / 日期 / 是否被引用 可任意组合"
          right={
            <span className="text-[11px] text-ink3">
              共 {data?.total ?? "—"} 条 · {data?.pages ?? 1} 页
            </span>
          }
        />
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <label className="flex flex-col gap-1 text-[10.5px] text-ink3">
            轮次
            <select
              value={form.runId || ""}
              onChange={(e) => apply({ runId: e.target.value })}
              className={inputCls}
            >
              <option value="">最新一轮（{data?.runs?.[0]?.total ?? "—"} 条）</option>
              <option value="all">全部轮次</option>
              {(data?.runs || []).slice(1).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.startedAt.slice(5, 10)} · {r.total} 条
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[10.5px] text-ink3">
            平台
            <select value={form.platform || ""} onChange={(e) => apply({ platform: e.target.value })} className={inputCls}>
              <option value="">全部平台</option>
              {(data?.facets.platforms || []).map((p) => (
                <option key={p.platform} value={p.platform}>
                  {platformLabel(p.platform)}（{p.count}）
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[10.5px] text-ink3">
            关键词
            <input
              value={form.keyword || ""}
              onChange={(e) => setForm({ ...form, keyword: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") apply({ keyword: form.keyword || "" });
              }}
              placeholder="提问或答案包含…"
              className={inputCls}
            />
          </label>

          <label className="flex flex-col gap-1 text-[10.5px] text-ink3">
            开始日期
            <input
              type="date"
              value={form.from || ""}
              onChange={(e) => apply({ from: e.target.value })}
              className={inputCls}
            />
          </label>

          <label className="flex flex-col gap-1 text-[10.5px] text-ink3">
            结束日期
            <input
              type="date"
              value={form.to || ""}
              onChange={(e) => apply({ to: e.target.value })}
              className={inputCls}
            />
          </label>

          <label className="flex flex-col gap-1 text-[10.5px] text-ink3">
            引用状态
            <select value={form.cited ?? ""} onChange={(e) => apply({ cited: e.target.value })} className={inputCls}>
              <option value="">全部</option>
              <option value="1">已引用</option>
              <option value="0">未引用</option>
            </select>
          </label>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button onClick={() => apply({ page: 1 })} disabled={listQ.loading} className={btnCls}>
            {listQ.loading ? "查询中…" : "查询"}
          </button>
          <button onClick={reset} className={ghostCls}>
            重置
          </button>
          <button onClick={() => void exportCsv()} disabled={busy || !data?.total} className={ghostCls}>
            导出当前筛选 CSV
          </button>
          {listQ.error && <span className="text-[11px] text-[#c0392b]">{listQ.error}</span>}
        </div>
      </Card>

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="答案总数"
          value={data?.total ?? "—"}
          sub={`真实 ${data?.sources?.live ?? 0} · 模拟 ${data?.sources?.mock ?? 0}`}
        />
        <Kpi label="本页已引用" value={pageCited} sub={`本页 ${data?.items.length ?? 0} 条`} />
        <Kpi
          label="覆盖平台"
          value={data?.facets.platforms.length ?? "—"}
          sub={(data?.facets.platforms || []).map((p) => platformLabel(p.platform)).join(" / ") || "—"}
        />
        <Kpi label="当前页" value={data?.page ?? 1} sub={`共 ${data?.pages ?? 1} 页 · 每页 ${data?.size ?? 20}`} />
      </div>

      <Card flush>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-hair bg-[#fafafb] text-[10px] font-semibold tracking-[0.05em] text-ink3 uppercase">
                <th className="px-3.5 py-2.5">采集时间</th>
                <th className="px-3.5 py-2.5">平台</th>
                <th className="px-3.5 py-2.5">提问</th>
                <th className="px-3.5 py-2.5">答案摘要</th>
                <th className="px-3.5 py-2.5">引用</th>
                <th className="px-3.5 py-2.5">状态</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items || []).map((a) => (
                <tr key={a.id} className={cn(trHover, "cursor-pointer")} onClick={() => setSelected(a.id)}>
                  <td className={cn(td, "tnum whitespace-nowrap text-ink3")}>
                    {a.createdAt.slice(5, 16).replace("T", " ")}
                  </td>
                  <td className={td}>{platformLabel(a.platform)}</td>
                  <td className={cn(td, "max-w-[220px]")}>
                    <div className="truncate" title={a.promptText}>
                      {a.promptText || "—"}
                    </div>
                  </td>
                  <td className={cn(td, "max-w-[380px]")}>
                    <div className="truncate text-ink2" title={a.answer}>
                      {a.answer || "—"}
                    </div>
                  </td>
                  <td className={cn(td, "tnum")}>{a.citationCount}</td>
                  <td className={td}>
                    <div className="flex items-center gap-1.5">
                      <Badge tone={a.cited ? "ok" : "default"}>{a.cited ? "已引用" : "未引用"}</Badge>
                      <Badge tone={a.source === "live" ? "ok" : a.source === "error" ? "warn" : "info"}>
                        {a.source === "live" ? "真实" : a.source === "error" ? "失败" : a.source === "cend" ? "人工" : "模拟"}
                      </Badge>
                    </div>
                  </td>
                </tr>
              ))}
              {!data?.items.length && (
                <tr>
                  <td colSpan={6} className={cn(td, "py-8 text-center text-ink3")}>
                    {listQ.loading ? "加载中…" : "当前筛选没有记录"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-hair px-3.5 py-2.5">
          <div className="text-[11px] text-ink3">
            第 {data?.page ?? 1} / {data?.pages ?? 1} 页 · 共 {data?.total ?? 0} 条
          </div>
          <div className="flex gap-2">
            <button
              disabled={(data?.page ?? 1) <= 1 || listQ.loading}
              onClick={() => apply({ page: (data?.page ?? 1) - 1 })}
              className={ghostCls}
            >
              上一页
            </button>
            <button
              disabled={(data?.page ?? 1) >= (data?.pages ?? 1) || listQ.loading}
              onClick={() => apply({ page: (data?.page ?? 1) + 1 })}
              className={ghostCls}
            >
              下一页
            </button>
          </div>
        </div>
      </Card>

      {selected && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/25" onClick={() => setSelected(null)}>
          <div
            className="h-full w-full max-w-[600px] overflow-y-auto bg-white p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[13px] font-semibold text-ink">
                  {platformLabel(detail?.platform || "")} · 答案原文
                </div>
                <div className="mt-1 text-[10.5px] text-ink3">
                  {detail
                    ? `${detail.createdAt.slice(0, 16).replace("T", " ")} · ${detail.intent || "—"} · ${
                        detail.source === "live"
                          ? "真实采集"
                          : detail.source === "cend"
                            ? "人工取证"
                            : detail.source === "error"
                              ? "探测失败"
                              : "模拟样本"
                      }`
                    : "加载中…"}
                </div>
              </div>
              <button onClick={() => setSelected(null)} className={ghostCls}>
                关闭
              </button>
            </div>

            <div className="mt-3 text-[12px] text-ink2">
              <span className="text-ink3">提问：</span>
              {detail?.promptText || "—"}
            </div>

            <div className="mt-3 max-h-[46vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-hair bg-[#fbfbfc] p-3 text-[12px] leading-relaxed text-ink">
              {detail?.answer || "—"}
            </div>

            <div className="mt-4 text-[11px] font-semibold text-ink2">引用来源（{detail?.citations.length ?? 0}）</div>
            <div className="mt-2 flex flex-col gap-2">
              {(detail?.citations || []).map((c) => {
                const meta = CITE_META[c.status] || CITE_META.unknown;
                return (
                  <div key={c.host} className="rounded-xl border border-hair bg-white p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[12px] text-ink">{c.host}</div>
                        <div className="mt-0.5 text-[10px] text-ink3">
                          {c.inLedger ? c.url || "台账已登记" : "台账未登记"}
                          {c.checkedAt ? ` · 巡检 ${c.checkedAt.slice(0, 16).replace("T", " ")}` : ""}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge tone={meta.tone}>{meta.text}</Badge>
                        <Link
                          to={`/links?host=${encodeURIComponent(c.host)}`}
                          className="rounded-full border border-hair px-2.5 py-1 text-[10.5px] text-accent hover:bg-[#f7f9ff]"
                        >
                          查台账 →
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
              {!detail?.citations.length && <div className="text-[11px] text-ink3">这条答案没有引用任何来源。</div>}
            </div>

            <div className="mt-4 text-[10px] leading-relaxed text-ink3">
              引用域名来自采集结果原始字段；「台账未登记」表示该域名还没进链接资产，登记后即可做存活巡检。
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="pointer-events-none fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-[#1d1d1f] px-4 py-2.5 text-[12px] text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
