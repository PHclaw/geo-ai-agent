import { useState } from "react";
import { Badge, Card, CardHead, Kpi, Note, cn, td, trHover } from "../components/ui";
import {
  deletePlan,
  fetchPlans,
  generatePlans,
  publishPlan,
  updatePlan,
  useApi,
  useSession,
  type PlanItem,
} from "../api";

const inputCls =
  "h-9 rounded-lg border border-hair bg-[#fbfbfc] px-2.5 text-[12px] outline-none focus:border-accent/60 focus:bg-white focus:ring-3 focus:ring-accent/12";
const btnCls =
  "h-9 rounded-lg px-4 text-[12px] font-medium text-white bg-accent hover:bg-[#0077ed] disabled:cursor-not-allowed disabled:bg-accent/50";
/** ISO 周一，用于按周分组 */
function weekKey(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  const wd = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - wd + 1);
  return d.toISOString().slice(0, 10);
}

const STATE_META: Record<string, { text: string; tone: "ok" | "warn" | "default" }> = {
  planned: { text: "待发布", tone: "default" },
  published: { text: "已回填链接", tone: "ok" },
  skipped: { text: "已跳过", tone: "warn" },
};

export default function Plan() {
  const { brandId, me } = useSession();
  const canWrite = me?.permissions?.write !== false;
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setForm] = useState({ warmupCount: "4", ratio: "3", weeks: "4", intervalDays: "2", channels: "", startDate: "" });

  const { data, loading, error, reload } = useApi(brandId ? () => fetchPlans(brandId) : null, [brandId]);

  function flash(m: string) {
    setToast(m);
    window.setTimeout(() => setToast(null), 3200);
  }

  async function generate() {
    if (!brandId || busy) return;
    setBusy(true);
    try {
      const channels = form.channels.trim()
        ? form.channels.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
        : data?.defaults.channels;
      const r = await generatePlans(brandId, {
        warmupCount: Number(form.warmupCount),
        ratio: Number(form.ratio),
        weeks: Number(form.weeks),
        intervalDays: Number(form.intervalDays),
        channels,
        startDate: form.startDate || undefined,
      });
      flash(`已生成 ${r.created} 条排期：养号 ${r.warmup} 条、GEO 文章 ${r.geo} 条${r.hint ? ` · ${r.hint}` : ""}`);
      void reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "生成失败");
    } finally {
      setBusy(false);
    }
  }

  async function fillUrl(p: PlanItem) {
    if (!brandId) return;
    const url = window.prompt("回填真实发布链接（http/https）", p.url || "https://");
    if (!url) return;
    try {
      const r = await publishPlan(brandId, p.id, url);
      flash(r.linked ? "链接已回填，并同步进链接资产台账" : "链接已回填（台账里已存在该地址）");
      void reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "回填失败");
    }
  }

  async function skip(p: PlanItem) {
    if (!brandId) return;
    try {
      await updatePlan(brandId, p.id, { state: p.state === "skipped" ? "planned" : "skipped" });
      flash(p.state === "skipped" ? "已恢复为待发布" : "已跳过该条");
      void reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "操作失败");
    }
  }

  async function remove(p: PlanItem) {
    if (!brandId) return;
    try {
      await deletePlan(brandId, p.id);
      flash("排期已删除");
      void reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "删除失败");
    }
  }

  if (loading && !data) return <div className="enter p-6 text-[13px] text-ink3">正在读取发布排期…</div>;
  if (error && !data) return <Note tone="warn" title="读取失败：">{error}</Note>;

  const items = data?.items || [];
  const s = data?.summary;
  const d = data?.defaults;
  const weeks = new Map<string, PlanItem[]>();
  for (const it of items) {
    const k = weekKey(it.plannedAt);
    if (!weeks.has(k)) weeks.set(k, []);
    weeks.get(k)!.push(it);
  }

  return (
    <div className="enter flex flex-col gap-3.5">
      <Note tone="info" title="口径说明：">
        先发纯知识内容养号，再按设定比例穿插 GEO 文章。系统<b className="mx-1">只生成排期、不代发</b>；
        「养号」内容不带品牌、不含数字，<b className="mx-1">永远不计入 AI 曝光指标</b>——只有 GEO 文章且已回填真实链接才计入。
        养号有助于平台侧账号运营，但没有证据表明能直接提升 AI 引用率。
      </Note>

      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Kpi label="排期总数" value={s?.total ?? "—"} unit="条" sub={`${s?.channels.length ?? 0} 个渠道`} />
        <Kpi label="养号内容" value={s?.warmup ?? "—"} unit="条" sub="不计入指标" />
        <Kpi label="GEO 文章" value={s?.geo ?? "—"} unit="条" sub="穿插发布" />
        <Kpi label="已回填 GEO 链接" value={s?.geoEffective ?? "—"} unit="条" sub="唯一计入效果的口径" />
      </div>

      <Card>
        <CardHead
          title="生成排期"
          sub="按规则落库；重新生成会覆盖尚未发布的旧计划，已发布与已跳过的保留"
          right={<Badge tone="default">人工代投</Badge>}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11.5px] text-ink3">养号条数
            <input type="number" min={0} max={20} value={form.warmupCount} onChange={(e) => setForm((v) => ({ ...v, warmupCount: e.target.value }))} className={cn(inputCls, "w-20")} />
          </label>
          <label className="flex items-center gap-1.5 text-[11.5px] text-ink3">知识:GEO
            <input type="number" min={1} max={9} value={form.ratio} onChange={(e) => setForm((v) => ({ ...v, ratio: e.target.value }))} className={cn(inputCls, "w-20")} />
          </label>
          <label className="flex items-center gap-1.5 text-[11.5px] text-ink3">周期(周)
            <input type="number" min={1} max={12} value={form.weeks} onChange={(e) => setForm((v) => ({ ...v, weeks: e.target.value }))} className={cn(inputCls, "w-20")} />
          </label>
          <label className="flex items-center gap-1.5 text-[11.5px] text-ink3">间隔(天)
            <input type="number" min={1} max={14} value={form.intervalDays} onChange={(e) => setForm((v) => ({ ...v, intervalDays: e.target.value }))} className={cn(inputCls, "w-20")} />
          </label>
          <label className="flex items-center gap-1.5 text-[11.5px] text-ink3">起始
            <input type="date" value={form.startDate || d?.startDate || ""} onChange={(e) => setForm((v) => ({ ...v, startDate: e.target.value }))} className={cn(inputCls, "w-36")} />
          </label>
          <input
            value={form.channels}
            onChange={(e) => setForm((v) => ({ ...v, channels: e.target.value }))}
            placeholder={`渠道，逗号分隔（默认 ${d?.channels.join("、") || "知乎、小红书、公众号"}）`}
            className={cn(inputCls, "min-w-[220px] flex-1")}
          />
          <button onClick={() => void generate()} disabled={busy || !canWrite} className={btnCls}>
            {busy ? "生成中…" : "生成排期"}
          </button>
        </div>
      </Card>

      {[...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, list]) => (
        <Card flush key={week}>
          <div className="px-4 pt-4 pb-3">
            <CardHead
              title={`第 ${week} 周起`}
              sub={`${list.length} 条 · 养号 ${list.filter((x) => x.kind === "knowledge").length} 条 · GEO ${list.filter((x) => x.kind === "geo").length} 条`}
              right={<Badge tone="default">{week}</Badge>}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-hair bg-[#fafafb] text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">
                  <th className="px-3.5 py-2.5">日期</th>
                  <th className="px-3.5 py-2.5">渠道</th>
                  <th className="px-3.5 py-2.5">阶段</th>
                  <th className="px-3.5 py-2.5">类型</th>
                  <th className="px-3.5 py-2.5">标题 / 选题</th>
                  <th className="px-3.5 py-2.5">状态</th>
                  <th className="px-3.5 py-2.5">发布链接</th>
                  <th className="px-3.5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {list.map((p) => {
                  const st = STATE_META[p.state] || STATE_META.planned;
                  return (
                    <tr key={p.id} className={trHover}>
                      <td className={cn(td, "tnum")}>{p.plannedAt.slice(5)}</td>
                      <td className={td}>{p.channel || "—"}</td>
                      <td className={td}><Badge tone={p.stage === "warmup" ? "warn" : "info"}>{p.stage === "warmup" ? "养号" : "穿插"}</Badge></td>
                      <td className={td}><Badge tone={p.kind === "geo" ? "ok" : "default"}>{p.kind === "geo" ? "GEO 文章" : "纯知识"}</Badge></td>
                      <td className={cn(td, "max-w-[280px] truncate")} title={p.title}>{p.title}</td>
                      <td className={td}><Badge tone={st.tone}>{st.text}</Badge></td>
                      <td className={cn(td, "max-w-[180px] truncate")}>
                        {p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{p.url}</a> : "—"}
                      </td>
                      <td className={td}>
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => void fillUrl(p)} disabled={!canWrite} className="text-[11px] text-accent hover:underline disabled:opacity-40">回填链接</button>
                          <button onClick={() => void skip(p)} disabled={!canWrite} className="text-[11px] text-ink3 hover:underline disabled:opacity-40">{p.state === "skipped" ? "恢复" : "跳过"}</button>
                          <button onClick={() => void remove(p)} disabled={!canWrite} className="text-[11px] text-ink3 hover:text-[#bf0010] disabled:opacity-40">删除</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      {!items.length && (
        <Card>
          <div className="py-10 text-center text-[12.5px] text-ink3">
            还没有排期，先设置养号条数与穿插比例，点「生成排期」
          </div>
        </Card>
      )}

      <div className="pb-2 text-[10.5px] leading-relaxed text-ink3">
        回填的链接会同步进「链接资产」台账（去重），之后可做存活巡检；养号内容即使回填链接也不会计入 GEO 效果口径。
      </div>

      {toast && (
        <div className="pointer-events-none fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-[#1d1d1f] px-4 py-2.5 text-[12px] text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
