import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge, Card, CardHead, Kpi, Note, cn, td, trHover } from "../components/ui";
import {
  checkLinks,
  createLink,
  deleteLink,
  fetchLinkChecks,
  fetchLinks,
  syncLinks,
  updateLink,
  useApi,
  useSession,
} from "../api";

const KIND_LABEL: Record<string, string> = {
  article: "发布文章",
  official: "品牌官网",
  landing: "搜索落地页",
  citation: "AI 引用 / 取证",
  competitor: "竞品页面",
  reprint: "转载",
  other: "其他",
};
const STATUS: Record<string, { text: string; tone: "ok" | "bad" | "default" }> = {
  active: { text: "可访问", tone: "ok" },
  broken: { text: "失效", tone: "bad" },
  unknown: { text: "未检测", tone: "default" },
};

const inputCls =
  "h-9 rounded-lg border border-hair bg-[#fbfbfc] px-2.5 text-[12px] outline-none focus:border-accent/60 focus:bg-white focus:ring-3 focus:ring-accent/12";
const btnCls =
  "h-9 rounded-lg px-4 text-[12px] font-medium text-white bg-accent hover:bg-[#0077ed] disabled:cursor-not-allowed disabled:bg-accent/50";
const ghostCls =
  "h-9 rounded-lg border border-hair bg-white px-3 text-[12px] text-ink2 hover:bg-[#f6f6f7] disabled:opacity-40";

