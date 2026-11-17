import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Card, CardHead, Note, cn, td, trHover } from "../components/ui";
import { fetchMonitor, useApi, useSession, type MonitorTrendPoint } from "../api";

const PLATFORM_NAME: Record<string, string> = {
  doubao: "豆包",
  deepseek: "DeepSeek",
  kimi: "Kimi",
  qwen: "通义 / 夸克",
  wenxin: "文心 / 百度",
  yuanbao: "腾讯元宝",
};
const pname = (k: string) => PLATFORM_NAME[k] || k;

const RANGES = [7, 30, 90];

/** 主口径的来源必须说准：不能声称“用模型倾向”，而模型倾向实际无数据 */
const SOURCE: Record<string, { text: string; tone: "ok" | "info" | "warn" | "default" }> = {
  cend: { text: "以 C 端取证为准", tone: "ok" },
  model: { text: "以模型探测为准", tone: "info" },
  baseline: { text: "历史基线 · 无新样本", tone: "warn" },
  none: { text: "暂无数据", tone: "default" },
};

/* ---------------- 双轨趋势图（null 断点，不画假 0） ---------------- */
function Trend({ points }: { points: MonitorTrendPoint[] }) {
  const W = 760;
  const H = 200;
  const L = 36;
  const R = 14;
  const T = 14;
  const B = 26;
  const n = points.length;

  const x = (i: number) => L + ((W - L - R) * i) / Math.max(1, n - 1);
  const y = (v: number) => T + (H - T - B) * (1 - v / 100);

  const path = (get: (p: MonitorTrendPoint) => number | null) => {
    const arr = points
      .map((p, i) => ({ i, v: get(p) }))
      .filter((x): x is { i: number; v: number } => x.v !== null && x.v !== undefined);
    if (arr.length < 2) return "";
    return arr.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  };

  /** 只有 1 个数据点时画不出线，改画带白边的圆点，避免用户误以为“没数据” */
  const single = (get: (p: MonitorTrendPoint) => number | null, color: string, label: string) => {
    const arr = points
      .map((p, i) => ({ i, v: get(p) }))
      .filter((z): z is { i: number; v: number } => z.v !== null && z.v !== undefined);
    if (arr.length !== 1) return null;
    const p = arr[0];
    return (
      <g key={label}>
        <circle cx={x(p.i).toFixed(1)} cy={y(p.v).toFixed(1)} r="4.5" fill={color} stroke="#fff" strokeWidth="1.5" />
        <text x={(x(p.i) + 7).toFixed(1)} y={(y(p.v) - 5).toFixed(1)} fontSize="9" fill={color}>
          {label} {p.v}
        </text>
      </g>
    );
  };

  const gridY = [0, 25, 50, 75, 100];
  const labels = [0, Math.floor((n - 1) / 2), n - 1].filter((i, idx, arr) => i >= 0 && arr.indexOf(i) === idx);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="双轨指标趋势">
      {gridY.map((v) => (
        <g key={v}>
          <line x1={L} y1={y(v)} x2={W - R} y2={y(v)} stroke="#ececee" strokeWidth="1" strokeDasharray={v === 0 ? "" : "3 4"} />
          <text x={L - 6} y={y(v) + 3.5} textAnchor="end" fontSize="9" fill="#9a9aa0">
            {v}
          </text>
        </g>
      ))}

      <path d={path((p) => p.avi)} fill="none" stroke="#0071e3" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      <path d={path((p) => p.aviModel)} fill="none" stroke="#b0b0b6" strokeWidth="1.6" strokeDasharray="4 4" />
      <path d={path((p) => p.aviCend)} fill="none" stroke="#00b36b" strokeWidth="2.2" />

      {single((p) => p.aviModel, "#b0b0b6", "模型倾向")}
      {single((p) => p.aviCend, "#00b36b", "C 端")}
      {single((p) => p.avi, "#0071e3", "主口径")}

      {labels.map((i) => (
        <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#9a9aa0">
          {points[i]?.date?.slice(5)}
        </text>
      ))}

      <g transform={`translate(${L + 6}, ${T - 2})`} fontSize="9">
        <circle cx="0" cy="0" r="3" fill="#0071e3" />
        <text x="7" y="3" fill="#6e6e73">
          主口径
        </text>
        <circle cx="52" cy="0" r="3" fill="#b0b0b6" />
        <text x="59" y="3" fill="#6e6e73">
          模型倾向
        </text>
        <circle cx="122" cy="0" r="3" fill="#00b36b" />
        <text x="129" y="3" fill="#6e6e73">
          C 端可见度
        </text>
      </g>
    </svg>
  );
}

