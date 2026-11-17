import { useEffect, useState } from "react";
import { Badge, Card, CardHead, Drawer, Kpi, Note, cn, td, trHover } from "../components/ui";
import {
  createAgencyClient,
  createAgencyTask,
  deleteAgencyClient,
  fetchAgencyOverview,
  saveAgencySettings,
  updateAgencyClient,
  useApi,
  useSession,
  type AgencyClient,
  type AgencyClientInput,
} from "../api";

const COLORS = ["#0071e3", "#1d9d5a", "#b25000", "#5e5ce6", "#1d1d1f"];
const STATES = ["服务中", "续费预警", "暂停"];

const inputCls =
  "h-9 rounded-lg border border-hair bg-[#fbfbfc] px-2.5 text-[12px] outline-none focus:border-accent/60 focus:bg-white focus:ring-3 focus:ring-accent/12";
const btnCls =
  "h-9 rounded-lg px-3.5 text-[12px] font-medium text-white bg-accent hover:bg-[#0077ed] disabled:cursor-not-allowed disabled:bg-accent/50";
const ghostCls =
  "h-9 rounded-lg border border-hair bg-white px-3 text-[12px] text-ink2 hover:bg-[#f6f6f7] disabled:opacity-40";

const yuan = (v: number | null) => (v === null || v === undefined ? "—" : `¥${Number(v).toLocaleString("zh-CN")}`);

