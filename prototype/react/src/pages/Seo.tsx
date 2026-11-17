import { useEffect, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { Badge, Card, CardHead, Kpi, Note, cn, td, trHover } from "../components/ui";
import {
  createSeoKeyword,
  createSeoRecord,
  deleteSeoKeyword,
  deleteSeoRecord,
  fetchSeoKeywordHistory,
  fetchSeoOverview,
  fetchSeoPositions,
  importSeoCsv,
  runSeoScan,
  saveSeoPositions,
  updateSeoKeyword,
  useApi,
  useSession,
  type SeoCheck,
  type SeoHistoryPoint,
  type SeoTrendPoint,
} from "../api";

/** 本次诊断的目标站点（可在页面上改） */
const DEFAULT_TARGET = "http://159.75.21.251:3000";
const RANGES = [7, 30, 90];

const SOURCE: Record<string, { text: string; tone: "ok" | "info" | "warn" | "default" }> = {
  live: { text: "搜索 API 实测", tone: "ok" },
  manual: { text: "人工核查 / 录入", tone: "info" },
  site: { text: "站点真抓", tone: "info" },
  scan: { text: "站点扫描", tone: "info" },
  none: { text: "暂无数据", tone: "default" },
  unconfigured: { text: "未配置", tone: "warn" },
  error: { text: "查询失败", tone: "warn" },
};
const srcOf = (k: string) => SOURCE[k] || SOURCE.none;

const LEVEL: Record<SeoCheck["level"], { icon: string; cls: string; bg: string; label: string }> = {
  pass: { icon: "✓", cls: "text-[#1a7a45]", bg: "bg-good/10", label: "通过" },
  warn: { icon: "!", cls: "text-[#9a4a00]", bg: "bg-warn/10", label: "待改进" },
  fail: { icon: "×", cls: "text-[#bf0010]", bg: "bg-bad/8", label: "未通过" },
};

const inputCls =
  "h-9 rounded-lg border border-hair bg-[#fbfbfc] px-2.5 text-[12px] outline-none focus:border-accent/60 focus:bg-white focus:ring-3 focus:ring-accent/12";
const btnCls = "h-9 rounded-lg px-4 text-[12px] font-medium text-white bg-accent hover:bg-[#0077ed] disabled:cursor-not-allowed disabled:bg-accent/50";

const num = (v: number | null, digits = 0) => (v === null || v === undefined ? "—" : v.toFixed(digits));
const numOrNull = (s: string) => (s.trim() === "" ? undefined : Number(s));

/* ---------------- 曝光率趋势（null 断点，不画假 0） ---------------- */
function Trend({ points }: { points: SeoTrendPoint[] }) {
  const W = 760;
  const H = 180;
  const L = 36;
  const R = 14;
  const T = 14;
  const B = 26;
  const n = points.length;
  const x = (i: number) => L + ((W - L - R) * i) / Math.max(1, n - 1);
  const y = (v: number) => T + (H - T - B) * (1 - v / 100);
  const arr = points
    .map((p, i) => ({ i, v: p.exposureRate }))
    .filter((z): z is { i: number; v: number } => z.v !== null && z.v !== undefined);
  const path = arr.length > 1
    ? arr.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ")
    : "";
  const labels = [0, Math.floor((n - 1) / 2), n - 1].filter((i, idx, a) => i >= 0 && a.indexOf(i) === idx);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="SEO 曝光率趋势">
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}>
          <line x1={L} y1={y(v)} x2={W - R} y2={y(v)} stroke="#ececee" strokeWidth="1" strokeDasharray={v === 0 ? "" : "3 4"} />
          <text x={L - 6} y={y(v) + 3.5} textAnchor="end" fontSize="9" fill="#9a9aa0">{v}</text>
        </g>
      ))}
      {path && <path d={path} fill="none" stroke="#0071e3" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />}
      {arr.length === 1 && (
        <g>
          <circle cx={x(arr[0].i)} cy={y(arr[0].v)} r="4.5" fill="#0071e3" stroke="#fff" strokeWidth="1.5" />
          <text x={x(arr[0].i) + 7} y={y(arr[0].v) - 5} fontSize="9" fill="#0071e3">{arr[0].v}%</text>
        </g>
      )}
      {labels.map((i) => (
        <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#9a9aa0">
          {points[i]?.date?.slice(5)}
        </text>
      ))}
    </svg>
  );
}