export default function Monitor() {
  const { brandId, brand } = useSession();
  const [days, setDays] = useState(30);
  const { data, loading, error } = useApi(brandId ? () => fetchMonitor(brandId, days) : null, [brandId, days]);

  const s = data?.summary;
  const trend = data?.trend || [];
  const points = useMemo(() => trend.filter((t) => t.samples > 0 || t.cendSamples > 0 || t.avi > 0), [trend]);
  const gaps = data?.gaps || [];
  // 指标按天存储：同一天跑多轮只会留一个数据点，趋势需要跨天
  const modelDays = useMemo(() => trend.filter((t) => t.aviModel !== null && t.aviModel !== undefined).length, [trend]);
  const cendDays = useMemo(() => trend.filter((t) => t.aviCend !== null && t.aviCend !== undefined).length, [trend]);

  if (loading) {
    return <div className="grid place-items-center py-24 text-[12.5px] text-ink3">正在汇总监测数据…</div>;
  }
  if (error) {
    return <Note tone="warn" title="读取失败：">{error}</Note>;
  }

  return (
    <div className="enter flex flex-col gap-3.5">
      {/* 范围 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] text-ink3">统计区间</span>
        {RANGES.map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={cn(
              "rounded-full border px-3 py-1 text-[11.5px] transition-colors",
              days === d ? "border-ink bg-ink text-white" : "border-hair bg-white hover:bg-[#f7f7f8]"
            )}
          >
            {d} 天
          </button>
        ))}
        <span className="ml-auto text-[11px] text-ink3">
          {brand?.name}
          {brand?.city ? ` · ${brand.city}` : ""} · 有数据 {s?.points ?? 0} 天{s?.lastDate ? ` · 最近 ${s.lastDate}` : ""}
        </span>
      </div>

      {/* 缺口引导：没数据时告诉用户补什么 */}
      {gaps.length > 0 && (
        <Card>
          <CardHead title="复盘还缺这些数据" sub="没有样本就不下结论；补齐后再看趋势" right={<Badge tone="warn">{gaps.length} 项</Badge>} />
          <div className="mt-2.5 flex flex-col">
            {gaps.map((g) => (
              <div key={g.key} className="flex items-center gap-2.5 border-b border-hair2 py-2 last:border-0">
                <span className="grid h-[16px] w-[16px] shrink-0 place-items-center rounded-full bg-warn/10 text-[9px] text-warn">!</span>
                <span className="text-[12px] text-ink2">{g.label}</span>
                <Link to={g.to} className="ml-auto shrink-0 rounded-full bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#0077ed]">
                  {g.action} →
                </Link>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 三卡 */}
      <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <Card className="p-4!">
          <div className="flex items-center gap-1.5">
            <span className="text-[10.5px] font-semibold tracking-[0.07em] text-ink3 uppercase">主口径</span>
            <Badge tone={SOURCE[s?.source || "none"].tone}>{SOURCE[s?.source || "none"].text}</Badge>
          </div>
          <div className="tnum mt-1.5 text-[30px] leading-none font-semibold">
            {s?.avi ?? "—"}
            {s?.avi !== null && <small className="ml-1 text-[11.5px] font-medium text-ink3">/100</small>}
          </div>
          <div className="mt-1 text-[10.5px] text-ink3">
            {s?.delta === null || s?.delta === undefined
              ? s?.source !== s?.prevSource && s?.source !== "none" && s?.prevSource !== "none"
                ? "口径已切换（基线 → 当前口径），暂不可比"
                : "暂无可比区间"
              : `较上一数据点 ${s.delta >= 0 ? "+" : ""}${s.delta}`}
          </div>
        </Card>

        <Card className="p-4!">
          <div className="text-[10.5px] font-semibold tracking-[0.07em] text-ink3 uppercase">模型倾向（C 级）</div>
          <div className="tnum mt-1.5 text-[30px] leading-none font-semibold text-ink2">
            {s?.aviModel ?? "—"}
            {s?.aviModel !== null && s?.aviModel !== undefined && <small className="ml-1 text-[11.5px] font-medium text-ink3">/100</small>}
          </div>
          <div className="mt-1 text-[10.5px] text-ink3">来自 API 探测，不含联网与地理位置</div>
        </Card>

        <Card className="p-4!">
          <div className="text-[10.5px] font-semibold tracking-[0.07em] text-ink3 uppercase">C 端可见度（A 级）</div>
          <div className="tnum mt-1.5 text-[30px] leading-none font-semibold">
            {s?.aviCend ?? "—"}
            {s?.aviCend !== null && s?.aviCend !== undefined && <small className="ml-1 text-[11.5px] font-medium text-ink3">/100</small>}
          </div>
          <div className="mt-1 text-[10.5px] text-ink3">
            已取证 {data?.cend.total ?? 0} 条样本
            {(data?.cend.total ?? 0) > 0 && (data?.cend.total ?? 0) < 20 && (
              <span className="text-warn"> · 样本偏少，波动大</span>
            )}
          </div>
        </Card>
      </section>

      {/* 趋势 */}
      <Card>
        <CardHead
          title="双轨趋势"
          sub="实线为可交付口径；样本不足的日期不画点；同一天跑多轮只计一个数据点"
          right={<Badge tone="info">{points.length} 天有数据</Badge>}
        />
        <div className="mt-2">
          {points.length > 1 ? (
            <Trend points={points} />
          ) : (
            <div className="py-14 text-center">
              <div className="text-[12.5px] text-ink2">数据点不足，画不出趋势</div>
              <div className="mt-1.5 text-[11px] leading-relaxed text-ink3">
                至少需要 2 个有样本的日期。跑一轮探测或做一轮取证后会出现在这里。
              </div>
            </div>
          )}
        </div>
        {(modelDays < 2 || cendDays < 2) && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-hair2 pt-2 text-[10.5px] leading-relaxed text-ink3">
            {modelDays < 2 && (
              <span>
                模型倾向：{modelDays} 个数据日 · <b className="text-warn">至少需要 2 个不同日期才能看趋势</b>（今天再跑几轮仍只算 1 个点）
              </span>
            )}
            {cendDays < 2 && (
              <span>
                C 端可见度：{cendDays} 个数据日 · 建议明天再做一轮，才能判断是升是降
              </span>
            )}
          </div>
        )}
      </Card>

      {/* 分平台 + 分意图 */}
      <section className="grid gap-3.5 xl:grid-cols-2">
        <Card flush>
          <div className="px-[18px] pt-[15px]">
            <CardHead
              title="分平台表现（模型口径）"
              sub={data?.lastRun ? `最近一轮 ${new Date(data.lastRun.finishedAt).toLocaleString("zh-CN", { hour12: false })}` : "还没有跑过探测"}
              right={data?.lastRun && <Badge tone={data.lastRun.mode === "live" ? "ok" : "warn"}>{data.lastRun.mode === "live" ? "真实 API" : "模拟"}</Badge>}
            />
          </div>
          <div className="mt-3 w-full overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {["平台", "样本", "提及率", "平均位次"].map((h) => (
                    <th key={h} className="border-y border-hair bg-[#fafafb]/70 px-3.5 py-2.5 text-left text-[10px] font-semibold tracking-[0.07em] whitespace-nowrap text-ink3 uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.platforms || []).map((p) => (
                  <tr key={p.platform} className={trHover}>
                    <td className={cn(td, "font-medium text-ink")}>{pname(p.platform)}</td>
                    <td className={cn(td, "tnum")}>{p.samples}</td>
                    <td className={cn(td, "tnum")}>{p.rate}%</td>
                    <td className={cn(td, "tnum")}>{p.avgPosition ?? "—"}</td>
                  </tr>
                ))}
                {!(data?.platforms || []).length && (
                  <tr>
                    <td colSpan={4} className="px-3.5 py-12 text-center text-[12px] text-ink3">
                      还没有探测数据 —— 去
                      <Link to="/diagnosis" className="mx-1 text-accent underline underline-offset-2">
                        AI 全景诊断
                      </Link>
                      跑一轮
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card flush>
          <div className="px-[18px] pt-[15px]">
            <CardHead title="分意图表现（模型口径）" sub="哪个意图最弱，就先补那个方向的内容" />
          </div>
          <div className="mt-3 w-full overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {["意图", "样本", "提及率"].map((h) => (
                    <th key={h} className="border-y border-hair bg-[#fafafb]/70 px-3.5 py-2.5 text-left text-[10px] font-semibold tracking-[0.07em] whitespace-nowrap text-ink3 uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.intents || []).map((i) => (
                  <tr key={i.intent} className={trHover}>
                    <td className={td}>
                      <Badge tone={i.rate >= 60 ? "ok" : i.rate >= 30 ? "info" : "bad"}>{i.intent}</Badge>
                    </td>
                    <td className={cn(td, "tnum")}>{i.samples}</td>
                    <td className={cn(td, "tnum")}>{i.rate}%</td>
                  </tr>
                ))}
                {!(data?.intents || []).length && (
                  <tr>
                    <td colSpan={3} className="px-3.5 py-12 text-center text-[12px] text-ink3">
                      探测后才会有意图维度数据
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      {/* C 端取证摘要 + 轮次 */}
      <section className="grid gap-3.5 xl:grid-cols-2">
        <Card>
          <CardHead
            title="C 端取证摘要"
            sub="A 级证据：决定四象限与对客承诺"
            right={<Link to="/evidence" className="text-[11.5px] text-accent">去取证 →</Link>}
          />
          {(data?.cend.byPlatform || []).length > 0 ? (
            <>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {data!.cend.byPlatform.map((c) => (
                  <div key={c.platform} className="rounded-lg border border-hair2 bg-[#fafafb] px-2 py-2 text-center">
                    <div className="truncate text-[10.5px] text-ink3">{pname(c.platform)}</div>
                    <div className="tnum mt-0.5 text-[15px] font-semibold">{c.count}</div>
                    <div className="text-[10px] text-ink3">提及 {c.rate}%</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-col">
                {data!.cend.recent.slice(0, 4).map((r) => (
                  <div key={r.id} className="flex items-center gap-2 border-b border-hair2 py-1.5 text-[11.5px] last:border-0">
                    <span className="w-14 shrink-0 text-ink3">{pname(r.platform)}</span>
                    <span className="min-w-0 flex-1 truncate text-ink2">{r.prompt}</span>
                    <span className="shrink-0 text-ink3">{r.mention ? `第 ${r.position} 位` : "未提及"}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="mt-3 py-8 text-center">
              <div className="text-[12.5px] text-ink2">还没有 C 端取证</div>
              <div className="mt-1.5 text-[11px] leading-relaxed text-ink3">模型 API 拿到的答案不等于用户在 App 里看到的答案</div>
              <Link to="/evidence" className="mt-3 inline-block rounded-full bg-accent px-3 py-1.5 text-[11.5px] font-medium text-white">
                开始取证 →
              </Link>
            </div>
          )}
        </Card>

        <Card flush>
          <div className="px-[18px] pt-[15px]">
            <CardHead title="探测轮次" sub="同一题库重复跑才能比较；单轮波动只算观察" right={<Badge tone="info">{(data?.runs || []).length} 次</Badge>} />
          </div>
          <div className="mt-3 w-full overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {["时间", "模式", "样本", "状态"].map((h) => (
                    <th key={h} className="border-y border-hair bg-[#fafafb]/70 px-3.5 py-2.5 text-left text-[10px] font-semibold tracking-[0.07em] whitespace-nowrap text-ink3 uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.runs || []).map((r) => (
                  <tr key={r.id} className={trHover}>
                    <td className={cn(td, "tnum whitespace-nowrap")}>{new Date(r.finishedAt || Date.now()).toLocaleString("zh-CN", { hour12: false })}</td>
                    <td className={td}>
                      <Badge tone={r.mode === "live" ? "ok" : "warn"}>{r.mode === "live" ? "真实" : "模拟"}</Badge>
                    </td>
                    <td className={cn(td, "tnum")}>{r.total}</td>
                    <td className={td}>{r.status === "done" ? "完成" : r.status}</td>
                  </tr>
                ))}
                {!(data?.runs || []).length && (
                  <tr>
                    <td colSpan={4} className="px-3.5 py-12 text-center text-[12px] text-ink3">
                      还没有探测轮次
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      <div className="text-[10.5px] leading-relaxed text-ink3">
        口径提醒：指标按天存储，同一天多轮探测只产生一个数据点；因此“趋势”指<b className="text-ink2">连续两个数据日同向</b>，单轮波动只作观察；C 级（API）数据不得写入对外承诺。
      </div>
    </div>
  );
}
