import { Link } from "react-router-dom";
import { Badge, Bar, Card, CardHead, Kpi, Note, Table, cn, td, trHover } from "../components/ui";
import { fetchOverview, useApi, useSession, type Overview } from "../api";

const PLATFORM_NAME: Record<string, string> = {
  doubao: "豆包",
  deepseek: "DeepSeek",
  kimi: "Kimi",
  yuanbao: "腾讯元宝",
  qwen: "通义 / 夸克",
  wenxin: "文心 / 百度",
};

const TODO_TARGET: Record<string, string> = { 库: "/knowledge", 题: "/diagnosis", 内: "/content" };

const W = 760;
const TOP = 20;
const BOTTOM = 185;
const LEFT = 30;
const RIGHT = 730;

function TrendChart({ points }: { points: { date: string; avi: number }[] }) {
  if (points.length < 2) {
    return (
      <div className="grid h-[210px] place-items-center rounded-lg border border-dashed border-hair text-[12px] text-ink3">
        暂无趋势数据，运行一次诊断后生成
      </div>
    );
  }
  const max = Math.max(40, ...points.map((p) => p.avi)) * 1.15;
  const y = (v: number) => BOTTOM - (v / max) * (BOTTOM - TOP);
  const x = (i: number) => LEFT + (i * (RIGHT - LEFT)) / (points.length - 1);
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.avi).toFixed(1)}`).join(" ");
  const area = `M ${LEFT},${BOTTOM} L ${line.split(" ").join(" L ")} L ${RIGHT},${BOTTOM} Z`;
  const last = points[points.length - 1];

  return (
    <svg viewBox={`0 0 ${W} 210`} width="100%" height="210" role="img" aria-label="AVI 趋势">
      <defs>
        <linearGradient id="fillA" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0071e3" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#0071e3" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.33, 0.66, 1].map((r) => {
        const v = max * r;
        return (
          <g key={r}>
            <line x1={LEFT} y1={y(v)} x2={RIGHT} y2={y(v)} stroke="#ececef" strokeWidth="1" />
            <text x={0} y={y(v) + 3} fill="#a1a1a6" fontSize="9">
              {Math.round(v)}
            </text>
          </g>
        );
      })}
      <path d={area} fill="url(#fillA)" />
      <polyline points={line} fill="none" stroke="#0071e3" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={RIGHT} cy={y(last.avi)} r="4" fill="#0071e3" stroke="#fff" strokeWidth="2" />
    </svg>
  );
}

/** 双轨指标：把「可交付的 C 端口径」与「仅供监控的模型口径」分开摆 */
function DualTrack({
  kpi,
  quadrant,
  lastRun,
}: {
  kpi: { avi: number; aviModel: number | null; aviCend: number | null; samples: number; cendSamples: number };
  quadrant: Overview["quadrant"];
  lastRun: Overview["lastRun"];
}) {
  const modelSrc = !lastRun ? "尚未探测" : lastRun.mode === "live" ? "真实模型 API·C 级" : "模拟引擎·M 级";
  const tone = quadrant.tone === "ok" ? "text-good" : quadrant.tone === "bad" ? "text-bad" : "text-warn";

  return (
    <Card>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.7fr)] lg:gap-0">
        <div className="lg:pr-5">
          <div className="flex items-center gap-1.5">
            <span className="text-[10.5px] font-semibold tracking-[0.07em] text-ink3 uppercase">C 端可见度</span>
            <Badge tone="ok">A 级</Badge>
          </div>
          {kpi.aviCend === null ? (
            <>
              <div className="mt-2 text-[26px] font-semibold tracking-[-0.03em] text-ink3">待取证</div>
              <div className="mt-1.5 text-[11.5px] leading-relaxed text-ink3">
                客户在 AI 网页/App 里实际看到什么，目前无数据。
              </div>
              <Link
                to="/evidence"
                className="mt-2.5 inline-block rounded-full bg-accent px-3 py-1.5 text-[11.5px] font-medium text-white hover:bg-[#0077ed]"
              >
                录入取证 →
              </Link>
            </>
          ) : (
            <>
              <div className="tnum mt-2 text-[34px] leading-none font-semibold tracking-[-0.038em]">
                {kpi.aviCend}
                <small className="ml-1 text-[12.5px] font-medium text-ink3">/100</small>
              </div>
              <div className="mt-1.5 text-[11.5px] text-ink3">样本 {kpi.cendSamples} 条·这是可对外交付的口径</div>
            </>
          )}
        </div>

        <div className="border-hair lg:border-l lg:px-5">
          <div className="flex items-center gap-1.5">
            <span className="text-[10.5px] font-semibold tracking-[0.07em] text-ink3 uppercase">模型倾向</span>
            <Badge tone={lastRun?.mode === "live" ? "info" : "warn"}>{modelSrc}</Badge>
          </div>
          <div className="tnum mt-2 text-[34px] leading-none font-semibold tracking-[-0.038em]">
            {kpi.aviModel ?? <span className="text-[26px] text-ink3">待探测</span>}
            {kpi.aviModel !== null && <small className="ml-1 text-[12.5px] font-medium text-ink3">/100</small>}
          </div>
          <div className="mt-1.5 text-[11.5px] leading-relaxed text-ink3">
            只反映模型记忆与 API 回答，<b className="text-ink2">不含联网搜索与地理位置</b>，不能当作客户可见度。
          </div>
          <div className="mt-1 text-[10.5px] text-ink3">样本 {kpi.samples} 条</div>
        </div>

        <div className="border-hair lg:border-l lg:pl-5">
          <div className="text-[10.5px] font-semibold tracking-[0.07em] text-ink3 uppercase">四象限结论</div>
          <div className={cn("mt-2 text-[15px] font-semibold tracking-[-0.02em]", tone)}>{quadrant.label}</div>
          <div className="mt-1.5 text-[11.5px] leading-relaxed text-ink2">{quadrant.diagnosis}</div>
          <div className="mt-2.5 rounded-lg bg-[#fafafb] px-3 py-2 text-[11.5px] leading-relaxed">
            <b className="font-medium">下一步：</b>
            {quadrant.action}
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const { brand, brandId, loading: meLoading, mode } = useSession();
  const { data, loading, error } = useApi(brandId ? () => fetchOverview(brandId) : null, [brandId]);

  if (meLoading || loading) {
    return (
      <div className="grid place-items-center py-24 text-[12.5px] text-ink3">正在读取工作台数据…</div>
    );
  }

  if (!brandId) {
    return (
      <Card>
        <CardHead title="还没有品牌档案" sub="建档后即可运行第一次 AI 可见度诊断" />
        <div className="mt-4">
          <Link to="/wizard" className="rounded-full bg-accent px-4 py-2 text-[12.5px] font-medium text-white hover:bg-[#0077ed]">
            去建档 →
          </Link>
        </div>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHead title="数据加载失败" sub={error || "未知错误"} />
        <div className="mt-3">
          <Note tone="warn" title="检查后端：">
            确认 <span className="font-mono">server</span> 已启动（<span className="font-mono">node index.js</span>，端口 8002）。
          </Note>
        </div>
      </Card>
    );
  }

  const { kpi, trend, byPlatform, todos, lastRun } = data;
  const effective = byPlatform.length
    ? byPlatform
    : ["doubao", "deepseek", "kimi", "yuanbao", "qwen", "wenxin"].map((k) => ({
        platform: k,
        avi: 0,
        mentionRate: 0,
        firstRate: 0,
        samples: 0,
      }));

  return (
    <div className="enter flex flex-col gap-3.5">
      <DualTrack kpi={data.kpi} quadrant={data.quadrant} lastRun={data.lastRun} />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={mode === "live" ? "ok" : "warn"} dot>
          {mode === "live" ? "真实模型探测" : "模拟探测引擎"}
        </Badge>
        <span className="text-[11.5px] text-ink3">
          {brand?.name} · {brand?.city} · 事实卡 {kpi.facts} 条 · 提问 {kpi.prompts} 条
        </span>
        <div className="ml-auto flex gap-2">
          <Link to="/diagnosis" className="rounded-full bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:bg-[#0077ed]">
            {lastRun ? "查看最新诊断" : "运行首次诊断"}
          </Link>
        </div>
      </div>

      {/* KPI */}
      <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="主口径综合分"
          value={String(kpi.avi)}
          unit="/100"
          delta={`${kpi.aviDelta >= 0 ? "▲" : "▼"} ${Math.abs(kpi.aviDelta)}`}
          deltaTone={kpi.aviDelta >= 0 ? "up" : "down"}
          sub={
            kpi.aviCend !== null
              ? "以 C 端取证为准·日环比"
              : kpi.samples > 0
                ? "以模型探测为准·日环比"
                : "暂无样本·沿用最近一期"
          }
        />
        <Kpi label="品牌识别准确率" value={String(kpi.accuracy)} unit="%" delta={`${kpi.mentionRate}% 提及`} deltaTone="flat" sub="仅统计被提及答案" />
        <Kpi label="答案份额 SoV" value={String(kpi.sov)} unit="%" delta={`首选 ${kpi.firstRate}%`} deltaTone="flat" sub="含竞品提及" />
        <Kpi label="事实卡 / 问题" value={`${kpi.facts}`} unit={`/ ${kpi.prompts}`} delta={lastRun ? "已诊断" : "待诊断"} deltaTone={lastRun ? "up" : "flat"} sub="口径与提问矩阵" />
      </section>

      {/* 趋势 + 待办 */}
      <section className="grid gap-3.5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card flush>
          <div className="px-[18px] pt-[15px]">
            <CardHead
              title="AI 可见度趋势"
              sub={`最近 ${trend.length} 天 · 每日探测后写入`}
              right={<Badge>{lastRun ? `上次 ${new Date(lastRun.finishedAt).toLocaleString("zh-CN", { hour12: false })}` : "尚未诊断"}</Badge>}
            />
          </div>
          <div className="px-[18px] pt-3 pb-4">
            <TrendChart points={trend} />
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[10.5px] text-ink3">
              <span className="flex items-center gap-1">
                <i className="h-2 w-2 rounded-[2px] bg-accent" />
                AVI
              </span>
              <span className="ml-auto">数据来源：每次探测结果写入 metrics_daily</span>
            </div>
          </div>
        </Card>

        <div className="flex flex-col gap-3.5">
          <Card>
            <CardHead title="待办" right={<Badge tone="warn">{todos.length} 项</Badge>} />
            <div className="mt-2.5">
              {todos.map((t) => (
                <div key={t.title} className="flex items-center gap-3 border-b border-hair2 py-2.5 last:border-0">
                  <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg bg-warn/10 text-[10px] font-semibold text-[#9a4a00]">
                    {t.tag}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium">{t.title}</div>
                    <div className="text-[11px] text-ink3">{t.sub}</div>
                  </div>
                  <Link
                    to={TODO_TARGET[t.tag] || "/diagnosis"}
                    className="shrink-0 rounded-full border border-hair bg-white px-2.5 py-1 text-[11.5px] hover:bg-[#f6f6f7]"
                  >
                    处理
                  </Link>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHead title="探测状态" sub={lastRun ? `模式 ${lastRun.mode}` : "未运行"} />
            <div className="mt-2.5">
              {lastRun ? (
                <>
                  <div className="flex items-center gap-2 text-[12px]">
                    <Badge tone={lastRun.status === "done" ? "ok" : "warn"}>{lastRun.status}</Badge>
                    <span className="text-ink3">共 {lastRun.total} 条采样</span>
                  </div>
                  <div className="mt-3">
                    <Bar value={100} tone="good" />
                  </div>
                  <div className="mt-2 text-[11px] text-ink3">
                    {lastRun.mode === "mock"
                      ? "当前为模拟引擎，配置平台密钥后自动切换为真实调用"
                      : "已接入真实模型，结果为平台实际回答"}
                  </div>
                  <Link
                    to="/diagnosis"
                    className="mt-3 block rounded-full bg-accent py-2 text-center text-[12.5px] font-medium text-white hover:bg-[#0077ed]"
                  >
                    查看证据与明细
                  </Link>
                </>
              ) : (
                <>
                  <Note>尚未运行探测。进入诊断页点「开始诊断」，约 10 秒完成 240 条采样。</Note>
                  <Link
                    to="/diagnosis"
                    className="mt-3 block rounded-full bg-accent py-2 text-center text-[12.5px] font-medium text-white hover:bg-[#0077ed]"
                  >
                    去运行诊断
                  </Link>
                </>
              )}
            </div>
          </Card>
        </div>
      </section>

      {/* 分平台 + 意图 */}
      <section className="grid gap-3.5 lg:grid-cols-2">
        <Card>
          <CardHead title="分平台可见度" right={<span className="text-[11.5px] text-ink3">AVI</span>} />
          <div className="mt-3 flex flex-col gap-2.5">
            {effective.map((p) => (
              <div key={p.platform} className="grid grid-cols-[82px_1fr_64px] items-center gap-2">
                <span className="truncate text-[11.5px] text-ink2">{PLATFORM_NAME[p.platform] || p.platform}</span>
                <Bar value={p.avi} tone={p.avi >= 30 ? "accent" : p.avi >= 15 ? "warn" : "bad"} />
                <span className="tnum text-right text-[11.5px]">
                  <b>{p.avi}</b> <span className="text-ink3">{p.samples ? `${p.samples}条` : ""}</span>
                </span>
              </div>
            ))}
          </div>
          {!byPlatform.length && (
            <div className="mt-3">
              <Note>运行诊断后按平台拆分显示。</Note>
            </div>
          )}
        </Card>

        <Card>
          <CardHead title="按意图分层" right={<span className="text-[11.5px] text-ink3">决策型权重 ×3</span>} />
          <div className="mt-3 flex flex-col gap-2.5">
            {(data.byIntent.length
              ? data.byIntent
              : ["认知", "比较", "决策", "口碑", "本地"].map((intent) => ({ intent, avi: 0 }))
            ).map((p) => (
              <div key={p.intent} className="grid grid-cols-[64px_1fr_32px] items-center gap-2">
                <span className="text-[11.5px] text-ink2">{p.intent}</span>
                <Bar value={p.avi} tone={p.intent === "决策" ? "warn" : "accent"} />
                <span className="tnum text-right text-[11.5px] font-semibold">{p.avi}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 text-[11px] leading-relaxed text-ink3">
            决策型与本地型权重为 3，认知型为 1；权重参与 AVI 加权计算。
          </div>
        </Card>
      </section>

      {/* 收录与引用：不再展示示例数据，明细分流到各真实模块 */}
      <Table
        head={["内容标题", "发布媒体", "发布时间", "GEOS", "收录", "AI 引用", ""]}
        foot={
          <div className="flex items-center gap-2 text-[11.5px] text-ink3">
            <Badge tone="info">口径说明</Badge>
            <span>发布明细见媒体分发，搜索收录与曝光见 SEO 曝光率看板</span>
            <Link to="/seo" className="ml-auto rounded-full border border-hair px-2.5 py-1 hover:bg-[#f6f6f7]">
              查看 SEO 曝光率
            </Link>
          </div>
        }
      >
        <tr className={trHover}>
          <td colSpan={7} className={cn(td, "py-8 text-center text-ink3")}>
            暂无逐篇引用数据；接入搜索 API 或录入站长平台数据后，可在 SEO 曝光率看板查看收录与曝光
          </td>
        </tr>
      </Table>
    </div>
  );
}
