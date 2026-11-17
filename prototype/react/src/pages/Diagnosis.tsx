import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Bar, Card, CardHead, Drawer, Kpi, Meter, Note, Ring, Table, cn, td, trHover } from "../components/ui";
import {
  fetchLatestRun,
  fetchProviders,
  runProbe,
  fetchRun,
  testProvider,
  useApi,
  useSession,
  type LatestRun,
  type Provider,
} from "../api";

const PLATFORM_NAME: Record<string, string> = {
  doubao: "豆包",
  deepseek: "DeepSeek",
  kimi: "Kimi",
  yuanbao: "腾讯元宝",
  qwen: "通义 / 夸克",
  wenxin: "文心 / 百度",
};

type ResultRow = LatestRun["results"][number];

export default function Diagnosis() {
  const { brandId, brand, loading: meLoading } = useSession();
  const { data, loading, error, reload } = useApi(brandId ? () => fetchLatestRun(brandId) : null, [brandId]);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [active, setActive] = useState<ResultRow | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [providersOpen, setProvidersOpen] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerMode, setProviderMode] = useState<string>("mock");
  const [testing, setTesting] = useState<string | null>(null);
  const [testOut, setTestOut] = useState<Record<string, string>>({});

  async function loadProviders() {
    try {
      const out = await fetchProviders();
      setProviders(out.providers);
      setProviderMode(out.mode);
    } catch {
      /* 静默：不影响主流程 */
    }
  }

  useEffect(() => {
    void loadProviders();
  }, []);

  async function runTest(key: string) {
    setTesting(key);
    try {
      const r = await testProvider(key);
      setTestOut((prev) => ({
        ...prev,
        [key]: r.ok ? `可用 · ${r.ms}ms · ${r.model}` : `失败：${r.error}`,
      }));
    } catch (e) {
      setTestOut((prev) => ({ ...prev, [key]: e instanceof Error ? e.message : "测试失败" }));
    } finally {
      setTesting(null);
    }
  }

  function flash(m: string) {
    setMsg(m);
    window.setTimeout(() => setMsg(null), 2600);
  }

  async function start() {
    if (running || !brandId) return;
    setRunning(true);
    setProgress({ done: 0, total: 0 });
    try {
      const { runId, total } = await runProbe(brandId, 1);
      setProgress({ done: 0, total });
      const tick = async () => {
        try {
          const st = await fetchRun(runId);
          setProgress({ done: st.run.done, total: st.run.total });
          if (st.run.status === "running") {
            window.setTimeout(tick, 400);
          } else {
            setRunning(false);
            await reload();
            flash(`诊断完成：AVI ${st.summary?.avi ?? 0}，共 ${st.run.total} 条采样`);
          }
        } catch {
          setRunning(false);
          flash("轮询失败，请刷新页面查看");
        }
      };
      window.setTimeout(tick, 400);
    } catch (e) {
      setRunning(false);
      flash(e instanceof Error ? e.message : "启动失败");
    }
  }

  if (meLoading || loading) {
    return <div className="grid place-items-center py-24 text-[12.5px] text-ink3">正在读取诊断数据…</div>;
  }

  if (!brandId) {
    return (
      <Card>
        <CardHead title="还没有品牌档案" sub="建档后即可运行第一次诊断" />
        <div className="mt-4">
          <Link to="/wizard" className="rounded-full bg-accent px-4 py-2 text-[12.5px] font-medium text-white hover:bg-[#0077ed]">
            去建档 →
          </Link>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHead title="加载失败" sub={error} />
        <div className="mt-3">
          <Note tone="warn" title="检查后端：">
            确认 <span className="font-mono">server</span> 已启动（端口 4100）。
          </Note>
        </div>
      </Card>
    );
  }

  const summary = data?.summary || null;
  const run = data?.run || null;
  const results = data?.results || [];

  return (
    <div className="enter flex flex-col gap-3.5">
      {/* 状态栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={providerMode === "live" ? "ok" : providerMode === "mixed" ? "info" : "warn"} dot>
          {providerMode === "live" ? "全部平台真实调用" : providerMode === "mixed" ? "部分平台真实调用" : "全部为模拟探测"}
        </Badge>
        <button
          onClick={() => {
            setProvidersOpen(true);
            void loadProviders();
          }}
          className="rounded-full border border-hair bg-white px-2.5 py-1 text-[11.5px] text-ink2 hover:bg-[#f6f6f7]"
        >
          模型接入
        </button>
        {run ? (
          <span className="text-[11.5px] text-ink3">
            {brand?.name} · 最近一次 {run.status === "done" ? "已完成" : run.status} · {run.total} 条采样
            {run.finishedAt ? ` · ${new Date(run.finishedAt).toLocaleString("zh-CN", { hour12: false })}` : ""}
          </span>
        ) : (
          <span className="text-[11.5px] text-ink3">{brand?.name} · 尚未运行诊断</span>
        )}
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => reload()}
            className="rounded-full border border-hair bg-white px-3.5 py-1.5 text-[12.5px] hover:bg-[#f6f6f7]"
          >
            刷新
          </button>
          <button
            onClick={start}
            disabled={running}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-[12.5px] font-medium text-white",
              running ? "cursor-wait bg-accent/60" : "bg-accent shadow-[0_4px_14px_rgba(0,113,227,0.24)] hover:bg-[#0077ed]"
            )}
          >
            {running ? `探测中 ${progress.done}/${progress.total || "…"}` : run ? "重新诊断" : "开始诊断"}
          </button>
        </div>
      </div>

      {running && (
        <Card>
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
            <span className="text-[12.5px]">正在并行探测 6 个平台…</span>
            <span className="tnum ml-auto text-[11.5px] text-ink3">
              {progress.done} / {progress.total || 0}
            </span>
          </div>
          <div className="mt-2.5">
            <Bar value={progress.total ? (progress.done / progress.total) * 100 : 3} />
          </div>
        </Card>
      )}

      {!summary && !running && (
        <Card>
          <CardHead title="还没有诊断结果" sub="点击右上角「开始诊断」，系统会按提问矩阵逐条询问 6 个平台" />
          <div className="mt-4">
            <Note tone="info" title="会消耗多少：">
              当前 {brand ? "" : ""}提问矩阵条数 × 6 平台 × 1 次采样。模拟引擎约 10 秒完成；接入真实模型后按平台限流。
            </Note>
          </div>
        </Card>
      )}

      {summary && (
        <>
          {/* 口径声明：避免拿模型倾向冒充 C 端可见度 */}
          <div className="flex flex-wrap items-center gap-2.5 rounded-card border border-hair bg-surface px-4 py-3 text-[11.5px]">
            <b className="text-ink">本页为模型口径</b>
            <span className="leading-relaxed text-ink3">
              回答来自模型 API 或模拟引擎，不含联网搜索与地理位置，不等于用户在豆包/元宝等客户端里看到的答案。
            </span>
            <Link
              to="/evidence"
              className="ml-auto shrink-0 rounded-full bg-accent px-3 py-1.5 text-[11.5px] font-medium text-white hover:bg-[#0077ed]"
            >
              录入 A 级取证 →
            </Link>
          </div>

          {/* 样本构成：必须让用户看得见多少条是真、多少条是模拟 */}
          <Card className="py-2.5!">
            <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
              <span className="text-ink3">本次样本构成</span>
              <Badge tone="ok">真实 {summary.sources.live}</Badge>
              <Badge tone="warn">模拟 {summary.sources.mock}</Badge>
              {summary.sources.error > 0 && <Badge tone="bad">失败 {summary.sources.error}</Badge>}
              {summary.sources.mock > 0 && (
                <span className="text-ink3">模拟数据仅用于功能演示，不等于真实 AI 回答</span>
              )}
              {summary.sources.error > 0 && (
                <span className="text-[#a40010]">失败样本已从指标中剔除，不计为「未提及」</span>
              )}
            </div>
          </Card>

          <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="AI 可见度 AVI" value={String(summary.avi)} unit="/100" delta={`${summary.mentionRate}% 提及`} sub="加权提及得分" />
            <Kpi label="提及率" value={String(summary.mentionRate)} unit="%" delta={`首选 ${summary.firstRate}%`} deltaTone="flat" sub="进入前 3 的比例" />
            <Kpi label="识别准确率" value={String(summary.accuracy)} unit="%" delta="仅算被提及" deltaTone="flat" sub="属性描述正确率" />
            <Kpi label="答案份额 SoV" value={String(summary.sov)} unit="%" delta="含竞品" deltaTone="flat" sub="我方提及 ÷ 总提及" />
          </section>

          <section className="grid gap-3.5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Card>
              <CardHead
                title="AI 可见度指数"
                sub="决策型与本地型权重 ×3，认知型 ×1"
                right={
                  <Badge tone={summary.sources.live > 0 ? "ok" : "warn"}>
                    {summary.sources.live > 0 ? `真实 ${summary.sources.live} 条` : "模拟结果"}
                  </Badge>
                }
              />
              <div className="mt-4 flex flex-wrap items-center gap-6">
                <Ring value={summary.avi} />
                <div className="min-w-[200px] flex-1">
                  <div className="flex flex-col gap-3.5">
                    <Meter label="提及率" value={summary.mentionRate} display={`${summary.mentionRate}%`} />
                    <Meter label="首选率" value={summary.firstRate} display={`${summary.firstRate}%`} tone="warn" />
                    <Meter label="准确率" value={summary.accuracy} display={`${summary.accuracy}%`} tone="good" />
                    <Meter label="SoV" value={summary.sov} display={`${summary.sov}%`} />
                  </div>
                </div>
              </div>

              <div className="my-3.5 h-px bg-hair" />
              <div className="mb-2.5 text-[11.5px] text-ink3">按意图分层</div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {summary.byIntent.map((b) => (
                  <Meter
                    key={b.intent}
                    label={`${b.intent}型`}
                    value={b.avi}
                    tone={b.intent === "决策" ? "bad" : "accent"}
                  />
                ))}
              </div>
            </Card>

            <div className="flex flex-col gap-3.5">
              <Card>
                <CardHead title="差距归因" sub="基于本次探测结果自动归纳" />
                <div className="mt-2.5 flex flex-col gap-2">
                  {summary.mentionRate < 50 && (
                    <Note tone="warn" title="可见度不足：">
                      提及率仅 {summary.mentionRate}%，说明多数问题下 AI 不会提到你。优先补可被引用的决策型内容。
                    </Note>
                  )}
                  {summary.accuracy < 90 && (
                    <Note tone="warn" title="口径问题：">
                      识别准确率 {summary.accuracy}%，存在信息过时或冲突。去知识库处理冲突项。
                    </Note>
                  )}
                  {summary.firstRate < 20 && (
                    <Note tone="info" title="首选率偏低：">
                      进入前 3 的比例 {summary.firstRate}%，缺权威信源背书。建议按 AIW 补投本地媒体。
                    </Note>
                  )}
                  {summary.mentionRate >= 50 && summary.accuracy >= 90 && summary.firstRate >= 20 && (
                    <Note tone="info" title="表现健康：">
                      提及、准确与首选三项均达标，可把预算转向竞品领先的意图场景。
                    </Note>
                  )}
                </div>
              </Card>

              <Card>
                <CardHead title="下一步" />
                <div className="mt-2 flex flex-col gap-1">
                  {[
                    ["修正口径冲突", "/knowledge"],
                    ["生产决策型内容", "/content"],
                    ["补投高权重信源", "/media"],
                  ].map(([t, to], i) => (
                    <Link key={t} to={to} className="flex items-center gap-2.5 border-b border-hair2 py-2.5 text-[12px] last:border-0 hover:text-accent">
                      <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-accent/10 text-[10px] font-semibold text-accent">
                        {i + 1}
                      </span>
                      {t}
                      <span className="ml-auto text-ink3">›</span>
                    </Link>
                  ))}
                </div>
              </Card>
            </div>
          </section>

          <Table head={["平台", "来源", "AVI", "提及率", "首选率", "采样数", "判断"]}>
            {summary.byPlatform.map((p) => (
              <tr key={p.platform} className={trHover}>
                <td className={cn(td, "font-medium text-ink")}>{PLATFORM_NAME[p.platform] || p.platform}</td>
                <td className={td}>
                  <Badge tone={p.source === "live" ? "ok" : p.source === "mock" ? "warn" : "bad"}>
                    {p.source === "live" ? "真实" : p.source === "mock" ? "模拟" : "调用失败"}
                  </Badge>
                </td>
                <td className={cn(td, "tnum font-semibold text-black")}>{p.avi}</td>
                <td className={cn(td, "tnum")}>{p.samples ? `${p.mentionRate}%` : "—"}</td>
                <td className={cn(td, "tnum")}>{p.samples ? `${p.firstRate}%` : "—"}</td>
                <td className={cn(td, "tnum")}>
                  {p.samples ? p.samples : `0（失败 ${p.error}）`}
                </td>
                <td className={td}>
                  {p.source === "error" ? (
                    <Badge tone="bad">数据缺失</Badge>
                  ) : (
                    <Badge tone={p.avi >= 30 ? "ok" : p.avi >= 15 ? "warn" : "bad"}>
                      {p.avi >= 30 ? "主战场" : p.avi >= 15 ? "可提升" : "需关注"}
                    </Badge>
                  )}
                </td>
              </tr>
            ))}
          </Table>

          <Card flush>
            <div className="px-[18px] pt-[15px]">
              <CardHead
                title="提问矩阵与回答证据"
                sub={`共 ${results.length} 条（每条取最优平台），点击查看 AI 回答原文`}
              />
            </div>
            <div className="mt-3 w-full overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    {["问题", "意图", "权重", "命中平台", "位次", "准确度", "状态"].map((h) => (
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
                  {results.map((r) => (
                    <tr key={r.id} onClick={() => setActive(r)} className="cursor-pointer border-b border-hair2 hover:bg-[#fbfbfc]">
                      <td className={cn(td, "border-0 font-medium text-ink")}>{r.prompt?.text || "(问题已删除)"}</td>
                      <td className={cn(td, "border-0")}>
                        <Badge tone={r.prompt?.intent === "决策" ? "info" : r.prompt?.intent === "本地" ? "warn" : "default"}>
                          {r.prompt?.intent || "—"}
                        </Badge>
                      </td>
                      <td className={cn(td, "tnum border-0")}>{r.prompt?.weight ?? "—"}</td>
                      <td className={cn(td, "border-0")}>
                        <span className="flex flex-wrap gap-1">
                          {r.platforms.slice(0, 4).map((p) => (
                            <span key={p} className="rounded bg-[#f2f2f4] px-1.5 py-0.5 text-[10px] text-[#4a4a4d]">
                              {PLATFORM_NAME[p] || p}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td className={cn(td, "tnum border-0")}>{r.mention ? `第 ${r.position} 位` : "未提及"}</td>
                      <td className={cn(td, "tnum border-0")}>{Math.round(r.accuracy * 100)}%</td>
                      <td className={cn(td, "border-0")}>
                        <Badge tone={r.mention ? (r.position <= 3 ? "ok" : "info") : "bad"}>
                          {r.mention ? (r.position <= 3 ? "前 3" : "提及") : "未上榜"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                  {!results.length && (
                    <tr>
                      <td colSpan={7} className="px-3.5 py-10 text-center text-[12px] text-ink3">
                        暂无结果
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <Drawer
        open={!!active}
        onClose={() => setActive(null)}
        title={active?.prompt?.text || ""}
        sub={active ? `${PLATFORM_NAME[active.platform] || active.platform} · 位次 ${active.position || "未提及"} · 准确度 ${Math.round(active.accuracy * 100)}%` : ""}
        footer={
          <>
            <Link
              to="/content"
              className="rounded-full bg-accent px-4 py-1.5 text-[12.5px] font-medium text-white hover:bg-[#0077ed]"
            >
              基于此问题生成内容
            </Link>
            <button onClick={() => setActive(null)} className="rounded-full border border-hair bg-white px-3.5 py-1.5 text-[12.5px] hover:bg-[#f6f6f7]">
              关闭
            </button>
          </>
        }
      >
        {active && (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge tone={active.mention ? "ok" : "bad"}>{active.mention ? "已被提及" : "未提及"}</Badge>
              <Badge>位次 {active.position || "—"}</Badge>
              <Badge tone={active.accuracy >= 0.9 ? "ok" : "warn"}>准确度 {Math.round(active.accuracy * 100)}%</Badge>
              <Badge>{PLATFORM_NAME[active.platform] || active.platform}</Badge>
            </div>
            <div className="mt-3.5 rounded-xl border border-hair2 bg-[#fafafb] px-4 py-3.5 text-[12.5px] leading-[1.75] whitespace-pre-wrap text-[#2b2b2e]">
              {active.answer || "（空回答）"}
            </div>
            <div className="mt-4">
              <Note tone="info" title="这是平台原始回答：">
                系统只做解析与计分，不改写内容。位次由回答中出现的顺序推断；准确度按事实卡比对。
              </Note>
            </div>
          </>
        )}
      </Drawer>

      <Drawer
        open={providersOpen}
        onClose={() => setProvidersOpen(false)}
        title="模型接入状态"
        sub="在 server/.env 配置密钥后重启服务；未配置的平台使用模拟数据"
        footer={
          <>
            <button
              onClick={() => void loadProviders()}
              className="rounded-full bg-accent px-4 py-1.5 text-[12.5px] font-medium text-white hover:bg-[#0077ed]"
            >
              刷新状态
            </button>
            <button
              onClick={() => setProvidersOpen(false)}
              className="rounded-full border border-hair bg-white px-3.5 py-1.5 text-[12.5px] hover:bg-[#f6f6f7]"
            >
              关闭
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          {providers.map((p) => (
            <div key={p.key} className="rounded-xl border border-hair p-3">
              <div className="flex flex-wrap items-center gap-2">
                <b className="text-[12.5px] font-medium">{p.name}</b>
                <span className="text-[10.5px] text-ink3">{p.vendor}</span>
                <Badge tone={p.live ? "ok" : "warn"} className="ml-auto">
                  {p.live ? "已配置" : "未配置"}
                </Badge>
              </div>
              <div className="mt-1 font-mono text-[10.5px] text-ink3">{p.model}</div>
              {p.caveat && <div className="mt-1 text-[10.5px] leading-relaxed text-[#9a4a00]">{p.caveat}</div>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => void runTest(p.key)}
                  disabled={!p.live || testing === p.key}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11.5px]",
                    p.live ? "border-hair bg-white hover:bg-[#f6f6f7]" : "border-hair bg-[#f7f7f8] text-ink3"
                  )}
                >
                  {testing === p.key ? "测试中…" : "连通性测试"}
                </button>
                {testOut[p.key] && <span className="text-[10.5px] text-ink2">{testOut[p.key]}</span>}
              </div>
            </div>
          ))}
          {!providers.length && <div className="text-[12px] text-ink3">正在读取…</div>}
        </div>

        <div className="mt-4">
          <Note tone="info" title="配置方式：">
            在 <span className="font-mono">server/.env</span> 写入{" "}
            <span className="font-mono">GEO_DEEPSEEK_KEY=sk-xxx</span>，重启后端即可生效；每个平台支持 _KEY / _BASE / _MODEL 三个变量。
          </Note>
        </div>
      </Drawer>

      <div
        className={cn(
          "fixed bottom-6 left-1/2 z-[200] -translate-x-1/2 rounded-full bg-[rgba(28,28,30,0.94)] px-4 py-2.5 text-[12px] text-white backdrop-blur-md transition-all duration-400",
          msg ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3.5 opacity-0"
        )}
      >
        {msg}
      </div>
    </div>
  );
}
