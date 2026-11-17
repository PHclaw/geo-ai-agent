import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Card, CardHead, Note, cn, td, trHover } from "../components/ui";
import {
  deleteEvidence,
  fetchEvidence,
  fetchEvidenceQueue,
  submitEvidence,
  useApi,
  useSession,
  type EvidenceQueue,
  type EvidenceResult,
} from "../api";

type PlatformQueue = EvidenceQueue["platforms"][number];
type PendingPrompt = PlatformQueue["pending"][number];

/** 同步复制：不依赖 secure context 与权限，先于开窗执行，避免新窗口抢焦点导致写入被拒 */
function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

const fieldCls =
  "h-10 w-full rounded-lg border border-hair bg-[#fbfbfc] px-3 text-[12.5px] outline-none transition-all duration-200 focus:border-accent/60 focus:bg-white focus:ring-3 focus:ring-accent/12";

const INTENT_TONE: Record<string, "info" | "warn" | "purple" | "default"> = {
  决策: "info",
  本地: "warn",
  比较: "purple",
  口碑: "default",
  认知: "default",
};

export default function Evidence() {
  const { brandId, brand, loading: meLoading } = useSession();
  const { data: queue, loading: queueLoading, reload: reloadQueue } = useApi(
    brandId ? () => fetchEvidenceQueue(brandId, 12) : null,
    [brandId]
  );
  const { data: evidence, loading, reload } = useApi(brandId ? () => fetchEvidence(brandId) : null, [brandId]);

  const [activeKey, setActiveKey] = useState("");
  const [platform, setPlatform] = useState("doubao");
  const [promptId, setPromptId] = useState("");
  const [answer, setAnswer] = useState("");
  const [screenshotUrl, setScreenshotUrl] = useState("");
  const [location, setLocation] = useState(brand?.city || "");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<EvidenceResult | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const answerRef = useRef<HTMLTextAreaElement | null>(null);

  const platforms = queue?.platforms || [];
  const active = useMemo(
    () => platforms.find((p) => p.key === activeKey) || platforms[0] || null,
    [platforms, activeKey]
  );
  const currentPrompt = useMemo(() => {
    if (!platform || !promptId) return null;
    for (const p of platforms) {
      const hit = p.pending.find((x) => x.id === promptId);
      if (hit) return hit;
    }
    return null;
  }, [platforms, platform, promptId]);

  const list = evidence || [];

  function flash(m: string) {
    setToast(m);
    window.setTimeout(() => setToast(null), 3200);
  }

  useEffect(() => {
    if (!location && brand?.city) setLocation(brand.city);
  }, [brand, location]);

  // 从平台页面切回来时，自动聚焦到答案框，避免“打开就忘了回来”
  useEffect(() => {
    function focusBack() {
      if (document.visibilityState === "visible" && promptId && !answer) {
        answerRef.current?.focus();
      }
    }
    document.addEventListener("visibilitychange", focusBack);
    window.addEventListener("focus", focusBack);
    return () => {
      document.removeEventListener("visibilitychange", focusBack);
      window.removeEventListener("focus", focusBack);
    };
  }, [promptId, answer]);

  /** 一键去提问：**先复制、后开窗**（开窗会抢焦点，先复制才写得进剪贴板） */
  function openAndCopy(p: PlatformQueue, q: PendingPrompt) {
    const copied = legacyCopy(q.text);

    if (p.web) window.open(p.web, "_blank", "noopener,noreferrer");

    setPlatform(p.key);
    setPromptId(q.id);
    setActiveKey(p.key);

    if (copied) {
      flash(`已打开 ${p.name}，问题已复制——切到该页 Ctrl+V 提问`);
    } else if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(q.text).then(
        () => flash(`已打开 ${p.name}，问题已复制——切到该页 Ctrl+V 提问`),
        () => flash(`已打开 ${p.name}；复制失败，请用右侧「复制问题」按钮`)
      );
    } else {
      flash(`已打开 ${p.name}；请用右侧「复制问题」按钮手动复制`);
    }
  }

  async function copyPrompt(text: string) {
    if (legacyCopy(text)) return flash("问题已复制");
    try {
      await navigator.clipboard.writeText(text);
      flash("问题已复制");
    } catch {
      flash("复制失败，请手动选中问题文本");
    }
  }

  async function submit() {
    if (!brandId || busy) return;
    if (!promptId) return flash("请先在左侧点「去提问」选一条问题");
    if (answer.trim().length < 20) return flash("回答太短，请粘贴完整文本");

    const submitted = promptId;
    setBusy(true);
    try {
      const out = await submitEvidence({ brandId, promptId, platform, answer, screenshotUrl, location });
      setLast(out);
      flash(`${out.platformName} 已入库：${out.mention ? `第 ${out.position} 位` : "未提及"}`);
      setAnswer("");
      setScreenshotUrl("");
      await Promise.all([reload(), reloadQueue()]);
      // 自动预填同平台的下一条，连续取证更顺
      const rest = (active?.pending || []).find((x) => x.id !== submitted);
      setPromptId(rest ? rest.id : "");
    } catch (e) {
      flash(e instanceof Error ? e.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("撤销这条取证记录？指标会立即重算")) return;
    try {
      await deleteEvidence(id);
      flash("已撤销");
      await Promise.all([reload(), reloadQueue()]);
    } catch (e) {
      flash(e instanceof Error ? e.message : "撤销失败");
    }
  }

  if (meLoading || loading || queueLoading) {
    return <div className="grid place-items-center py-24 text-[12.5px] text-ink3">正在读取取证队列…</div>;
  }

  const s = queue?.summary;

  return (
    <div className="enter flex flex-col gap-3.5">
      <Note tone="warn" title="为什么必须人工取证：">
        用户在 AI 的网页版 / App 里获取信息，那里有联网搜索、地理位置与产品层策略；模型 API 拿到的不是同一份答案。点击「去提问」会打开对应平台，
        <b className="mx-1">并自动复制问题</b>
        ，你登录提问后把回答粘回来即可 —— 这是目前唯一能拿到 A 级证据的方式。
      </Note>

      {last && (
        <Card className="bg-good/4!">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <Badge tone="ok">A 级已入库</Badge>
            <span>
              {last.platformName} · {last.note} · 准确度 {Math.round(last.accuracy * 100)}%
            </span>
            <span className="ml-auto text-ink2">
              C 端可见度：<b className="tnum text-[14px]">{last.metrics.aviCend ?? "—"}</b>
              <span className="ml-2 text-ink3">模型倾向 {last.metrics.aviModel ?? "—"}</span>
            </span>
          </div>
          {last.duplicate > 0 && (
            <div className="mt-1.5 text-[10.5px] text-ink3">
              该问题在本平台已有 {last.duplicate} 次记录，本次作为第 {last.duplicate + 1} 次采样合并计算（重复取证取均值，不会重复加分）
            </div>
          )}
        </Card>
      )}

      {/* 覆盖率 */}
      {s && (
        <div className="flex flex-wrap items-center gap-3 text-[11.5px] text-ink3">
          <span>
            取证覆盖率 <b className="text-ink">{s.coverage}%</b>
          </span>
          <span>
            {s.doneSamples} / {s.totalSamples} 个样本（{s.totalPrompts} 个问题 × {s.platformCount} 个平台）
          </span>
          <span className="ml-auto">每轮建议 10–20 条购买意图问题</span>
        </div>
      )}

      <section className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        {/* 取证队列 */}
        <Card flush>
          <div className="px-[18px] pt-[15px]">
            <CardHead
              title="取证队列"
              sub="点「去提问」打开平台并复制问题；取完自动打勾"
              right={<Badge tone="info">{s ? `${s.doneSamples} 条已取` : ""}</Badge>}
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5 px-[18px] pb-3">
            {platforms.map((p) => (
              <button
                key={p.key}
                onClick={() => setActiveKey(p.key)}
                className={cn(
                  "rounded-full border px-3 py-1 text-[11.5px] transition-all duration-200",
                  active?.key === p.key ? "border-ink bg-ink text-white" : "border-hair bg-white text-[#3a3a3c] hover:bg-[#f7f7f8]"
                )}
              >
                {p.name.split("（")[0]}
                <span className={cn("ml-1", active?.key === p.key ? "text-white/60" : "text-ink3")}>
                  {p.done}/{p.total}
                </span>
              </button>
            ))}
          </div>

          <div className="max-h-[420px] overflow-y-auto border-t border-hair px-[18px]">
            {(active?.pending || []).map((q) => (
              <div key={q.id} className="flex items-center gap-2.5 border-b border-hair2 py-2.5 last:border-0">
                <Badge tone={INTENT_TONE[q.intent || "决策"] || "default"}>{q.intent || "问题"}</Badge>
                <span className="min-w-0 flex-1 text-[12px] leading-snug text-ink">{q.text}</span>
                <button
                  onClick={() => openAndCopy(active as PlatformQueue, q)}
                  disabled={!active?.web}
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-medium",
                    active?.web ? "bg-accent text-white hover:bg-[#0077ed]" : "bg-[#f1f1f3] text-ink3"
                  )}
                >
                  去提问 →
                </button>
              </div>
            ))}
            {active && !active.pending.length && (
              <div className="py-10 text-center text-[12px] text-ink3">
                {active.name} 的问题已全部取证完成（{active.done}/{active.total}）
              </div>
            )}
            {!active && <div className="py-10 text-center text-[12px] text-ink3">暂无待取证问题，请先生成提问矩阵</div>}
          </div>

          {active && !active.web && (
            <div className="border-t border-hair px-4 py-2.5 text-[10.5px] text-[#9a4a00]">
              该平台未配置网页地址，可通过环境变量 GEO_&lt;平台&gt;_WEB 覆盖
            </div>
          )}
        </Card>

        {/* 回填 */}
        <div className="flex flex-col gap-3.5">
          <Card>
            <CardHead
              title="粘贴回答回填"
              sub="位次与准确度由系统解析，不手填"
              right={<Badge tone="ok">A 级</Badge>}
            />

            {currentPrompt ? (
              <div className="mt-3 rounded-lg border border-accent/25 bg-accent/4 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10.5px] font-semibold tracking-[0.05em] text-accent uppercase">当前待回填</span>
                  <Badge tone="info">{platforms.find((p) => p.key === platform)?.name.split("（")[0] || platform}</Badge>
                  <button onClick={() => copyPrompt(currentPrompt.text)} className="ml-auto text-[11px] text-accent">
                    复制问题
                  </button>
                </div>
                <div className="mt-1 text-[12.5px] leading-snug">{currentPrompt.text}</div>
              </div>
            ) : (
              <div className="mt-3">
                <Note tone="info">先在左侧点一条「去提问」，这里会自动带入问题与平台。</Note>
              </div>
            )}

            <div className="mt-3 flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">平台</span>
                  <select className={fieldCls} value={platform} onChange={(e) => setPlatform(e.target.value)}>
                    {platforms.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">提问城市 / 定位</span>
                  <input className={fieldCls} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="影响「附近」类结果" />
                </label>
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">回答原文（完整粘贴）</span>
                <textarea
                  ref={answerRef}
                  rows={8}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="把 AI 的回答整段复制过来，包括列出的商家、价格和末尾来源说明。"
                  className="w-full resize-y rounded-[11px] border border-hair bg-[#fbfbfc] px-3.5 py-2.5 text-[12.5px] leading-relaxed outline-none transition-all duration-200 focus:border-accent/60 focus:bg-white focus:ring-3 focus:ring-accent/12"
                />
                <span className="text-[10.5px] text-ink3">已输入 {answer.replace(/\s/g, "").length} 字</span>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">截图存证链接（可选，建议填）</span>
                <input className={fieldCls} value={screenshotUrl} onChange={(e) => setScreenshotUrl(e.target.value)} placeholder="https://…" />
              </label>

              <button
                onClick={submit}
                disabled={busy}
                className={cn(
                  "w-full rounded-full py-2.5 text-[12.5px] font-medium text-white",
                  busy ? "cursor-wait bg-accent/60" : "bg-accent shadow-[0_4px_14px_rgba(0,113,227,0.24)] hover:bg-[#0077ed]"
                )}
              >
                {busy ? "入库中…" : "提交取证"}
              </button>
            </div>
          </Card>

          <Card>
            <CardHead title="取证规范" sub="不合规的样本不予计入" />
            <div className="mt-2 flex flex-col gap-1.5 text-[11px] leading-relaxed text-ink3">
              <div>· 用无痕窗口或新建浏览器配置，不带个人登录痕迹</div>
              <div>· 「附近」类问题必须填提问城市，否则不计入 C 端可见度</div>
              <div>· 原文整段粘贴，不要节选（位次与引用依赖完整文本）</div>
              <div>· 留截图：客户质疑时，截图是唯一能自证的东西</div>
              <div>· 同题重复 2 次更稳，答案本身是随机的</div>
            </div>
          </Card>
        </div>
      </section>

      {/* 台账 */}
      <Card flush>
        <div className="px-[18px] pt-[15px]">
          <CardHead
            title="A 级证据台账"
            sub="只有这些记录进入「C 端可见度」；API 与模拟数据一律不计入"
            right={<Badge tone="ok">{list.length} 条</Badge>}
          />
        </div>
        <div className="mt-3 w-full overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {["平台", "提问", "结果", "位次", "准确度", "存证", "时间", ""].map((h) => (
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
              {list.map((e) => {
                const pname = platforms.find((p) => p.key === e.platform)?.name || e.platform;
                return (
                  <tr key={e.id} className={trHover}>
                    <td className={cn(td, "border-0 font-medium text-ink")}>{pname.split("（")[0]}</td>
                    <td className={cn(td, "border-0 max-w-[260px] truncate")}>{e.prompt}</td>
                    <td className={cn(td, "border-0")}>
                      {e.mention ? <Badge tone="ok">被提及</Badge> : <Badge tone="bad">未提及</Badge>}
                    </td>
                    <td className={cn(td, "tnum border-0")}>{e.mention ? `第 ${e.position} 位` : "—"}</td>
                    <td className={cn(td, "tnum border-0")}>{Math.round(e.accuracy * 100)}%</td>
                    <td className={cn(td, "border-0")}>
                      {e.screenshotUrl ? (
                        <a href={e.screenshotUrl} target="_blank" rel="noreferrer" className="text-[11.5px] text-accent underline underline-offset-2">
                          截图
                        </a>
                      ) : (
                        <span className="text-[11px] text-ink3">无</span>
                      )}
                    </td>
                    <td className={cn(td, "tnum border-0")}>{new Date(e.createdAt).toLocaleString("zh-CN", { hour12: false })}</td>
                    <td className={cn(td, "border-0 text-right")}>
                      <button onClick={() => remove(e.id)} className="text-[11.5px] text-ink3 hover:text-bad">
                        撤销
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!list.length && (
                <tr>
                  <td colSpan={8} className="px-3.5 py-12 text-center text-[12px] text-ink3">
                    还没有 A 级证据。当前工作台的「模型倾向」来自 API 或模拟数据，不能当作 C 端可见度交付。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

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