export default function Links() {
  const { brandId, me } = useSession();
  const canWrite = me?.permissions?.write !== false;
  const [params, setParams] = useSearchParams();
  const hostFilter = params.get("host") || "";
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setForm] = useState({ url: "", kind: "article", title: "", publishedAt: "", note: "" });

  const { data, loading, error, reload } = useApi(
    brandId ? () => fetchLinks(brandId, kind, status) : null,
    [brandId, kind, status]
  );
  const { data: checks, reload: reloadChecks } = useApi(
    brandId ? () => fetchLinkChecks(brandId) : null,
    [brandId]
  );

  function flash(m: string) {
    setToast(m);
    window.setTimeout(() => setToast(null), 3200);
  }

  async function doSync() {
    if (!brandId || busy) return;
    setBusy(true);
    try {
      const r = await syncLinks(brandId);
      flash(`同步完成：发现 ${r.found} 个地址，新增 ${r.added}，已存在 ${r.skipped}`);
      void reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "同步失败");
    } finally {
      setBusy(false);
    }
  }

  async function doCheck() {
    if (!brandId || busy) return;
    setBusy(true);
    try {
      const r = await checkLinks(brandId);
      flash(`巡检完成：${r.checked} 条，可访问 ${r.active}，失效 ${r.broken}（网络错误 ${r.networkErrors}）`);
      void reload();
      void reloadChecks();
    } catch (e) {
      flash(e instanceof Error ? e.message : "巡检失败");
    } finally {
      setBusy(false);
    }
  }

  async function addLink() {
    if (!brandId || !form.url.trim()) return flash("请填写网址");
    try {
      await createLink(brandId, form);
      setForm({ url: "", kind: "article", title: "", publishedAt: "", note: "" });
      flash("链接已登记");
      void reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "登记失败");
    }
  }

  async function toggleIndexed(id: string, current: number | null) {
    if (!brandId) return;
    try {
      await updateLink(brandId, id, { indexed: current === 1 ? 0 : 1 });
      flash(current === 1 ? "已改为未收录" : "已标记收录");
      void reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "更新失败");
    }
  }

  async function remove(id: string) {
    if (!brandId) return;
    try {
      await deleteLink(brandId, id);
      flash("链接已删除");
      void reload();
      void reloadChecks();
    } catch (e) {
      flash(e instanceof Error ? e.message : "删除失败");
    }
  }

  if (loading && !data) return <div className="enter p-6 text-[13px] text-ink3">正在读取链接台账…</div>;
  if (error && !data) return <Note tone="warn" title="读取失败：">{error}</Note>;

  const s = data?.summary;
  const items = (data?.items || []).filter(
    (l) => !hostFilter || String(l.host || "").toLowerCase().includes(hostFilter.toLowerCase())
  );

  return (
    <div className="enter flex flex-col gap-3.5">
      <Note tone="info" title="为什么要有这张表：">
        发布地址、官网、搜索落地页、AI 答案引用链接统一登记，才能把「发布 → 存活 → 收录 → 被引用」串起来。
        <b className="mx-1">存活巡检是真实 HTTP 请求</b>，不需要 Key；收录状态需搜索 API 或人工回填，未检测一律显示「—」；
        被引用次数只统计真实探测 / C 端取证 / 搜索命中，模拟样本单列，不计入效果。
      </Note>

      {hostFilter && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-accent/30 bg-[#f7f9ff] px-3 py-2 text-[11.5px] text-ink2">
          正在按引用域名筛选：
          <span className="font-medium text-accent">{hostFilter}</span>
          <span className="text-ink3">（来自采集原文的引用来源）</span>
          <button onClick={() => setParams({})} className={cn(ghostCls, "ml-auto h-8")}>
            清除筛选
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Kpi label="台账链接" value={s?.total ?? "—"} unit="条" sub={`${Object.keys(s?.byKind || {}).length} 种类型`} />
        <Kpi label="可访问" value={s?.active ?? "—"} unit="条" sub={s?.lastCheckedAt ? `最近巡检 ${s.lastCheckedAt.slice(5, 16)}` : "尚未巡检"} />
        <Kpi label="失效" value={s?.broken ?? "—"} unit="条" sub={`未检测 ${s?.unknown ?? 0} 条`} />
        <Kpi label="真实被引用" value={s?.citedTotal ?? "—"} unit="次" sub={`模拟引用 ${s?.citedMock ?? 0} 次（不计入）`} />
      </div>

      <Card>
        <CardHead
          title="台账操作"
          sub="先把分散在媒体台账、官网、搜索结果与取证记录里的地址同步进来，再做存活巡检"
          right={<Badge tone={s?.broken ? "bad" : "ok"} dot>{s?.broken ? `${s.broken} 条失效` : "暂无失效"}</Badge>}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={cn(inputCls, "w-36")}>
            <option value="">全部类型</option>
            {(data?.kinds || Object.keys(KIND_LABEL)).map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k] || k}</option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={cn(inputCls, "w-32")}>
            <option value="">全部状态</option>
            <option value="active">可访问</option>
            <option value="broken">失效</option>
            <option value="unknown">未检测</option>
          </select>
          <button onClick={() => void doSync()} disabled={busy || !canWrite} className={ghostCls}>从现有数据同步</button>
          <button onClick={() => void doCheck()} disabled={busy || !canWrite} className={btnCls}>
            {busy ? "处理中…" : "批量存活巡检"}
          </button>
          <span className="ml-auto text-[10.5px] text-ink3">巡检会真发 HTTP 请求，结果写入历史</span>
        </div>
      </Card>

      <Card>
        <CardHead title="登记链接" sub="人工补录台账里没有的地址，例如外部媒体、转载页、竞品页面" />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={form.url}
            onChange={(e) => setForm((v) => ({ ...v, url: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && void addLink()}
            placeholder="https://example.com/article"
            className={cn(inputCls, "min-w-[260px] flex-1")}
          />
          <select value={form.kind} onChange={(e) => setForm((v) => ({ ...v, kind: e.target.value }))} className={cn(inputCls, "w-32")}>
            {Object.entries(KIND_LABEL).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
          <input value={form.title} onChange={(e) => setForm((v) => ({ ...v, title: e.target.value }))} placeholder="标题（可选）" className={cn(inputCls, "w-40")} />
          <input type="date" value={form.publishedAt} onChange={(e) => setForm((v) => ({ ...v, publishedAt: e.target.value }))} className={cn(inputCls, "w-36")} />
          <button onClick={() => void addLink()} disabled={!canWrite} className={btnCls}>登记</button>
        </div>
      </Card>

      <Card flush>
        <div className="px-4 pt-4 pb-3">
          <CardHead
            title="链接资产明细"
            sub="收录与引用来自台账/真实探测；失效链接会被标记，不再沿用写死的「已收录」"
            right={<Badge tone="default">{items.length} 条</Badge>}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-hair bg-[#fafafb] text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">
                <th className="px-3.5 py-2.5">网址</th>
                <th className="px-3.5 py-2.5">类型</th>
                <th className="px-3.5 py-2.5">标题 / 来源</th>
                <th className="px-3.5 py-2.5">存活</th>
                <th className="px-3.5 py-2.5">HTTP</th>
                <th className="px-3.5 py-2.5">收录</th>
                <th className="px-3.5 py-2.5">被引用</th>
                <th className="px-3.5 py-2.5">最近检测</th>
                <th className="px-3.5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {items.map((l) => {
                const st = STATUS[l.status] || STATUS.unknown;
                return (
                  <tr key={l.id} className={trHover}>
                    <td className={cn(td, "max-w-[260px]")}>
                      <a href={l.url} target="_blank" rel="noreferrer" title={l.url} className="block truncate text-accent hover:underline">
                        {l.url}
                      </a>
                      <div className="mt-0.5 text-[10px] text-ink3">{l.host}</div>
                    </td>
                    <td className={td}>{KIND_LABEL[l.kind] || l.kind}</td>
                    <td className={cn(td, "max-w-[180px] truncate")} title={l.title}>
                      {l.title || "—"}
                      <div className="mt-0.5 text-[10px] text-ink3">{l.source === "sync" ? "自动同步" : "人工登记"}</div>
                    </td>
                    <td className={td}><Badge tone={st.tone}>{st.text}</Badge></td>
                    <td className={cn(td, "tnum")}>{l.httpStatus ?? "—"}</td>
                    <td className={td}>
                      {l.indexed === 1 ? <Badge tone="ok">已收录</Badge> : l.indexed === 0 ? <Badge tone="warn">未收录</Badge> : <Badge tone="default">未检测</Badge>}
                    </td>
                    <td className={cn(td, "tnum")}>
                      {l.citedCount > 0 ? <Badge tone="info">{l.citedCount} 次</Badge> : "—"}
                      {l.citedMock > 0 && <div className="mt-0.5 text-[10px] text-ink3">模拟 {l.citedMock} 次不计入</div>}
                    </td>
                    <td className={cn(td, "tnum")}>{l.lastCheckedAt ? l.lastCheckedAt.slice(5, 16) : "—"}</td>
                    <td className={td}>
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => void toggleIndexed(l.id, l.indexed)} disabled={!canWrite} className="text-[11px] text-accent hover:underline disabled:opacity-40">
                          {l.indexed === 1 ? "取消收录" : "标记收录"}
                        </button>
                        <button onClick={() => void remove(l.id)} disabled={!canWrite} className="text-[11px] text-ink3 hover:text-[#bf0010] disabled:opacity-40">
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!items.length && (
                <tr>
                  <td colSpan={9} className={cn(td, "py-8 text-center text-ink3")}>
                    台账为空，先点「从现有数据同步」或手工登记一个网址
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {(checks?.length ?? 0) > 0 && (
        <Card flush>
          <div className="px-4 pt-4 pb-3">
            <CardHead title="最近巡检记录" sub="每次真发 HTTP 的状态码与耗时，最多保留 50 条" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-hair bg-[#fafafb] text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">
                  <th className="px-3.5 py-2.5">时间</th>
                  <th className="px-3.5 py-2.5">网址</th>
                  <th className="px-3.5 py-2.5">结果</th>
                  <th className="px-3.5 py-2.5">HTTP</th>
                  <th className="px-3.5 py-2.5">耗时</th>
                </tr>
              </thead>
              <tbody>
                {checks?.slice(0, 10).map((c) => (
                  <tr key={c.id} className={trHover}>
                    <td className={cn(td, "tnum")}>{c.checkedAt.slice(5, 16)}</td>
                    <td className={cn(td, "max-w-[300px] truncate")} title={c.url}>{c.url || "已删除的链接"}</td>
                    <td className={td}>{c.ok ? <Badge tone="ok">正常</Badge> : <Badge tone="bad">{c.error || "失效"}</Badge>}</td>
                    <td className={cn(td, "tnum")}>{c.httpStatus || "—"}</td>
                    <td className={cn(td, "tnum")}>{c.ms} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="pb-2 text-[10.5px] leading-relaxed text-ink3">
        口径备注：被引用次数按域名匹配 AI 答案里的信源、C 端取证与搜索结果落地页；模拟探测产生的引用单列展示，不参与效果统计。
        媒体分发页的「收录 / 被引用」也已改为从这张台账回填，不再使用种子数据里的写死值。
      </div>

      {toast && (
        <div className="pointer-events-none fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-[#1d1d1f] px-4 py-2.5 text-[12px] text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