export default function Seo() {
  const { brandId, me } = useSession();
  const canWrite = me?.permissions?.write !== false;
  const [days, setDays] = useState(30);
  const [url, setUrl] = useState(DEFAULT_TARGET);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [engine, setEngine] = useState("google");
  const [showRecord, setShowRecord] = useState(false);
  const [rec, setRec] = useState({
    date: new Date().toISOString().slice(0, 10),
    indexedPages: "", impressions: "", clicks: "", avgPosition: "", exposureRate: "", note: "",
  });
  const [historyId, setHistoryId] = useState("");
  const [historyKeyword, setHistoryKeyword] = useState("");
  const [historyPoints, setHistoryPoints] = useState<SeoHistoryPoint[]>([]);
  const [posDate, setPosDate] = useState(new Date().toISOString().slice(0, 10));
  const [posValues, setPosValues] = useState<Record<string, string>>({});
  const [csvText, setCsvText] = useState("");
  const [csvName, setCsvName] = useState("");

  const { data, loading, error: loadError, reload } = useApi(
    brandId ? () => fetchSeoOverview(brandId, days) : null,
    [brandId, days]
  );
  const posQ = useApi(brandId ? () => fetchSeoPositions(brandId, posDate) : null, [brandId, posDate]);

  useEffect(() => {
    if (data?.target.url) setUrl(data.target.url);
  }, [data?.target.url]);

  useEffect(() => {
    if (!posQ.data) return;
    const next: Record<string, string> = {};
    for (const it of posQ.data.items) next[it.keywordId] = it.position === null ? "" : String(it.position);
    setPosValues(next);
  }, [posQ.data]);

  function flash(m: string) {
    setToast(m);
    window.setTimeout(() => setToast(null), 3200);
  }

  async function runScan() {
    if (!brandId || busy) return;
    if (!url.trim()) return flash("请先填写目标网址");
    setBusy(true);
    setError("");
    try {
      const r = await runSeoScan(brandId, url.trim());
      setUrl(r.scan.url);
      flash(
        `扫描完成：${r.scan.score} 分（${r.scan.passed}/${r.scan.total} 项通过）· ` +
          (r.mode === "live" ? `实测 ${r.checked} 个关键词，${r.errors} 个失败` : r.hint)
      );
      void reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "扫描失败");
    } finally {
      setBusy(false);
    }
  }

  async function addKeyword() {
    if (!brandId || !keyword.trim()) return flash("请填写关键词");
    try {
      await createSeoKeyword(brandId, { keyword: keyword.trim(), engine });
      setKeyword("");
      flash("关键词已添加");
      void reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "添加失败");
    }
  }

  async function removeKeyword(id: string) {
    if (!brandId) return;
    try {
      await deleteSeoKeyword(brandId, id);
      flash("关键词已删除");
      void reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "删除失败");
    }
  }

  async function toggleKeyword(id: string, enabled: boolean) {
    if (!brandId) return;
    try {
      await updateSeoKeyword(brandId, id, enabled);
      flash(enabled ? "关键词已启用" : "关键词已停用（不进扫描分母）");
      void reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "切换失败");
    }
  }

  async function showHistory(id: string, kw: string) {
    if (!brandId) return;
    try {
      const r = await fetchSeoKeywordHistory(brandId, id);
      setHistoryId(id);
      setHistoryKeyword(kw || r.keyword);
      setHistoryPoints(r.points);
    } catch (e) {
      flash(e instanceof Error ? e.message : "读取历史失败");
    }
  }

  async function removeRecord(date: string) {
    if (!brandId) return;
    try {
      await deleteSeoRecord(brandId, date);
      flash(`已删除 ${date} 的记录`);
      void reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "删除失败");
    }
  }

  async function savePositions() {
    if (!brandId) return;
    const items = posQ.data?.items || [];
    if (!items.length) return flash("没有启用的关键词");
    const positions = items.map((it) => {
      const raw = (posValues[it.keywordId] ?? "").trim();
      return { keywordId: it.keywordId, position: raw === "" ? null : Number(raw) };
    });
    try {
      const r = await saveSeoPositions(brandId, posDate, positions);
      flash(
        `已保存 ${r.written} 个位次 · 曝光率 ${r.exposureRate === null ? "—" : `${r.exposureRate}%`}（${r.exposed}/${r.samples}）`
      );
      void reload();
      void posQ.reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "位次保存失败");
    }
  }

  async function onCsvFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setCsvName(f.name);
    setCsvText(await f.text());
    flash(`已读取 ${f.name}，点「导入」写入`);
  }

  async function importCsv() {
    if (!brandId || !csvText.trim()) return flash("请先选择 CSV 文件");
    try {
      const r = await importSeoCsv(brandId, csvText);
      flash(`导入完成：成功 ${r.imported} 行，跳过 ${r.skipped} 行${r.errors.length ? `（${r.errors[0]}）` : ""}`);
      void reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "导入失败");
    }
  }

  async function submitRecord() {
    if (!brandId) return;
    try {
      const r = await createSeoRecord(brandId, {
        date: rec.date,
        indexedPages: numOrNull(rec.indexedPages),
        impressions: numOrNull(rec.impressions),
        clicks: numOrNull(rec.clicks),
        avgPosition: numOrNull(rec.avgPosition),
        exposureRate: numOrNull(rec.exposureRate),
        note: rec.note || "手工录入（站长平台导出）",
      });
      flash(`已录入 ${r.date} 的真实数据`);
      setShowRecord(false);
      void reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "录入失败");
    }
  }

  if (loading && !data) return <div className="enter p-6 text-[13px] text-ink3">正在汇总 SEO 曝光数据…</div>;
  if (loadError && !data) return <Note tone="warn" title="读取失败：">{loadError}</Note>;

  const s = data?.summary;
  const rateSrc = srcOf(s?.exposureSource || "none");
  const idxSrc = srcOf(s?.indexedSource || "none");
  const scan = data?.scan || null;
  const points = data?.trend || [];
  const hasTrend = points.some((p) => p.exposureRate !== null);

  return (
    <div className="enter flex flex-col gap-3.5">
      <Note tone="info" title="口径说明：">
        这里的「曝光率」= 进入搜索结果前 20 位的监控关键词数 ÷ 有效关键词数。数据分三路：
        <b className="mx-1">站点真抓</b>（无需 Key，判断能不能被抓）、
        <b className="mx-1">搜索 API 实测</b>（需配置 Key，给关键词排名与收录数）、
        <b className="mx-1">站长平台录入</b>（GSC / 百度站长导出的展现量）。
        没有数据的字段一律显示「—」，不编造 0，也不把站点体检分当成搜索曝光率。
      </Note>

      {/* 数据源状态 */}
      <Card>
        <CardHead
          title="数据源状态"
          sub="当前看板里哪些是真实数据、哪些还没接上"
          right={
            <Badge tone={data?.sources.serp.live ? "ok" : "warn"} dot>
              {data?.sources.serp.live ? "搜索 API 已接入" : "搜索 API 未配置"}
            </Badge>
          }
        />
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11.5px]">
          <Badge tone="info">站点真抓 · 始终可用</Badge>
          <Badge tone={data?.sources.manual.records ? "ok" : "default"}>
            站长平台录入 {data?.sources.manual.records || 0} 条
          </Badge>
          <span className="text-ink3">
            搜索源：{data?.sources.serp.live ? `${data.sources.serp.provider} / ${data.sources.serp.engine}` : "未配置 GEO_SEO_SEARCH_KEY"}
          </span>
          <span className="ml-auto text-ink3">目标站点 {data?.target.url || "未设置"}</span>
        </div>
        <div className="mt-2 text-[10.5px] leading-relaxed text-ink3">
          定时扫描：
          {data?.schedule.enabled
            ? `每 ${data.schedule.intervalMin} 分钟自动执行一次`
            : "未开启（在 server/.env 配置 GEO_SEO_SCAN_INTERVAL_MIN 后重启后端）"}
          {data?.schedule.lastAutoAt
            ? ` · 最近一次 ${new Date(data.schedule.lastAutoAt).toLocaleString("zh-CN", { hour12: false })}`
            : ""}
          {data?.schedule.lastAutoError ? ` · 最近错误：${data.schedule.lastAutoError}` : ""}
        </div>
      </Card>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Kpi
          label="SEO 曝光率"
          value={num(s?.exposureRate ?? null, 1)}
          unit="%"
          sub={`${s?.keywordsExposed ?? 0}/${s?.keywordsTotal ?? 0} 个关键词 · ${rateSrc.text}`}
        />
        <Kpi label="收录页面" value={num(s?.indexedPages ?? null)} unit="页" sub={idxSrc.text} />
        <Kpi
          label="展现量 / 点击"
          value={`${num(s?.impressions ?? null)} / ${num(s?.clicks ?? null)}`}
          sub={s?.ctr !== null && s?.ctr !== undefined ? `CTR ${(s.ctr * 100).toFixed(2)}%` : "暂无展现数据"}
        />
        <Kpi
          label="平均排名"
          value={num(s?.avgPosition ?? null, 1)}
          sub={s?.asOf ? `截至 ${s.asOf}` : "暂无排名数据"}
        />
      </div>

      {/* 趋势 */}
      <Card>
        <CardHead
          title="曝光率趋势"
          sub="按天一个点；口径不同的两天不做同比，单点画圆点而不是假趋势线"
          right={
            <div className="flex gap-1">
              {RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => setDays(r)}
                  className={cn(
                    "rounded-md px-2 py-1 text-[11px]",
                    days === r ? "bg-accent/10 font-medium text-accent" : "text-ink3 hover:bg-[#f2f2f4]"
                  )}
                >
                  {r} 天
                </button>
              ))}
            </div>
          }
        />
        <div className="mt-3">
          {hasTrend ? (
            <Trend points={points} />
          ) : (
            <div className="grid h-[150px] place-items-center rounded-lg bg-[#fbfbfc] text-[12px] text-ink3">
              暂无曝光率数据 —— 接入搜索 API 或手工录入站长平台数据后才会画点
            </div>
          )}
        </div>
        {s?.note && <div className="mt-2 text-[10.5px] text-ink3">最近一条数据备注：{s.note}</div>}
      </Card>

      {/* 缺口清单 */}
      {data?.gaps.length ? (
        <Card>
          <CardHead title="还差什么" sub="按优先级处理，前两项决定了曝光率能不能算出来" />
          <div className="mt-3 flex flex-col gap-2">
            {data.gaps.map((g) => (
              <div key={g.key} className="flex items-start gap-2 rounded-lg border border-hair2 px-3 py-2">
                <Badge tone="warn">待办</Badge>
                <div className="min-w-0 flex-1">
                  <b className="text-[12px] font-medium">{g.label}</b>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-ink2">{g.action}</div>
                </div>
                {g.to && (
                  <Link to={g.to} className="shrink-0 text-[11px] text-accent hover:underline">
                    去处理 →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* 站点扫描 */}
      <Card>
        <CardHead
          title="站点可索引性扫描"
          sub="真抓首页 / robots.txt / sitemap.xml 与三个搜索爬虫 UA；这是曝光的前提，不是曝光率本身"
          right={scan && <Badge tone={scan.score >= 75 ? "ok" : scan.score >= 50 ? "warn" : "bad"}>{scan.score} 分 · {scan.grade}</Badge>}
        />
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void runScan()}
            placeholder="填写目标网址，例如 http://159.75.21.251:3000"
            className={cn(inputCls, "h-10 flex-1")}
          />
          <button onClick={() => void runScan()} disabled={busy || !canWrite} className={cn(btnCls, "h-10 shrink-0 px-5")}>
            {busy ? "扫描中…" : "开始扫描"}
          </button>
        </div>
        <div className="mt-2 text-[10.5px] text-ink3">
          只读公开页面，不会修改目标站点；未配置搜索 API 时只出可索引性结论，不生成关键词排名
        </div>
        {error && (
          <div className="mt-3">
            <Note tone="warn" title="扫描失败：">{error}</Note>
          </div>
        )}
        {scan && (
          <div className="mt-4">
            <div className="flex flex-wrap items-end gap-3 border-b border-hair pb-3">
              <div>
                <div className="text-[10.5px] font-semibold tracking-[0.07em] text-ink3 uppercase">可索引性</div>
                <div className="tnum mt-1 text-[34px] leading-none font-semibold tracking-[-0.035em]">
                  {scan.score}
                  <small className="ml-1 text-[12.5px] font-medium text-ink3">/100 · {scan.passed}/{scan.total} 项</small>
                </div>
              </div>
              <div className="ml-auto text-right text-[10.5px] leading-relaxed text-ink3">
                <div>{scan.url}</div>
                {scan.createdAt && <div>扫描时间 {new Date(scan.createdAt).toLocaleString("zh-CN", { hour12: false })}</div>}
              </div>
            </div>
            <div className="mt-2 flex flex-col">
              {scan.checks.map((c) => {
                const lv = LEVEL[c.level] || LEVEL.warn;
                return (
                  <div key={c.key} className="flex items-start gap-2.5 border-b border-hair2 py-2.5 last:border-0">
                    <span className={cn("mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[10px]", lv.bg, lv.cls)}>
                      {lv.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <b className="text-[12.5px] font-medium">{c.label}</b>
                        <span className={cn("text-[10.5px]", lv.cls)}>{lv.label}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] leading-relaxed text-ink2">{c.detail}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      {/* 关键词 */}
      <Card flush>
        <div className="px-4 pt-4 pb-3">
          <CardHead
            title="监控关键词与排名"
            sub="位次来自搜索 API 实测；未配置数据源时显示「未检测」，不显示假排名"
            right={<Badge tone="default">{data?.keywords.length || 0} 个词</Badge>}
          />
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void addKeyword()}
              placeholder="新增关键词，例如 AgentFlow 工作流编排"
              className={cn(inputCls, "flex-1")}
            />
            <select value={engine} onChange={(e) => setEngine(e.target.value)} className={cn(inputCls, "w-28")}>
              <option value="google">Google</option>
              <option value="baidu">百度</option>
              <option value="bing">Bing</option>
            </select>
            <button onClick={() => void addKeyword()} disabled={!canWrite} className={btnCls}>
              添加
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-hair bg-[#fafafb] text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">
                <th className="px-3.5 py-2.5">关键词</th>
                <th className="px-3.5 py-2.5">引擎</th>
                <th className="px-3.5 py-2.5">位次</th>
                <th className="px-3.5 py-2.5">状态</th>
                <th className="px-3.5 py-2.5">来源</th>
                <th className="px-3.5 py-2.5">检测日</th>
                <th className="px-3.5 py-2.5">启用</th>
                <th className="px-3.5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {data?.keywords.map((k) => (
                <tr key={k.id} className={trHover}>
                  <td className={cn(td, "font-medium")}>{k.keyword}</td>
                  <td className={td}>{k.engine}</td>
                  <td className={cn(td, "tnum")}>
                    {k.position === null ? "—" : k.position === 0 ? "未进前 20" : `第 ${k.position} 位`}
                  </td>
                  <td className={td}>
                    {k.error ? (
                      <Badge tone="bad">查询失败</Badge>
                    ) : k.exposed ? (
                      <Badge tone="ok">已曝光</Badge>
                    ) : k.source === "none" ? (
                      <Badge tone="default">未检测</Badge>
                    ) : (
                      <Badge tone="warn">未进榜</Badge>
                    )}
                  </td>
                  <td className={td}><Badge tone={srcOf(k.source).tone}>{srcOf(k.source).text}</Badge></td>
                  <td className={cn(td, "tnum")}>{k.checkedAt || "—"}</td>
                  <td className={td}>
                    <button
                      onClick={() => void toggleKeyword(k.id, !k.enabled)}
                      disabled={!canWrite}
                      className={cn(
                        "rounded-md px-2 py-1 text-[10.5px] disabled:opacity-40",
                        k.enabled ? "bg-good/10 text-[#1a7a45]" : "bg-[#f2f2f4] text-ink3"
                      )}
                    >
                      {k.enabled ? "已启用" : "已停用"}
                    </button>
                  </td>
                  <td className={td}>
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => void showHistory(k.id, k.keyword)} className="text-[11px] text-accent hover:underline">
                        历史
                      </button>
                      <button
                        onClick={() => void removeKeyword(k.id)}
                        disabled={!canWrite}
                        className="text-[11px] text-ink3 hover:text-[#bf0010] disabled:opacity-40"
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!data?.keywords.length && (
                <tr>
                  <td colSpan={8} className={cn(td, "py-8 text-center text-ink3")}>
                    还没有关键词，先在上方添加
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 人工录入逐词位次（零 Key 通道） */}
      <Card>
        <CardHead
          title="人工录入关键词位次"
          sub="不用搜索 API：自己打开搜索引擎逐词看，把位次填进来，系统自动算曝光率与趋势"
          right={<Badge tone="info">人工核查 · manual</Badge>}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[11.5px] text-ink3">
            日期
            <input type="date" value={posDate} onChange={(e) => setPosDate(e.target.value)} className={cn(inputCls, "w-36")} />
          </label>
          <button onClick={() => void savePositions()} disabled={!canWrite} className={btnCls}>
            保存当天位次
          </button>
          <span className="text-[10.5px] text-ink3">1–20 计入曝光；0 = 未进前 20；留空 = 未检测，不计入分母</span>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-hair bg-[#fafafb] text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">
                <th className="px-3.5 py-2.5">关键词</th>
                <th className="px-3.5 py-2.5">位次</th>
                <th className="px-3.5 py-2.5">当前来源</th>
              </tr>
            </thead>
            <tbody>
              {posQ.data?.items.map((it) => (
                <tr key={it.keywordId} className={trHover}>
                  <td className={cn(td, "font-medium")}>{it.keyword}</td>
                  <td className={td}>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={posValues[it.keywordId] ?? ""}
                      onChange={(e) => setPosValues((v) => ({ ...v, [it.keywordId]: e.target.value }))}
                      placeholder="留空 = 未检测"
                      className={cn(inputCls, "tnum w-32")}
                    />
                  </td>
                  <td className={td}><Badge tone={srcOf(it.source).tone}>{srcOf(it.source).text}</Badge></td>
                </tr>
              ))}
              {!posQ.data?.items.length && (
                <tr>
                  <td colSpan={3} className={cn(td, "py-6 text-center text-ink3")}>没有启用的关键词</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 单词位次历史 */}
      {historyId && (
        <Card>
          <CardHead
            title={`位次历史 · ${historyKeyword}`}
            sub="位次越小越好；空位次表示未进前 20 或该次查询失败，不计入曝光率"
            right={
              <button onClick={() => setHistoryId("")} className="text-[11px] text-accent hover:underline">
                关闭
              </button>
            }
          />
          {historyPoints.length ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-[12px]">
                <thead>
                  <tr className="border-b border-hair bg-[#fafafb] text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">
                    <th className="px-3.5 py-2.5">日期</th>
                    <th className="px-3.5 py-2.5">位次</th>
                    <th className="px-3.5 py-2.5">结果</th>
                    <th className="px-3.5 py-2.5">来源</th>
                    <th className="px-3.5 py-2.5">落地页</th>
                  </tr>
                </thead>
                <tbody>
                  {historyPoints.map((p) => (
                    <tr key={`${p.date}-${p.url}`} className={trHover}>
                      <td className={cn(td, "tnum")}>{p.date}</td>
                      <td className={cn(td, "tnum")}>
                        {p.position === null ? "—" : p.position === 0 ? "未进前 20" : `第 ${p.position} 位`}
                      </td>
                      <td className={td}>
                        {p.error ? <Badge tone="bad">{p.error}</Badge> : p.exposed ? <Badge tone="ok">已曝光</Badge> : <Badge tone="warn">未进榜</Badge>}
                      </td>
                      <td className={td}><Badge tone={srcOf(p.source).tone}>{srcOf(p.source).text}</Badge></td>
                      <td className={cn(td, "max-w-[220px] truncate")}>
                        {p.url ? (
                          <a href={p.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                            {p.title || p.url}
                          </a>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-3 rounded-lg bg-[#fbfbfc] px-3 py-6 text-center text-[12px] text-ink3">
              还没有该关键词的实测记录；配置搜索 API 并扫描后才会产生位次
            </div>
          )}
        </Card>
      )}

      {/* 手工录入 */}
      <Card>
        <CardHead
          title="录入站长平台真实数据"
          sub="Google Search Console / 百度搜索资源平台导出的展现量、点击、收录数；录入后按天覆盖"
          right={
            <button onClick={() => setShowRecord((v) => !v)} className="text-[11px] text-accent hover:underline">
              {showRecord ? "收起" : "展开表单"}
            </button>
          }
        />
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-[#fbfbfc] px-3 py-2.5">
          <input type="file" accept=".csv,text/csv" onChange={(e) => void onCsvFile(e)} className="text-[11px] text-ink2" />
          <span className="text-[10.5px] text-ink3">{csvName || "选择 GSC / 百度站长导出的 CSV"}</span>
          <button onClick={() => void importCsv()} disabled={!canWrite || !csvText} className={cn(btnCls, "ml-auto")}>
            导入 CSV
          </button>
        </div>
        <div className="mt-1.5 text-[10.5px] leading-relaxed text-ink3">
          列名兼容中英文：日期 / date、展现量 / impressions、点击数 / clicks、点击率 / ctr、平均排名 / avgPosition、
          收录数 / indexedPages、曝光率 / exposureRate、备注 / note。按天合并，只覆盖 CSV 里有的列，不会清掉已录入的位次。
        </div>
        {showRecord && (
          <div className="mt-3 flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
              {([
                ["date", "日期"],
                ["indexedPages", "收录页面数"],
                ["impressions", "展现量"],
                ["clicks", "点击数"],
                ["avgPosition", "平均排名"],
                ["exposureRate", "曝光率 %"],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex flex-col gap-1 text-[10.5px] text-ink3">
                  {label}
                  <input
                    type={key === "date" ? "date" : "number"}
                    step="any"
                    value={rec[key]}
                    onChange={(e) => setRec((v) => ({ ...v, [key]: e.target.value }))}
                    className={inputCls}
                  />
                </label>
              ))}
            </div>
            <input
              value={rec.note}
              onChange={(e) => setRec((v) => ({ ...v, note: e.target.value }))}
              placeholder="备注：数据来源与统计口径，例如「GSC 2026-11 导出」"
              className={inputCls}
            />
            <div className="flex items-center gap-2">
              <button onClick={() => void submitRecord()} disabled={!canWrite} className={btnCls}>
                保存真实数据
              </button>
              <span className="text-[10.5px] text-ink3">留空的字段保持「无数据」，不会写成 0</span>
            </div>
          </div>
        )}
        {(data?.records?.length ?? 0) > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-hair bg-[#fafafb] text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">
                  <th className="px-3.5 py-2.5">日期</th>
                  <th className="px-3.5 py-2.5">来源</th>
                  <th className="px-3.5 py-2.5">曝光率</th>
                  <th className="px-3.5 py-2.5">收录</th>
                  <th className="px-3.5 py-2.5">展现 / 点击</th>
                  <th className="px-3.5 py-2.5">备注</th>
                  <th className="px-3.5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {data?.records.map((r) => (
                  <tr key={r.date} className={trHover}>
                    <td className={cn(td, "tnum")}>{r.date}</td>
                    <td className={td}><Badge tone={srcOf(r.source).tone}>{srcOf(r.source).text}</Badge></td>
                    <td className={cn(td, "tnum")}>{r.exposureRate === null ? "—" : `${r.exposureRate.toFixed(1)}%`}</td>
                    <td className={cn(td, "tnum")}>{r.indexedPages ?? "—"}</td>
                    <td className={cn(td, "tnum")}>{r.impressions ?? "—"} / {r.clicks ?? "—"}</td>
                    <td className={cn(td, "max-w-[240px] truncate")} title={r.note}>{r.note || "—"}</td>
                    <td className={td}>
                      <button
                        onClick={() => void removeRecord(r.date)}
                        disabled={!canWrite}
                        className="text-[11px] text-ink3 hover:text-[#bf0010] disabled:opacity-40"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="pb-2 text-[10.5px] leading-relaxed text-ink3">
        口径备注：曝光率只统计成功返回的关键词，接口失败的样本从分母剔除；同日多轮只保留一个日数据点；
        口径切换（如从手工录入切到 API 实测）时不计算涨跌，避免把数据源变化当成真实增长。
      </div>

      {toast && (
        <div className="pointer-events-none fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-[#1d1d1f] px-4 py-2.5 text-[12px] text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
