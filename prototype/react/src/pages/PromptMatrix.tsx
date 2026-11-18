import { useMemo, useState } from "react";
import { Badge, Card, CardHead, Note, cn, td, trHover } from "../components/ui";
import {
  agentPrompts,
  createPrompt,
  deletePrompt,
  deletePromptsBatch,
  fetchPrompts,
  generatePrompts,
  updatePrompt,
  useApi,
  useSession,
  type Prompt,
} from "../api";

const INTENTS = ["认知", "决策", "口碑", "比较", "本地"] as const;
/** 取证平台数（与后端 providerStatus 保持 6 家） */
const PLATFORMS = 6;
const TONE: Record<string, "info" | "warn" | "purple" | "default"> = {
  决策: "info",
  本地: "warn",
  比较: "purple",
  口碑: "default",
  认知: "default",
};

export default function PromptMatrix() {
  const { brandId, brand, me } = useSession();
  const { data: prompts, loading, error, reload } = useApi(brandId ? () => fetchPrompts(brandId) : null, [brandId]);

  const [filter, setFilter] = useState<string>("全部");
  const [text, setText] = useState("");
  const [intent, setIntent] = useState<string>("决策");
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [confirmAgent, setConfirmAgent] = useState(false);
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const [lastKeywords, setLastKeywords] = useState<{ term: string; type: string; intentHint: string }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBatch, setConfirmBatch] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const canWrite = me?.permissions?.write !== false;
  const list = useMemo(() => prompts || [], [prompts]);
  const rows = filter === "全部" ? list : list.filter((p) => p.intent === filter);

  // “本地”在两种行业里意思不同：有城市的服务类=到店/附近；无地址的软件类=本地部署/私有化
  const hasCity = Boolean(brand?.city);
  const labelOf = (k: string) => (k === "本地" && !hasCity ? "本地/私有化" : k);

  const byIntent = useMemo(() => {
    const m: Record<string, number> = {};
    list.forEach((p) => (m[p.intent || "未分类"] = (m[p.intent || "未分类"] || 0) + 1));
    return m;
  }, [list]);

  // 只对"像模板套壳"的问题做提示：含"附近/到店"但品牌无城市（软件类不该有到店问题）
  const suspicious = useMemo(
    () => list.filter((p) => /附近|到店|周边/.test(p.text) && !hasCity),
    [list, hasCity]
  );

  function flash(m: string) {
    setToast(m);
    window.setTimeout(() => setToast(null), 2800);
  }

  async function add() {
    if (!brandId || busy) return;
    const t = text.trim();
    if (t.length < 6) return flash("问题太短，至少 6 个字");
    setBusy(true);
    try {
      await createPrompt(brandId, { text: t, intent, weight: intent === "认知" ? 1 : 3 });
      setText("");
      flash("已新增");
      await reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "新增失败");
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Prompt) {
    try {
      await deletePrompt(p.id);
      flash("已删除");
      await reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "删除失败");
    }
  }

  /** 行内二次确认：不用 window.confirm（在自动化/某些浏览器设置下会被自动接受，等于没有拦截） */
  function askRemove(p: Prompt) {
    if (pendingDelete === p.id) {
      setPendingDelete(null);
      void remove(p);
      return;
    }
    setPendingDelete(p.id);
    window.setTimeout(() => setPendingDelete((cur) => (cur === p.id ? null : cur)), 4000);
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirmBatch(false);
  }

  function toggleAll() {
    setSelected((prev) => (rows.every((r) => prev.has(r.id)) ? new Set() : new Set(rows.map((r) => r.id))));
    setConfirmBatch(false);
  }

  async function batchRemove() {
    if (!brandId || !selected.size) return;
    if (!confirmBatch) {
      setConfirmBatch(true);
      window.setTimeout(() => setConfirmBatch(false), 5000);
      return;
    }
    setConfirmBatch(false);
    const ids = [...selected];
    setSelected(new Set());
    try {
      const out = await deletePromptsBatch(brandId, ids);
      flash(`已删除 ${out.deleted} 条`);
      await reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "批量删除失败");
    }
  }

  async function changeIntent(p: Prompt, next: string) {
    if (next === p.intent) return;
    try {
      await updatePrompt(p.id, { intent: next });
      flash(`意图已改为「${labelOf(next)}」`);
      await reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "修改失败");
    }
  }

  async function fillByTemplate() {
    if (!brandId || busy) return;
    setBusy(true);
    try {
      const out = await generatePrompts(brandId, 40);
      flash(`模板补充：新增 ${out.added} 条（现有 ${out.total} 条）`);
      await reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "生成失败");
    } finally {
      setBusy(false);
    }
  }

  async function fillByAgent(replace = false) {
    if (!brandId || thinking) return;
    // 两次点击确认：首次只亮起「再点一次开始」，避免误触直接跑掉 1 分钟的 AI 任务
    const armed = replace ? confirmRebuild : confirmAgent;
    if (!armed) {
      if (replace) {
        setConfirmRebuild(true);
        window.setTimeout(() => setConfirmRebuild(false), 6000);
      } else {
        setConfirmAgent(true);
        window.setTimeout(() => setConfirmAgent(false), 6000);
      }
      return;
    }
    if (replace) setConfirmRebuild(false);
    else setConfirmAgent(false);

    setThinking(true);
    try {
      const out = await agentPrompts(brandId, { replace });
      setLastKeywords(out.keywords.slice(0, 16));
      const parts = [
        `关键词 ${out.keywords.length} 个`,
        `新增 ${out.added} 条`,
        out.stats.rejected ? `剔除 ${out.stats.rejected} 条` : "",
        out.retried ? "已自动重试" : "",
        replace ? "旧题已替换" : "",
      ].filter(Boolean);
      flash(`AI 生成：${parts.join(" · ")}`);
      await reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "AI 生成失败");
    } finally {
      setThinking(false);
    }
  }

  if (loading) {
    return <div className="grid place-items-center py-24 text-[12.5px] text-ink3">正在读取提问矩阵…</div>;
  }

  return (
    <div className="enter flex flex-col gap-3.5">
      <Note tone="info" title="这一页决定「取证队列里会出现什么」：">
        C 端取证按「问题 × 平台」逐条采集。问题越贴近真实用户，取证出来的数据越有用；模板生成的套壳问题（如给 SaaS 生成"附近有哪些商家"）应当删掉，或改用
        <b className="mx-1">AI 生成</b>
        重新出题。
      </Note>

      {error && <Note tone="warn" title="读取失败：">{error}</Note>}

      {suspicious.length > 0 && (
        <Note tone="warn" title={`${suspicious.length} 条问题可能不贴合：`}>
          品牌没有填写城市，但这些问题的问法是本地化的（{suspicious.slice(0, 3).map((p) => `「${p.text}」`).join("、")}
          ）。建议删除，或用 AI 生成替换。
        </Note>
      )}

      {/* 概览 */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-5">
        {["全部", ...INTENTS].map((k) => (
          <Card key={k} className="p-3.5!">
            <div className="text-[10px] font-semibold tracking-[0.07em] text-ink3 uppercase">{labelOf(k)}</div>
            <div className="tnum mt-1 text-[22px] leading-none font-semibold">
              {k === "全部" ? list.length : byIntent[k] || 0}
              <small className="ml-1 text-[11px] font-medium text-ink3">条</small>
            </div>
          </Card>
        ))}
      </section>

      {/* 新增 + 生成 */}
      <Card>
        <CardHead
          title="添加问题"
          sub="写用户真会问的话；6 字以上，越短越口语越好"
          right={<Badge tone="info">{brand?.name || ""}</Badge>}
        />
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
            placeholder={hasCity ? "例如：装修公司中途加钱怎么办？" : "例如：私有化部署需要自己准备数据库吗？"}
            className="h-10 flex-1 rounded-lg border border-hair bg-[#fbfbfc] px-3 text-[12.5px] outline-none focus:border-accent/60 focus:bg-white focus:ring-3 focus:ring-accent/12"
          />
          <select
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            className="h-10 rounded-lg border border-hair bg-[#fbfbfc] px-2.5 text-[12.5px] outline-none focus:border-accent/60"
          >
            {INTENTS.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
          <button
            onClick={() => void add()}
            disabled={busy || !canWrite}
            className={cn(
              "h-10 shrink-0 rounded-lg px-4 text-[12.5px] font-medium text-white",
              busy || !canWrite ? "cursor-not-allowed bg-accent/50" : "bg-accent hover:bg-[#0077ed]"
            )}
          >
            添加
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => void fillByAgent()}
            disabled={thinking || !canWrite}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-[12px] transition-colors",
              thinking
                ? "cursor-wait border-accent/30 bg-accent/6 text-accent"
                : "border-accent/40 bg-accent/5 text-accent hover:bg-accent/10"
            )}
            title="读知识库与事实卡，生成贴合行业的问题"
          >
            {thinking ? "AI 出题中…" : confirmAgent ? "再点一次开始（40–90 秒）" : "AI 生成提问"}
          </button>
          <button
            onClick={() => void fillByAgent(true)}
            disabled={thinking || !canWrite}
            className="rounded-full border border-[#e0b04a]/60 bg-[#fdf6e6] px-3.5 py-1.5 text-[12px] text-[#a35f12] hover:bg-[#fbf0d9]"
            title="清空现有提问与旧探测记录，按关键词重新出题"
          >
            {confirmRebuild ? "再点一次：会删除旧提问" : "AI 重建（替换旧题）"}
          </button>
          <button
            onClick={() => void fillByTemplate()}
            disabled={busy || !canWrite}
            className="rounded-full border border-hair bg-white px-3.5 py-1.5 text-[12px] hover:bg-[#f6f6f7]"
            title="按内置行业模板补充（秒级，但可能套壳）"
          >
            模板补充
          </button>
          <span className="text-[10.5px] leading-relaxed text-ink3">
            AI 生成会读资料，更贴合；模板补充快，但换行业容易出"套壳问题"
          </span>
        </div>

        {!!lastKeywords.length && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10.5px] text-ink3">本次选中的关键词：</span>
            {lastKeywords.map((k) => (
              <span
                key={k.term}
                title={`${k.type} · 偏${k.intentHint}`}
                className="rounded-full border border-hair bg-white px-2 py-0.5 text-[10.5px] text-ink2"
              >
                {k.term}
              </span>
            ))}
          </div>
        )}
      </Card>

      {/* 列表 */}
      <Card flush>
        <div className="px-[18px] pt-[15px]">
          <CardHead
            title="提问矩阵"
            sub="权重高的会排在取证队列前面"
            right={<Badge tone="info">{rows.length} / {list.length} 条</Badge>}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5 px-[18px] pb-3">
          {["全部", ...INTENTS].map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={cn(
                "rounded-full border px-3 py-1 text-[11.5px] transition-colors",
                filter === k ? "border-ink bg-ink text-white" : "border-hair bg-white hover:bg-[#f7f7f8]"
              )}
            >
              {k}
              {k !== "全部" && <span className="ml-1 opacity-60">{byIntent[k] || 0}</span>}
            </button>
          ))}
        </div>

        {/* 批量操作条 */}
        {selected.size > 0 && (
          <div className="mx-[18px] mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent/25 bg-accent/5 px-3 py-2 text-[12px]">
            <span className="text-ink2">
              已选 <b className="tnum">{selected.size}</b> 条
            </span>
            <button
              onClick={() => setSelected(new Set())}
              className="text-[11.5px] text-ink3 underline underline-offset-2 hover:text-ink"
            >
              取消选择
            </button>
            <button
              onClick={() => void batchRemove()}
              className={cn(
                "ml-auto rounded-full px-3 py-1 text-[11.5px] font-medium text-white",
                confirmBatch ? "bg-bad" : "bg-ink hover:bg-[#2b2b2e]"
              )}
            >
              {confirmBatch ? `再点一次确认删除 ${selected.size} 条` : "删除选中"}
            </button>
          </div>
        )}

        <div className="w-full overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                <th className="w-8 border-y border-hair bg-[#fafafb]/70 px-3 py-2.5">
                  <input
                    type="checkbox"
                    aria-label="全选"
                    checked={rows.length > 0 && rows.every((r) => selected.has(r.id))}
                    onChange={toggleAll}
                    className="h-3.5 w-3.5 accent-[#0071e3]"
                  />
                </th>
                {["问题", "意图", "权重", "取证", "操作"].map((h) => (
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
              {rows.map((p) => (
                <tr key={p.id} className={trHover}>
                  <td className={cn(td, "w-8")}>
                    <input
                      type="checkbox"
                      aria-label={`选择 ${p.text}`}
                      checked={selected.has(p.id)}
                      onChange={() => toggleOne(p.id)}
                      className="h-3.5 w-3.5 accent-[#0071e3]"
                    />
                  </td>
                  <td className={cn(td, "text-ink")}>{p.text}</td>
                  <td className={td}>
                    {canWrite ? (
                      <select
                        value={p.intent}
                        onChange={(e) => void changeIntent(p, e.target.value)}
                        className="h-6 rounded-md border border-hair bg-white px-1 text-[11px] outline-none focus:border-accent/60"
                      >
                        {INTENTS.map((i) => (
                          <option key={i} value={i}>
                            {labelOf(i)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Badge tone={TONE[p.intent] || "default"}>{labelOf(p.intent) || "未分类"}</Badge>
                    )}
                  </td>
                  <td className={cn(td, "tnum")}>{p.weight}</td>
                  <td className={cn(td, "tnum whitespace-nowrap")}>
                    {(p.evidenced ?? 0) > 0 ? (
                      <Badge tone="info">
                        {p.evidenced}/{PLATFORMS}
                      </Badge>
                    ) : (
                      <span className="text-[11px] text-ink3">0/{PLATFORMS}</span>
                    )}
                  </td>
                  <td className={cn(td, "text-right")}>
                    {canWrite ? (
                      <button
                        onClick={() => askRemove(p)}
                        className={cn(
                          "text-[11.5px] transition-colors",
                          pendingDelete === p.id ? "font-medium text-bad" : "text-ink3 hover:text-bad"
                        )}
                      >
                        {pendingDelete === p.id ? "确认删除？" : "删除"}
                      </button>
                    ) : (
                      <span className="text-[11px] text-ink3">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={6} className="px-3.5 py-12 text-center">
                    <div className="text-[12.5px] text-ink2">这个意图下还没有问题</div>
                    <div className="mt-1.5 text-[11px] text-ink3">用上方「AI 生成提问」或手动添加</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div
        className={cn(
          "fixed bottom-6 left-1/2 z-[200] -translate-x-1/2 rounded-full bg-[rgba(28,28,30,0.94)] px-4 py-2.5 text-[12px] text-white backdrop-blur-md transition-all duration-300",
          toast ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
        )}
      >
        {toast}
      </div>
    </div>
  );
}