export default function Agency() {
  const { me } = useSession();
  const canWrite = me?.permissions?.write !== false;
  const [filter, setFilter] = useState("全部");
  const [active, setActive] = useState<AgencyClient | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<AgencyClientInput>({ name: "", plan: "成长版", state: "服务中", expire: "", avi: null, contents: 0, budget: 0, note: "" });
  const [themeColor, setThemeColor] = useState(COLORS[0]);
  const [reportTemplate, setReportTemplate] = useState("标准模板");
  const [toast, setToast] = useState<string | null>(null);

  const { data, loading, error, reload } = useApi(() => fetchAgencyOverview(), []);

  useEffect(() => {
    if (!data) return;
    setThemeColor(data.settings.themeColor);
    setReportTemplate(data.settings.reportTemplate);
  }, [data]);

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3000);
  }

  async function addClient() {
    if (!form.name.trim()) return flash("请填写客户名称");
    try {
      await createAgencyClient(form);
      setForm({ name: "", plan: "成长版", state: "服务中", expire: "", avi: null, contents: 0, budget: 0, note: "" });
      setShowForm(false);
      flash("客户已创建");
      void reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "创建失败");
    }
  }

  async function removeClient(id: string) {
    try {
      await deleteAgencyClient(id);
      setActive(null);
      flash("客户已删除");
      void reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "删除失败");
    }
  }

  async function toggleState(c: AgencyClient) {
    const next = c.state === "续费预警" ? "服务中" : "续费预警";
    try {
      await updateAgencyClient(c.id, { state: next });
      setActive(null);
      flash(`状态已更新为「${next}」`);
      void reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "更新失败");
    }
  }

  async function saveSettings() {
    try {
      await saveAgencySettings({ themeColor, reportTemplate });
      flash("白标设置已保存");
      void reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "保存失败");
    }
  }

  async function registerTask(kind: string) {
    try {
      const r = await createAgencyTask(kind);
      flash(`任务已登记（${r.status}）：报告生成 / 批量复测服务尚未接入`);
      void reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "登记失败");
    }
  }

  if (loading && !data) return <div className="enter p-6 text-[13px] text-ink3">正在汇总服务商数据…</div>;
  if (error && !data) return <Note tone="warn" title="读取失败：">{error}</Note>;

  const items = data?.items || [];
  const summary = data?.summary || { clients: 0, brands: 0, budget: 0, warning: 0 };
  const tasks = data?.tasks || [];
  const filtered = items.filter((c) =>
    filter === "全部" ? true : filter === "续费预警" ? c.state === "续费预警" : c.state === "暂停"
  );
  const paused = items.filter((c) => c.state === "暂停").length;

  return (
    <div className="enter flex flex-col gap-3.5">
      <Note tone="info" title="数据来源：">
        自有品牌行由 `brands / metrics_daily / contents / orders` 实时聚合；其余客户为手工录入并落库。
        白标设置与批量任务也写入数据库；<b>报告生成、批量复测与多租户切换尚未接入</b>，点按钮只登记 pending 任务。
      </Note>

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="info">{summary.brands} 个自有品牌</Badge>
        <Badge tone="default">{tasks.length} 条待处理任务</Badge>
        <div className="ml-auto flex flex-wrap gap-2">
          <button onClick={() => void registerTask("批量出报告")} disabled={!canWrite} className={ghostCls}>批量出报告</button>
          <button onClick={() => void registerTask("批量复测")} disabled={!canWrite} className={ghostCls}>批量复测</button>
          <button onClick={() => setShowForm((v) => !v)} disabled={!canWrite} className={btnCls}>
            {showForm ? "收起表单" : "+ 新建客户"}
          </button>
        </div>
      </div>

      {showForm && (
        <Card>
          <CardHead title="新建客户" sub="录入真实客户信息，保存后写入数据库" />
          <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <input value={form.name} onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))} placeholder="客户名称 *" className={inputCls} />
            <select value={form.plan} onChange={(e) => setForm((v) => ({ ...v, plan: e.target.value }))} className={inputCls}>
              <option value="旗舰代运营">旗舰代运营</option>
              <option value="成长版">成长版</option>
              <option value="启动版">启动版</option>
            </select>
            <select value={form.state} onChange={(e) => setForm((v) => ({ ...v, state: e.target.value }))} className={inputCls}>
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input value={form.expire} onChange={(e) => setForm((v) => ({ ...v, expire: e.target.value }))} placeholder="到期（2027-03）" className={inputCls} />
            <input type="number" value={form.avi ?? ""} onChange={(e) => setForm((v) => ({ ...v, avi: e.target.value === "" ? null : Number(e.target.value) }))} placeholder="AVI" className={inputCls} />
            <input type="number" value={form.contents ?? 0} onChange={(e) => setForm((v) => ({ ...v, contents: Number(e.target.value) }))} placeholder="内容数" className={inputCls} />
            <input type="number" value={form.budget ?? 0} onChange={(e) => setForm((v) => ({ ...v, budget: Number(e.target.value) }))} placeholder="投放预算" className={inputCls} />
            <button onClick={() => void addClient()} disabled={!canWrite} className={btnCls}>保存客户</button>
          </div>
        </Card>
      )}

      <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="客户数" value={summary.clients} unit="个" sub={`其中自有品牌 ${summary.brands} 个`} />
        <Kpi label="投放预算合计" value={yuan(summary.budget)} sub="由 orders 汇总 + 人工录入" />
        <Kpi label="续费预警" value={summary.warning} unit="个" sub="状态标记为预警" />
        <Kpi label="暂停客户" value={paused} unit="个" sub="状态标记为暂停" />
      </section>

      <section className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card flush>
          <div className="px-[18px] pt-[15px]">
            <CardHead
              title="客户列表"
              sub="点击客户查看详情；自有品牌行由真实业务数据聚合"
              right={
                <div className="inline-flex gap-0.5 rounded-[9px] bg-[#ebebef] p-0.5">
                  {[`全部 ${items.length}`, `续费预警 ${summary.warning}`, `暂停 ${paused}`].map((t, i) => (
                    <button
                      key={t}
                      onClick={() => setFilter(["全部", "续费预警", "暂停"][i])}
                      className={cn(
                        "h-[26px] rounded-[7px] px-3 text-[11.5px]",
                        filter === ["全部", "续费预警", "暂停"][i] ? "bg-white font-medium text-black shadow-[0_1px_2px_rgba(0,0,0,0.09)]" : "text-[#5a5a5e]"
                      )}
                    >
                      {t}
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
                  {["客户", "套餐", "来源", "AVI", "内容", "投放预算", "状态", "到期", ""].map((h) => (
                    <th key={h} className="border-y border-hair bg-[#fafafb]/70 px-3.5 py-2.5 text-left text-[10px] font-semibold tracking-[0.07em] whitespace-nowrap text-ink3 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} onClick={() => setActive(c)} className={cn("cursor-pointer border-b border-hair2", trHover)}>
                    <td className={cn(td, "border-0 font-medium text-ink")}>
                      {c.name}{c.primary && <Badge tone="info" className="ml-1.5">主客户</Badge>}
                    </td>
                    <td className={cn(td, "border-0")}><Badge tone={c.plan === "旗舰代运营" ? "purple" : "default"}>{c.plan}</Badge></td>
                    <td className={cn(td, "border-0")}><Badge tone={c.source === "brand" ? "ok" : "info"}>{c.source === "brand" ? "实时聚合" : "手工录入"}</Badge></td>
                    <td className={cn(td, "tnum border-0 font-semibold text-black")}>{c.avi ?? "—"}</td>
                    <td className={cn(td, "tnum border-0")}>{c.contents}</td>
                    <td className={cn(td, "tnum border-0 font-semibold")}>{yuan(c.budget)}</td>
                    <td className={cn(td, "border-0")}><Badge tone={c.state === "服务中" ? "ok" : c.state === "续费预警" ? "warn" : "default"}>{c.state}</Badge></td>
                    <td className={cn(td, "tnum border-0")}>{c.expire || "—"}</td>
                    <td className={cn(td, "border-0 text-right")}><span className="text-[11.5px] text-accent">查看</span></td>
                  </tr>
                ))}
                {!filtered.length && (
                  <tr><td colSpan={9} className={cn(td, "py-8 text-center text-ink3")}>该筛选下没有客户</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2 border-t border-hair px-4 py-3 text-[11.5px] text-ink3">
            <span>显示 {filtered.length} / {items.length}</span>
            <span className="ml-auto">数据来自本地数据库</span>
          </div>
        </Card>

        <div className="flex flex-col gap-3.5">
          <Card>
            <CardHead title="白标设置" sub="主题色与报告模板写入数据库" right={<Badge tone="ok">已落库</Badge>} />
            <div className="mt-3">
              <div className="overflow-hidden rounded-[14px] border border-hair">
                <div className="px-[18px] py-4 text-white" style={{ background: `linear-gradient(135deg, ${themeColor}, #1d1d1f)` }}>
                  <h4 className="m-0 text-[15px] tracking-[-0.02em]">AI 可见度增长报告</h4>
                  <p className="mt-1 mb-0 text-[10.5px] opacity-70">模板：{reportTemplate}</p>
                </div>
              </div>
              <div className="my-3.5 h-px bg-hair" />
              <div className="mb-1.5 text-[11px] text-ink3">主题色</div>
              <div className="flex flex-wrap gap-1.5">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setThemeColor(c)}
                    aria-label={`主题色 ${c}`}
                    className={cn("h-[26px] w-[26px] rounded-lg border-2 transition-all duration-200", themeColor === c ? "scale-105 border-ink" : "border-transparent")}
                    style={{ background: c }}
                  />
                ))}
              </div>
              <div className="mt-3">
                <input value={reportTemplate} onChange={(e) => setReportTemplate(e.target.value)} placeholder="报告模板名称" className={cn(inputCls, "w-full")} />
              </div>
              <button onClick={() => void saveSettings()} disabled={!canWrite} className={cn(btnCls, "mt-3 w-full")}>保存设置</button>
            </div>
          </Card>

          <Card>
            <CardHead title="待处理任务" sub="批量操作只登记，不会假装已执行" right={<Badge tone="default">{tasks.length}</Badge>} />
            <div className="mt-2">
              {tasks.slice(0, 5).map((t) => (
                <div key={t.id} className="flex items-start gap-2.5 border-b border-hair2 py-2.5 last:border-0">
                  <Badge tone="warn">{t.status}</Badge>
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium">{t.kind}</div>
                    <div className="text-[10.5px] text-ink3">{t.note}</div>
                  </div>
                </div>
              ))}
              {!tasks.length && <div className="py-6 text-center text-[12px] text-ink3">暂无任务</div>}
            </div>
          </Card>
        </div>
      </section>

      <Card flush>
        <div className="px-[18px] pt-[15px]">
          <CardHead title="客户健康度" sub="AVI / 内容 / 预算 / 状态全部来自上表真实数据，不再使用写死的涨幅" />
        </div>
        <div className="mt-2.5 w-full overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {["客户", "AVI", "内容数", "投放预算", "状态", "数据来源"].map((h) => (
                  <th key={h} className="border-y border-hair bg-[#fafafb]/70 px-3.5 py-2.5 text-left text-[10px] font-semibold tracking-[0.07em] whitespace-nowrap text-ink3 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className={trHover}>
                  <td className={cn(td, "font-medium text-ink")}>{c.name}</td>
                  <td className={cn(td, "tnum")}>{c.avi ?? "—"}</td>
                  <td className={cn(td, "tnum")}>{c.contents}</td>
                  <td className={cn(td, "tnum")}>{yuan(c.budget)}</td>
                  <td className={td}><Badge tone={c.state === "服务中" ? "ok" : c.state === "续费预警" ? "warn" : "default"}>{c.state}</Badge></td>
                  <td className={td}>{c.source === "brand" ? "业务表实时聚合" : "手工录入"}</td>
                </tr>
              ))}
              {!items.length && <tr><td colSpan={6} className={cn(td, "py-8 text-center text-ink3")}>暂无客户数据</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Note tone="info" title="服务商模式当前边界：">
        多客户视图与白标设置已落库；报告生成、批量复测、跨租户工作台切换、开放 API 仍未接入（PRD V2.0）。
      </Note>

      <Drawer
        open={!!active}
        onClose={() => setActive(null)}
        title={active?.name ?? ""}
        sub={active ? `${active.plan} · ${active.state} · 服务期至 ${active.expire || "—"}` : ""}
        footer={
          active?.source === "manual" ? (
            <>
              <button onClick={() => void toggleState(active)} disabled={!canWrite} className="rounded-full bg-accent px-4 py-1.5 text-[12.5px] font-medium text-white hover:bg-[#0077ed] disabled:opacity-40">
                切换服务状态
              </button>
              <button onClick={() => void removeClient(active.id)} disabled={!canWrite} className="rounded-full border border-hair bg-white px-3.5 py-1.5 text-[12.5px] hover:bg-[#f6f6f7] disabled:opacity-40">
                删除客户
              </button>
            </>
          ) : (
            <span className="text-[11.5px] text-ink3">自有品牌由业务数据实时聚合，需到对应模块修改</span>
          )
        }
      >
        {active && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Badge tone={active.state === "服务中" ? "ok" : "warn"}>{active.state}</Badge>
              <Badge tone="info">AVI {active.avi ?? "—"}</Badge>
              <Badge>内容 {active.contents}</Badge>
              <Badge>{yuan(active.budget)}</Badge>
            </div>
            <div className="rounded-xl border border-hair p-3.5 text-[11.5px] leading-relaxed text-ink2">
              {active.note || "暂无备注"}
            </div>
            <div className="text-[10.5px] text-ink3">来源：{active.source === "brand" ? "brands / metrics_daily / contents / orders" : "agency_clients 手工录入"}</div>
          </div>
        )}
      </Drawer>

      {toast && (
        <div className="pointer-events-none fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-[#1d1d1f] px-4 py-2.5 text-[12px] text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

