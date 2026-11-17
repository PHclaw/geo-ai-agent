import { useState } from "react";
import { Badge, Bar, Card, CardHead, Kpi, Note, cn } from "../components/ui";
import {
  claimOrder,
  fetchOpsOrders,
  fetchOpsStats,
  publishPlacement,
  rejectPlacement,
  useApi,
  type OpsOrder,
} from "../api";

const FILTERS = ["待接单", "进行中", "已发布", "全部"] as const;
const STATUS_MAP: Record<string, string> = { pending: "待接单", claimed: "进行中", published: "已发布", cancelled: "已取消" };
const STATUS_TONE: Record<string, "ok" | "warn" | "bad" | "info" | "default"> = {
  pending: "warn",
  claimed: "info",
  published: "ok",
  cancelled: "default",
};

const money = (n: number) => "¥" + n.toLocaleString("zh-CN");

export default function Ops() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("待接单");
  const [inputs, setInputs] = useState<Record<string, { url: string; date: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const { data: stats, reload: reloadStats } = useApi(() => fetchOpsStats(), []);
  const { data: orders, loading, reload: reloadOrders } = useApi(
    () => fetchOpsOrders(filter === "全部" ? "all" : filter === "进行中" ? "claimed" : filter === "已发布" ? "published" : "pending"),
    [filter]
  );

  function flash(m: string) {
    setToast(m);
    window.setTimeout(() => setToast(null), 2800);
  }

  async function refresh() {
    await Promise.all([reloadOrders(), reloadStats()]);
  }

  async function doClaim(o: OpsOrder) {
    setBusy(o.id);
    try {
      const r = await claimOrder(o.id);
      flash(`已接单，负责人：${r.assignee}`);
      await refresh();
    } catch (e) {
      flash(e instanceof Error ? e.message : "接单失败");
    } finally {
      setBusy(null);
    }
  }

  async function doPublish(orderId: string, placementId: string) {
    const v = inputs[placementId] || { url: "", date: "" };
    if (!v.url.trim()) {
      flash("请先填写发布链接");
      return;
    }
    setBusy(placementId);
    try {
      const r = await publishPlacement(placementId, { url: v.url.trim(), publishedAt: v.date || undefined });
      flash(r.remaining === 0 ? "该订单全部回填完成，已转为已发布" : `已回填，还剩 ${r.remaining} 条`);
      setInputs((prev) => ({ ...prev, [placementId]: { url: "", date: "" } }));
      await refresh();
    } catch (e) {
      flash(e instanceof Error ? e.message : "回填失败");
    } finally {
      setBusy(null);
    }
  }

  async function doReject(placementId: string) {
    const note = window.prompt("填写退回原因（媒体会据此调整）", "媒体排期已满，改投同城其他门户");
    if (note === null) return;
    setBusy(placementId);
    try {
      await rejectPlacement(placementId, note || "媒体退回");
      flash("已标记退回");
      await refresh();
    } catch (e) {
      flash(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(null);
    }
  }

  const list = orders || [];
  const s = stats || { pending: 0, claimed: 0, publishedToday: 0, amount: 0, clients: 0 };

  return (
    <div className="enter flex flex-col gap-3.5">
      <Note tone="info" title="这是内部运营台（人工代投）：">
        客户下单后进入「待接单」，运营接单后逐条回填真实发布链接；全部回填完毕，订单自动转为「已发布」，客户在媒体分发页即可看到链接。
      </Note>

      <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="待接单" value={String(s.pending)} unit="单" delta="需尽快认领" deltaTone={s.pending > 0 ? "down" : "flat"} sub="客户已付款待执行" />
        <Kpi label="进行中" value={String(s.claimed)} unit="单" delta="已接单" deltaTone="flat" sub="等待回填链接" />
        <Kpi label="今日已发布" value={String(s.publishedToday)} unit="条" delta="台账已完成" deltaTone="up" sub="媒体实际出稿" />
        <Kpi label="累计代投金额" value={money(s.amount).replace("¥", "")} unit="元" delta={`${s.clients} 个客户`} deltaTone="flat" sub="不含已取消" />
      </section>

      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "h-[27px] rounded-full border px-3 text-[11.5px] transition-all duration-200",
              filter === f ? "border-ink bg-ink text-white" : "border-hair bg-white text-[#3a3a3c] hover:bg-[#f7f7f8]"
            )}
          >
            {f}
            {f === "待接单" && s.pending > 0 && <span className="ml-1 opacity-70">{s.pending}</span>}
          </button>
        ))}
        <button
          onClick={() => void refresh()}
          className="ml-auto rounded-full border border-hair bg-white px-3 py-1 text-[11.5px] hover:bg-[#f6f6f7]"
        >
          刷新
        </button>
      </div>

      {loading && <div className="grid place-items-center py-16 text-[12.5px] text-ink3">读取订单中…</div>}

      {!loading && !list.length && (
        <Card>
          <CardHead title="暂无订单" sub={filter === "待接单" ? "客户下单后会出现在这里" : "换个筛选条件看看"} />
        </Card>
      )}

      {list.map((o) => {
        const left = o.totalCount - o.doneCount;
        return (
          <Card key={o.id} flush>
            <div className="flex flex-wrap items-start gap-3 border-b border-hair px-[18px] pt-[15px] pb-3">
              <div className="min-w-[200px]">
                <div className="flex items-center gap-2">
                  <b className="text-[13.5px] font-semibold">{o.brand.name}</b>
                  <Badge tone={STATUS_TONE[o.status] || "default"}>{STATUS_MAP[o.status] || o.status}</Badge>
                  {o.assignee && <span className="text-[11px] text-ink3">负责人 {o.assignee}</span>}
                </div>
                <div className="mt-1 text-[11px] text-ink3">
                  {o.brand.city} · 客户 {o.ownerPhone || "—"} · {new Date(o.createdAt).toLocaleString("zh-CN", { hour12: false })}
                </div>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-3">
                <div className="text-right">
                  <div className="text-[11px] text-ink3">订单金额</div>
                  <div className="tnum text-[15px] font-semibold">{money(o.total)}</div>
                </div>
                <div className="w-[110px]">
                  <div className="mb-1 flex justify-between text-[10.5px] text-ink3">
                    <span>回填进度</span>
                    <span>
                      {o.doneCount}/{o.totalCount}
                    </span>
                  </div>
                  <Bar value={o.totalCount ? (o.doneCount / o.totalCount) * 100 : 0} thin tone={left === 0 ? "good" : "accent"} />
                </div>
                {o.status === "pending" && (
                  <button
                    onClick={() => void doClaim(o)}
                    disabled={busy === o.id}
                    className={cn(
                      "rounded-full px-4 py-1.5 text-[12px] font-medium text-white",
                      busy === o.id ? "bg-accent/60" : "bg-accent hover:bg-[#0077ed]"
                    )}
                  >
                    {busy === o.id ? "接单中…" : "接单"}
                  </button>
                )}
              </div>
            </div>

            <div className="grid gap-0 px-[18px] py-3">
              {o.placements.map((p) => {
                const v = inputs[p.id] || { url: "", date: "" };
                const done = p.state === "已完成";
                return (
                  <div key={p.id} className="flex flex-wrap items-center gap-2.5 border-b border-hair2 py-2.5 last:border-0">
                    <div className="min-w-[180px] flex-1">
                      <div className="text-[12.5px] font-medium">{p.media}</div>
                      <div className="truncate text-[10.5px] text-ink3">{p.content}</div>
                    </div>

                    {done ? (
                      <>
                        <Badge tone="ok">已发布</Badge>
                        <span className="text-[10.5px] text-ink3">{p.publishedAt}</span>
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noreferrer"
                          className="max-w-[240px] truncate rounded-full border border-hair bg-white px-2.5 py-1 text-[11px] text-accent hover:bg-[#f6f6f7]"
                        >
                          {p.url}
                        </a>
                      </>
                    ) : p.state === "被退回" ? (
                      <>
                        <Badge tone="bad">被退回</Badge>
                        <span className="text-[10.5px] text-ink3">{p.note}</span>
                      </>
                    ) : (
                      <>
                        <input
                          value={v.url}
                          onChange={(e) => setInputs((prev) => ({ ...prev, [p.id]: { ...v, url: e.target.value } }))}
                          placeholder="粘贴发布链接 https://..."
                          className="h-8 min-w-[240px] flex-1 rounded-lg border border-hair bg-[#fbfbfc] px-2.5 text-[11.5px] outline-none focus:border-accent/60 focus:bg-white"
                        />
                        <input
                          type="date"
                          value={v.date}
                          onChange={(e) => setInputs((prev) => ({ ...prev, [p.id]: { ...v, date: e.target.value } }))}
                          className="h-8 rounded-lg border border-hair bg-[#fbfbfc] px-2 text-[11.5px] outline-none"
                        />
                        <button
                          onClick={() => void doPublish(o.id, p.id)}
                          disabled={busy === p.id}
                          className={cn(
                            "rounded-full px-2.5 py-1 text-[11.5px] font-medium text-white",
                            busy === p.id ? "bg-accent/60" : "bg-accent hover:bg-[#0077ed]"
                          )}
                        >
                          {busy === p.id ? "保存中…" : "回填链接"}
                        </button>
                        <button
                          onClick={() => void doReject(p.id)}
                          className="rounded-full border border-hair bg-white px-2.5 py-1 text-[11.5px] text-ink2 hover:bg-[#f6f6f7]"
                        >
                          退回
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
              {!o.placements.length && <div className="py-3 text-[11.5px] text-ink3">该订单没有台账项</div>}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-hair px-4 py-2.5 text-[10.5px] text-ink3">
              <span>订单号 {o.id.slice(0, 8)}</span>
              <span>·</span>
              <span>目标 {o.objective}</span>
              <span>·</span>
              <span>媒体 {o.media.length} 家</span>
              {left > 0 && <span className="text-[#9a4a00]">· 还有 {left} 条待回填</span>}
              {o.note && <span className="text-[#a40010]">· 备注：{o.note}</span>}
            </div>
          </Card>
        );
      })}

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
