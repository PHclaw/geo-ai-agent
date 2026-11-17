import { useMemo, useState } from "react";
import { Badge, Bar, Card, CardHead, Drawer, Kpi, Note, Table, cn, td, trHover } from "../components/ui";
import {
  cancelOrder,
  createOrder,
  fetchMediaList,
  fetchOrders,
  fetchPlacements,
  useApi,
  useSession,
  type MediaItem,
  type Order,
} from "../api";

const ORDER_STATUS: Record<string, { text: string; tone: "ok" | "warn" | "info" | "default" }> = {
  pending: { text: "待接单", tone: "warn" },
  claimed: { text: "代投中", tone: "info" },
  published: { text: "已发布", tone: "ok" },
  cancelled: { text: "已取消", tone: "default" },
};

const TYPE_TONE: Record<string, "default" | "ok" | "info" | "purple"> = {
  地方官媒: "default",
  央媒: "ok",
  "行业大 V": "purple",
  本地生活: "info",
};

const TYPES = ["全部", "地方官媒", "央媒", "行业大 V", "本地生活"] as const;
const OBJECTIVES = ["提升可见度", "抢占本地", "压制负面"] as const;

const money = (n: number) => "¥" + n.toLocaleString("zh-CN");

export default function Media() {
  const { brandId, brand, loading: meLoading } = useSession();
  const { data: media, loading: mediaLoading, error: mediaError } = useApi(() => fetchMediaList(), []);
  const { data: orders, reload: reloadOrders } = useApi(brandId ? () => fetchOrders(brandId) : null, [brandId]);
  const { data: placements, reload: reloadPlacements } = useApi(
    brandId ? () => fetchPlacements(brandId) : null,
    [brandId]
  );

  const [type, setType] = useState<(typeof TYPES)[number]>("全部");
  const [minAiw, setMinAiw] = useState(true);
  const [obj, setObj] = useState<(typeof OBJECTIVES)[number]>("提升可见度");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<Order | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const list = media || [];
  const rows = useMemo(
    () => list.filter((m) => (type === "全部" || m.type === type) && (!minAiw || m.aiw >= 60)),
    [list, type, minAiw]
  );

  const selected = useMemo(() => list.filter((m) => picked.includes(m.id)), [list, picked]);
  const sum = selected.reduce((a, m) => a + m.price, 0);
  const avgAiw = selected.length ? Math.round(selected.reduce((a, m) => a + m.aiw, 0) / selected.length) : 0;

  const stats = useMemo(() => {
    const os = orders || [];
    return {
      total: os.length,
      pending: os.filter((o) => o.status === "pending").length,
      amount: os.reduce((a, o) => a + o.total, 0),
      highAiw: list.filter((m) => m.aiw >= 80).length,
      placed: (placements || []).filter((p) => p.state === "已完成").length,
    };
  }, [orders, placements, list]);

  function flash(m: string) {
    setToast(m);
    window.setTimeout(() => setToast(null), 2800);
  }

  function toggle(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit() {
    if (!brandId) return;
    if (!selected.length) {
      flash("请先选择至少一家媒体");
      return;
    }
    setBusy(true);
    try {
      const out = await createOrder(brandId, selected.map((m) => m.id), obj);
      flash(`已生成订单 ${money(out.total)}（${out.count} 家 · AIW 均值 ${out.avgAiw}）`);
      setPicked([]);
      await Promise.all([reloadOrders(), reloadPlacements()]);
    } catch (e) {
      flash(e instanceof Error ? e.message : "下单失败");
    } finally {
      setBusy(false);
    }
  }

  async function markCancelled(orderId: string) {
    if (!window.confirm("确认取消该订单？取消后需要重新下单")) return;
    try {
      await cancelOrder(orderId);
      flash("订单已取消");
      await Promise.all([reloadOrders(), reloadPlacements()]);
    } catch (e) {
      flash(e instanceof Error ? e.message : "取消失败");
    }
  }

  if (meLoading || mediaLoading) {
    return <div className="grid place-items-center py-24 text-[12.5px] text-ink3">正在读取媒体库…</div>;
  }

  if (mediaError) {
    return (
      <Card>
        <CardHead title="加载失败" sub={mediaError} />
      </Card>
    );
  }

  return (
    <div className="enter flex flex-col gap-3.5">
      <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="可用媒体" value={String(list.length)} unit="家" delta={`高权重 ${stats.highAiw} 家`} deltaTone="flat" sub="AIW ≥ 80" />
        <Kpi label="投放订单" value={String(stats.total)} unit="单" delta={`待发布 ${stats.pending}`} deltaTone={stats.pending ? "down" : "flat"} sub={`${brand?.name || ""}`} />
        <Kpi label="累计投放金额" value={money(stats.amount).replace("¥", "")} unit="元" delta="含撰改与发布" deltaTone="flat" sub="打包价" />
        <Kpi label="已完成投放" value={String(stats.placed)} unit="条" delta="台账记录" deltaTone="flat" sub="含历史数据" />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] text-ink3">投放目标</span>
        <div className="inline-flex gap-0.5 rounded-[9px] bg-[#ebebef] p-0.5">
          {OBJECTIVES.map((o) => (
            <button
              key={o}
              onClick={() => setObj(o)}
              className={cn(
                "h-[26px] rounded-[7px] px-3 text-[11.5px]",
                obj === o ? "bg-white font-medium text-black shadow-[0_1px_2px_rgba(0,0,0,0.09)]" : "text-[#5a5a5e]"
              )}
            >
              {o}
            </button>
          ))}
        </div>
        <Badge tone="info">按 AIW 排序</Badge>
        <span className="ml-auto text-[11.5px] text-ink3">
          当前匹配 {rows.length} 家 · 已选 {selected.length} 家
        </span>
      </div>

      <section className="grid gap-3.5 xl:grid-cols-[240px_minmax(0,1fr)]">
        {/* 筛选 */}
        <div className="flex flex-col gap-3.5">
          <Card>
            <CardHead title="筛选" />
            <div className="mt-3">
              <div className="mb-1.5 text-[11px] text-ink3">类型</div>
              <div className="flex flex-wrap gap-1.5">
                {TYPES.map((t) => (
                  <button
                    key={t}
                    onClick={() => setType(t)}
                    className={cn(
                      "h-[27px] rounded-full border px-2.5 text-[11.5px] transition-all duration-200",
                      type === t ? "border-ink bg-ink text-white" : "border-hair bg-white text-[#3a3a3c] hover:bg-[#f7f7f8]"
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <div className="mt-3.5 mb-1.5 text-[11px] text-ink3">AIW 阈值</div>
              <div className="flex gap-1.5">
                {[false, true].map((v) => (
                  <button
                    key={String(v)}
                    onClick={() => setMinAiw(v)}
                    className={cn(
                      "h-[27px] rounded-full border px-2.5 text-[11.5px]",
                      minAiw === v ? "border-ink bg-ink text-white" : "border-hair bg-white text-[#3a3a3c]"
                    )}
                  >
                    {v ? "≥ 60" : "全部"}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <CardHead title="AIW 是什么" />
            <div className="mt-2.5 text-[11.5px] leading-relaxed text-ink3">
              基于全平台探测统计域名被 AI 引用的频次与「是否作为主要来源」，归一化为 0–100。分数越高，发在这里越容易被引用。
            </div>
            <div className="my-3 h-px bg-hair" />
            {[
              ["样本量", "≥ 30 次"],
              ["更新频率", "每周"],
              ["选媒依据", "AIW × 地域 ÷ 价格"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between py-1">
                <span className="text-[11.5px] text-ink2">{k}</span>
                <span className="text-[11px] text-ink3">{v}</span>
              </div>
            ))}
          </Card>
        </div>

        {/* 媒体表 + 方案 */}
        <div className="flex flex-col gap-3.5">
          <Card flush>
            <div className="px-[18px] pt-[15px]">
              <CardHead
                title="推荐媒体"
                sub="按 AIW 从高到低；点「加入」组包，右侧实时算预算"
                right={<Badge tone="ok" dot>{rows.length} 家匹配</Badge>}
              />
            </div>

            <div className="mt-3 w-full overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    {["媒体", "类型", "AIW", "出稿", "价格", ""].map((h) => (
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
                  {rows.map((m) => {
                    const on = picked.includes(m.id);
                    return (
                      <tr key={m.id} className={cn("border-b border-hair2", on ? "bg-accent/4" : trHover)}>
                        <td className={cn(td, "border-0 font-medium text-ink")}>
                          {m.name}
                          {m.covered && <Badge tone="info" className="ml-1.5">竞品已覆盖</Badge>}
                          {m.note && <Badge tone="warn" className="ml-1.5">{m.note}</Badge>}
                        </td>
                        <td className={cn(td, "border-0")}>
                          <Badge tone={TYPE_TONE[m.type] || "default"}>{m.type}</Badge>
                        </td>
                        <td className={cn(td, "border-0")}>
                          <span className="flex items-center gap-2">
                            <span className="w-10">
                              <Bar value={m.aiw} thin />
                            </span>
                            <span className="tnum font-semibold text-black">{m.aiw}</span>
                          </span>
                        </td>
                        <td className={cn(td, "border-0")}>{m.cycle}</td>
                        <td className={cn(td, "border-0 font-semibold text-black")}>{money(m.price)}</td>
                        <td className={cn(td, "border-0 text-right")}>
                          <button
                            onClick={() => toggle(m.id)}
                            className={cn(
                              "rounded-full px-2.5 py-1 text-[11.5px] transition-all duration-200",
                              on ? "bg-accent font-medium text-white hover:bg-[#0077ed]" : "border border-hair bg-white hover:bg-[#f6f6f7]"
                            )}
                          >
                            {on ? "已加入" : "加入"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!rows.length && (
                    <tr>
                      <td colSpan={6} className="px-3.5 py-10 text-center text-[12px] text-ink3">
                        当前筛选下没有媒体，试试放宽 AIW 阈值
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-2 border-t border-hair px-4 py-3 text-[11.5px] text-ink3">
              <span>共 {list.length} 家 · 显示 {rows.length} 家</span>
              <span className="ml-auto">价格为含撰改与发布的打包价</span>
            </div>
          </Card>

          <Card>
            <CardHead title="投放方案" sub={`目标：${obj}`} right={<Badge tone="info">脉冲式</Badge>} />
            <div className="mt-3">
              {!selected.length ? (
                <div className="rounded-lg border border-dashed border-hair px-3 py-6 text-center text-[11.5px] text-ink3">
                  尚未选择媒体，点击上方「加入」开始组包
                </div>
              ) : (
                selected.map((m: MediaItem) => (
                  <div key={m.id} className="flex items-center gap-3 border-b border-hair2 py-2 last:border-0">
                    <span className="grid h-[24px] w-[24px] shrink-0 place-items-center rounded-lg bg-accent/10 text-[9.5px] font-semibold text-[#0066cc]">
                      媒
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-medium">{m.name}</div>
                      <div className="text-[10.5px] text-ink3">
                        AIW {m.aiw} · {money(m.price)}
                      </div>
                    </div>
                    <button onClick={() => toggle(m.id)} className="shrink-0 text-[11.5px] text-accent">
                      移除
                    </button>
                  </div>
                ))
              )}

              <div className="my-3 h-px bg-hair" />
              <div className="flex items-center justify-between text-[11.5px] text-ink3">
                <span>已选媒体</span>
                <span className="tnum font-semibold text-ink">{selected.length} 家</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-ink3">
                <span>覆盖 AIW 均值</span>
                <span className="tnum font-semibold text-ink">{selected.length ? avgAiw : "—"}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-ink3">
                <span>预算合计</span>
                <span className="tnum text-[16px] font-semibold text-ink">{money(sum)}</span>
              </div>

              {!!selected.length && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <Badge tone="ok">预计收录 92%</Badge>
                  <Badge tone="info">预计引用 +{Math.max(2, Math.round(selected.length * 0.4))}~{Math.round(selected.length * 0.6) + 2} 次</Badge>
                </div>
              )}

              <button
                onClick={submit}
                disabled={busy}
                className={cn(
                  "mt-3 w-full rounded-full py-2.5 text-[12.5px] font-medium transition-colors duration-200",
                  !selected.length
                    ? "bg-[#f1f1f3] text-ink3"
                    : busy
                      ? "cursor-wait bg-accent/60 text-white"
                      : "bg-accent text-white shadow-[0_4px_14px_rgba(0,113,227,0.24)] hover:bg-[#0077ed]"
                )}
              >
                {busy ? "提交中…" : "提交订单"}
              </button>
              <div className="mt-1.5 text-center text-[10.5px] text-ink3">订单写入数据库，可在台账查看</div>
            </div>
          </Card>
        </div>
      </section>

      {/* 订单 */}
      <Card flush>
        <div className="px-[18px] pt-[15px]">
          <CardHead title="投放订单" sub="提交后生成发布台账，标记完成会同步更新" right={<Badge tone="info">{stats.total} 单</Badge>} />
        </div>
        <div className="mt-2.5 w-full overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {["订单号", "目标", "媒体组合", "金额", "状态", "回填进度", ""].map((h) => (
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
              {(orders || []).map((o) => {
                const st = ORDER_STATUS[o.status] || ORDER_STATUS.pending;
                const done = o.placements.filter((p) => p.state === "已完成").length;
                return (
                  <tr key={o.id} className={trHover}>
                    <td className={cn(td, "border-0 font-mono text-[11px]")}>{o.id.slice(0, 8)}</td>
                    <td className={cn(td, "border-0")}>{o.objective}</td>
                    <td className={cn(td, "border-0 max-w-[240px] truncate")}>
                      {o.media.map((m) => m.name).join("、") || "—"}
                    </td>
                    <td className={cn(td, "tnum border-0 font-semibold text-black")}>{money(o.total)}</td>
                    <td className={cn(td, "border-0")}>
                      <Badge tone={st.tone}>{st.text}</Badge>
                      {o.assignee && <div className="mt-0.5 text-[10px] text-ink3">{o.assignee}</div>}
                    </td>
                    <td className={cn(td, "border-0")}>
                      <div className="flex items-center gap-1.5">
                        <span className="w-12">
                          <Bar value={o.placements.length ? (done / o.placements.length) * 100 : 0} thin tone={done === o.placements.length && done > 0 ? "good" : "accent"} />
                        </span>
                        <span className="tnum text-[11px] text-ink2">
                          {done}/{o.placements.length}
                        </span>
                      </div>
                    </td>
                    <td className={cn(td, "border-0 text-right")}>
                      <button
                        onClick={() => setDetail(o)}
                        className="rounded-full border border-hair bg-white px-2.5 py-1 text-[11.5px] hover:bg-[#f6f6f7]"
                      >
                        查看链接
                      </button>
                      {o.status === "pending" && (
                        <button onClick={() => void markCancelled(o.id)} className="ml-1.5 text-[11.5px] text-ink3 hover:text-bad">
                          取消
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!(orders || []).length && (
                <tr>
                  <td colSpan={7} className="px-3.5 py-10 text-center text-[12px] text-ink3">
                    还没有订单。选好媒体后点「提交订单」。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 台账 */}
      <Table
        head={["稿件", "媒体", "AIW", "状态", "发布日期", "收录", "AI 引用"]}
        foot={
          <div className="flex items-center gap-2 text-[11.5px] text-ink3">
            <span>共 {(placements || []).length} 条 · 发布回链与收录由后续巡检更新</span>
          </div>
        }
      >
        {(placements || []).slice(0, 12).map((p) => (
          <tr key={p.id} className={trHover}>
            <td className={cn(td, "max-w-[320px] truncate font-medium text-ink")}>{p.content || "（待分配内容）"}</td>
            <td className={td}>{p.media}</td>
            <td className={cn(td, "tnum")}>{p.mediaAiw}</td>
            <td className={td}>
              <Badge tone={p.state === "已完成" ? "ok" : p.state === "待回链" ? "warn" : "default"}>{p.state}</Badge>
            </td>
            <td className={cn(td, "tnum")}>{p.publishedAt || "—"}</td>
            <td className={td}>{p.indexed ? <Badge tone="ok">已收录</Badge> : <Badge tone="warn">未收录</Badge>}</td>
            <td className={td}>{p.cited ? <Badge tone="info">{p.cited} 次</Badge> : <Badge>—</Badge>}</td>
          </tr>
        ))}
        {!(placements || []).length && (
          <tr>
            <td colSpan={7} className="px-3.5 py-10 text-center text-[12px] text-ink3">
              暂无投放台账
            </td>
          </tr>
        )}
      </Table>

      <Note tone="info" title="为什么按 AIW 而不是粉丝量选媒：">
        同一个本地门户，AIW 92 的被豆包引用 3 次，而粉丝量更高的账号引用可能为 0。粉丝量衡量「人看」，AIW 衡量「AI 看」，后者才是 GEO 的目标。
      </Note>

      <Note tone="warn" title="当前为人工代投模式：">
        下单后由运营接单并人工联系媒体，出稿后回填真实链接，你在「查看链接」里可逐条核对；链接与收录状态会同步到下方台账。
      </Note>

      <Drawer
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `订单 ${detail.id.slice(0, 8)}` : ""}
        sub={
          detail
            ? `${detail.objective} · ${money(detail.total)} · ${ORDER_STATUS[detail.status]?.text || detail.status}`
            : ""
        }
        footer={
          <button
            onClick={() => setDetail(null)}
            className="rounded-full border border-hair bg-white px-3.5 py-1.5 text-[12.5px] hover:bg-[#f6f6f7]"
          >
            关闭
          </button>
        }
      >
        {detail && (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge tone={ORDER_STATUS[detail.status]?.tone || "default"}>
                {ORDER_STATUS[detail.status]?.text || detail.status}
              </Badge>
              {detail.assignee && <Badge tone="info">负责人 {detail.assignee}</Badge>}
              <Badge>{detail.deliveryMode === "manual" ? "人工代投" : "直连媒体"}</Badge>
              <Badge>
                回填 {detail.placements.filter((p) => p.state === "已完成").length}/{detail.placements.length}
              </Badge>
            </div>

            <div className="mt-4 text-[11.5px] text-ink3">发布台账</div>
            {detail.placements.map((p) => (
              <div key={p.id} className="border-b border-hair2 py-2.5 last:border-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-medium">{p.media}</span>
                  <Badge tone={p.state === "已完成" ? "ok" : p.state === "被退回" ? "bad" : "default"}>{p.state}</Badge>
                  <span className="ml-auto text-[10.5px] text-ink3">{p.publishedAt || "—"}</span>
                </div>
                <div className="mt-1 truncate text-[10.5px] text-ink3">{p.content}</div>
                {p.url ? (
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block truncate text-[11.5px] text-accent underline underline-offset-2"
                  >
                    {p.url}
                  </a>
                ) : (
                  <div className="mt-1 text-[10.5px] text-[#a40010]">
                    {p.state === "被退回"
                      ? `退回原因：${p.note || "媒体退回"}`
                      : p.state === "已完成"
                        ? "链接缺失，请联系运营补齐（无链接不计入交付）"
                        : "运营处理中，出稿后自动回填链接"}
                  </div>
                )}
              </div>
            ))}
            {!detail.placements.length && <div className="py-3 text-[11.5px] text-ink3">该订单没有台账项</div>}

            <div className="mt-4">
              <Note tone="info" title="链接就是交付凭证：">
                每条链接对应一家媒体的实际出稿页面；收录与 AI 引用由后续巡检回写，可作为结算依据。
              </Note>
            </div>
          </>
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
