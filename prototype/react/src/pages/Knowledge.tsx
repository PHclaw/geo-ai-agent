import { useMemo, useState } from "react";
import { Badge, Bar, Card, CardHead, Drawer, Note, cn, td, trHover } from "../components/ui";
import { useApi, useSession, fetchFacts, createFact, deleteFact, resolveFact, organizeFacts, type Fact } from "../api";

const STATUS_META: Record<string, { text: string; tone: "ok" | "warn" | "bad" | "default" }> = {
  active: { text: "生效中", tone: "ok" },
  expiring: { text: "将过期", tone: "warn" },
  conflict: { text: "冲突", tone: "bad" },
  missing: { text: "待补充", tone: "default" },
  archived: { text: "已归档", tone: "default" },
};

const inputCls =
  "h-10 w-full rounded-lg border border-hair bg-[#fbfbfc] px-3 text-[12.5px] outline-none transition-all duration-200 focus:border-accent/60 focus:bg-white focus:ring-3 focus:ring-accent/12";

export default function Knowledge() {
  const { brandId, brand, loading: meLoading } = useSession();
  const { data: facts, loading, error, reload } = useApi(brandId ? () => fetchFacts(brandId) : null, [brandId]);

  const [cat, setCat] = useState("全部");
  const [resolving, setResolving] = useState<Fact | null>(null);
  const [keepId, setKeepId] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setForm] = useState({ subject: "", attr: "", value: "", validFrom: "", source: "" });

  const list = facts || [];
  const conflictGroups = useMemo(() => {
    const map = new Map<string, Fact[]>();
    list.filter((f) => f.conflictGroup).forEach((f) => {
      const arr = map.get(f.conflictGroup) || [];
      arr.push(f);
      map.set(f.conflictGroup, arr);
    });
    return [...map.values()].filter((g) => g.length > 1);
  }, [list]);

  const subjects = useMemo(() => ["全部", ...Array.from(new Set(list.map((f) => f.subject)))], [list]);
  const visible = cat === "全部" ? list.filter((f) => f.status !== "archived") : list.filter((f) => f.subject === cat && f.status !== "archived");

  const completeness = useMemo(() => {
    if (!list.length) return 0;
    const ok = list.filter((f) => f.status === "active" && f.value && f.value !== "—").length;
    return Math.round((ok / list.length) * 100);
  }, [list]);

  function flash(m: string) {
    setToast(m);
    window.setTimeout(() => setToast(null), 2600);
  }

  async function organize() {
    if (!brandId || organizing) return;
    const ok = window.confirm(
      "将读取知识库文档，用 AI 整理出事实卡初版（约 20–40 秒）。\n\n已存在的相同事实会自动跳过；同一属性出现不同说法时会标为冲突等你裁决。继续吗？"
    );
    if (!ok) return;
    setOrganizing(true);
    try {
      const out = await organizeFacts(brandId);
      const parts = [`新增 ${out.added} 条`];
      if (out.skipped) parts.push(`跳过重复 ${out.skipped} 条`);
      if (out.conflicts) parts.push(`${out.conflicts} 条口径冲突待裁决`);
      flash(`AI 整理完成：${parts.join("，")}`);
      await reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "AI 整理失败";
      // 已有事实卡时后端会拦一下：确认后再带 force 追加
      if (msg.includes("已有") && msg.includes("事实卡")) {
        setOrganizing(false);
        const go = window.confirm(`${msg}\n\n仍要追加一轮吗？（会产生措辞不同的近似条目，建议自行删减）`);
        if (!go) return;
        setOrganizing(true);
        try {
          const out = await organizeFacts(brandId, true);
          flash(`已追加 ${out.added} 条（跳过 ${out.skipped} 条，冲突 ${out.conflicts} 条）`);
          await reload();
        } catch (e2) {
          flash(e2 instanceof Error ? e2.message : "追加失败");
        } finally {
          setOrganizing(false);
        }
        return;
      }
      flash(msg);
    } finally {
      setOrganizing(false);
    }
  }

  async function doResolve() {
    if (!resolving) return;
    setBusy(true);
    try {
      const out = await resolveFact(resolving.id, keepId || resolving.id);
      flash(`已确认唯一口径，归档 ${out.archived} 条冲突值`);
      setResolving(null);
      await reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  async function doCreate() {
    if (!form.subject.trim() || !form.attr.trim() || !form.value.trim()) {
      flash("主体、属性、值三项必填");
      return;
    }
    setBusy(true);
    try {
      await createFact({ brandId, ...form });
      flash("已新增事实卡");
      setCreating(false);
      setForm({ subject: "", attr: "", value: "", validFrom: "", source: "" });
      await reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "新增失败");
    } finally {
      setBusy(false);
    }
  }

  async function doDelete(f: Fact) {
    if (!window.confirm(`确认删除「${f.attr}：${f.value}」？`)) return;
    try {
      await deleteFact(f.id);
      flash("已删除");
      await reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "删除失败");
    }
  }

  if (meLoading || loading) {
    return <div className="grid place-items-center py-24 text-[12.5px] text-ink3">正在读取知识库…</div>;
  }

  return (
    <div className="enter flex flex-col gap-3.5">
      <Card>
        <div className="flex flex-wrap items-center gap-5">
          <div
            className="relative grid h-[68px] w-[68px] shrink-0 place-items-center rounded-full"
            style={{ background: `conic-gradient(from -90deg, #0071e3 ${completeness * 3.6}deg, #ececf0 0deg)` }}
          >
            <div className="absolute inset-[6px] rounded-full bg-white" />
            <b className="relative z-1 text-[16px] font-semibold">{completeness}</b>
          </div>
          <div className="min-w-[220px]">
            <div className="text-[15px] font-semibold tracking-[-0.02em]">
              知识库完整度 {completeness} 分 · {brand?.name}
            </div>
            <div className="mt-1.5 text-[11.5px] leading-relaxed text-ink3">
              事实卡是内容的唯一口径来源：AI 只会引用它，不会引用你的口头承诺。
            </div>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              onClick={() => void organize()}
              disabled={organizing}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-[12.5px] transition-colors",
                organizing
                  ? "cursor-wait border-accent/30 bg-accent/6 text-accent"
                  : "border-hair bg-white hover:bg-[#f6f6f7]"
              )}
              title="读知识库文档，用 AI 整理出事实卡初版"
            >
              {organizing ? "AI 整理中…" : "AI 自动整理"}
            </button>
            <button onClick={() => reload()} className="rounded-full border border-hair bg-white px-3.5 py-1.5 text-[12.5px] hover:bg-[#f6f6f7]">
              刷新
            </button>
            <button
              onClick={() => {
                setForm({ subject: brand?.name || "", attr: "", value: "", validFrom: "", source: "" });
                setCreating(true);
              }}
              className="rounded-full bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-white shadow-[0_4px_14px_rgba(0,113,227,0.24)] hover:bg-[#0077ed]"
            >
              + 新建事实卡
            </button>
          </div>
        </div>
      </Card>

      {/* 冲突横幅 */}
      {conflictGroups.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[11px] border border-bad/14 bg-bad/4 px-3.5 py-3 text-[12px] text-[#a40010]">
          <div>
            <b className="font-medium">发现 {conflictGroups.length} 处口径冲突：</b>
            {conflictGroups.map((g) => `${g[0].attr}（${g.map((x) => x.value).join(" / ")}）`).join("；")}
            。冲突未解决前，内容生成会阻断。
          </div>
          <button
            onClick={() => {
              const g = conflictGroups[0];
              setKeepId(g[0].id);
              setResolving(g[0]);
            }}
            className="ml-auto shrink-0 rounded-full border border-bad/20 bg-white px-3 py-1 text-[11.5px] font-medium text-[#a40010] hover:bg-[#fff7f8]"
          >
            去确认
          </button>
        </div>
      ) : (
        <Note>没有口径冲突。当前 {list.filter((f) => f.status === "active").length} 条事实处于生效状态。</Note>
      )}

      {error && (
        <Note tone="bad" title="加载失败：">
          {error}
        </Note>
      )}

      <section className="grid gap-3.5 xl:grid-cols-[220px_minmax(0,1fr)]">
        <Card>
          <CardHead title="主体" right={<span className="text-[11.5px] text-ink3">{list.length} 条</span>} />
          <div className="mt-3 flex flex-col gap-0.5">
            {subjects.map((c) => (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={cn(
                  "flex h-8 items-center gap-2 rounded-[9px] px-2.5 text-left text-[12.5px] transition-colors duration-200",
                  cat === c ? "bg-ink font-medium text-white" : "text-[#3a3a3c] hover:bg-black/4"
                )}
              >
                <span className="truncate">{c}</span>
                <span className={cn("ml-auto text-[11px]", cat === c ? "text-white/60" : "text-ink3")}>
                  {c === "全部" ? list.length : list.filter((f) => f.subject === c).length}
                </span>
              </button>
            ))}
          </div>
        </Card>

        <Card flush>
          <div className="px-[18px] pt-[15px]">
            <CardHead
              title="事实卡"
              sub="每条事实含生效期与来源；过期与归档项不参与内容生成"
              right={<Badge tone="info">{visible.length} 条</Badge>}
            />
          </div>

          <div className="mt-3 w-full overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {["主体", "属性", "值", "生效期", "来源", "状态", ""].map((h) => (
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
                {visible.map((f) => {
                  const meta = STATUS_META[f.status] || STATUS_META.active;
                  const isConflict = f.status === "conflict";
                  return (
                    <tr key={f.id} className={cn("border-b border-hair2", isConflict ? "bg-[rgba(215,0,21,0.035)]" : trHover)}>
                      <td className={cn(td, "border-0 font-medium text-ink", isConflict && "border-l-2 border-l-bad")}>{f.subject}</td>
                      <td className={cn(td, "border-0")}>{f.attr}</td>
                      <td className={cn(td, "border-0 font-semibold text-black")}>{f.value}</td>
                      <td className={cn(td, "tnum border-0")}>{f.validFrom || "—"}</td>
                      <td className={cn(td, "border-0")}>{f.source || "—"}</td>
                      <td className={cn(td, "border-0")}>
                        <Badge tone={meta.tone}>{meta.text}</Badge>
                      </td>
                      <td className={cn(td, "border-0 text-right")}>
                        {isConflict ? (
                          <button
                            onClick={() => {
                              setKeepId(f.id);
                              setResolving(f);
                            }}
                            className="rounded-full border border-hair bg-white px-2.5 py-1 text-[11.5px] hover:bg-[#f6f6f7]"
                          >
                            解决
                          </button>
                        ) : (
                          <button onClick={() => doDelete(f)} className="text-[11.5px] text-ink3 hover:text-bad">
                            删除
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3.5 py-10 text-center text-[12px] text-ink3">
                      暂无事实卡，点右上角「新建事实卡」添加
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-hair px-4 py-3 text-[11.5px] text-ink3">
            <span>共 {list.length} 条 · 显示 {visible.length} 条</span>
            <span className="ml-auto">写入 SQLite · 实时生效</span>
          </div>
        </Card>
      </section>

      {/* 冲突解决 */}
      <Drawer
        open={!!resolving}
        onClose={() => setResolving(null)}
        title="解决口径冲突"
        sub="同一属性只能有一个生效值，另一值转为已归档"
        footer={
          <>
            <button
              onClick={doResolve}
              disabled={busy}
              className={cn(
                "rounded-full px-4 py-1.5 text-[12.5px] font-medium text-white",
                busy ? "bg-accent/60" : "bg-accent hover:bg-[#0077ed]"
              )}
            >
              {busy ? "保存中…" : "确认唯一口径"}
            </button>
            <button onClick={() => setResolving(null)} className="rounded-full border border-hair bg-white px-3.5 py-1.5 text-[12.5px] hover:bg-[#f6f6f7]">
              稍后处理
            </button>
          </>
        }
      >
        <div className="text-[12px] leading-relaxed text-ink2">
          「{resolving?.attr}」存在多个值。AI 引用矛盾信息时会降低对品牌的信任度，也会拉低识别准确率。
        </div>
        <div className="mt-3.5 flex flex-col gap-2">
          {list
            .filter((f) => f.conflictGroup && f.conflictGroup === resolving?.conflictGroup)
            .map((f) => (
              <button
                key={f.id}
                onClick={() => setKeepId(f.id)}
                className={cn(
                  "flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-all duration-200",
                  keepId === f.id ? "border-accent bg-accent/4 shadow-[0_0_0_2px_rgba(0,113,227,0.1)]" : "border-hair bg-white hover:bg-[#fafafa]"
                )}
              >
                <span
                  className={cn(
                    "grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[8px]",
                    keepId === f.id ? "border-accent bg-accent text-white" : "border-[#c7c7cc]"
                  )}
                >
                  {keepId === f.id ? "✓" : ""}
                </span>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold">{f.value}</div>
                  <div className="text-[10.5px] text-ink3">
                    {f.validFrom || "—"} · 来源：{f.source || "—"}
                  </div>
                </div>
              </button>
            ))}
        </div>
        <div className="mt-4">
          <Note tone="warn" title="确认后会连带发生：">
            其余冲突值归档；受影响内容重新标记为可引用；下次诊断将按新口径计算识别准确率。
          </Note>
        </div>
      </Drawer>

      {/* 新建 */}
      <Drawer
        open={creating}
        onClose={() => setCreating(false)}
        title="新建事实卡"
        sub="建议一条事实只描述一个属性，便于模型精确引用"
        footer={
          <>
            <button
              onClick={doCreate}
              disabled={busy}
              className={cn(
                "rounded-full px-4 py-1.5 text-[12.5px] font-medium text-white",
                busy ? "bg-accent/60" : "bg-accent hover:bg-[#0077ed]"
              )}
            >
              {busy ? "保存中…" : "保存"}
            </button>
            <button onClick={() => setCreating(false)} className="rounded-full border border-hair bg-white px-3.5 py-1.5 text-[12.5px] hover:bg-[#f6f6f7]">
              取消
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {[
            ["主体", "subject", "例如：和序装饰 / 河西店"],
            ["属性", "attr", "例如：工期 / 人均消费"],
            ["值", "value", "例如：45–60 天（100㎡ 三居）"],
            ["生效期", "validFrom", "例如：2026-10-01 起"],
            ["来源", "source", "例如：报价单 v3"],
          ].map(([label, key, ph]) => (
            <label key={key} className="block">
              <span className="mb-1.5 block text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">{label}</span>
              <input
                className={inputCls}
                placeholder={ph}
                value={form[key as keyof typeof form]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </label>
          ))}
          <Note tone="info" title="冲突检测是自动的：">
            若同一主体同一属性已存在不同值，新建时会自动标记为冲突并阻断内容引用，需到冲突处理里二选一。
          </Note>
          <div className="mt-1">
            <Bar value={completeness} thin />
            <div className="mt-1.5 text-[10.5px] text-ink3">当前完整度 {completeness}，目标 90</div>
          </div>
        </div>
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
