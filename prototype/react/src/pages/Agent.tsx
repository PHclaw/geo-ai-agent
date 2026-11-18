import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Card, CardHead, Note, cn, td } from "../components/ui";
import {
  agentAct,
  fetchAgentPresets,
  fetchAgentTasks,
  useApi,
  useSession,
  type AgentCard,
  type AgentField,
  type AgentPreset,
} from "../api";

type Msg = {
  id: number;
  role: "user" | "agent";
  text: string;
  card?: AgentCard | null;
  actions?: { label: string; to: string }[];
  fields?: AgentField[];
  needsConfirm?: boolean;
};

const inputCls =
  "w-full resize-none rounded-xl border border-hair bg-[#fbfbfc] px-3 py-2.5 text-[12.5px] leading-relaxed outline-none focus:border-accent/60 focus:bg-white focus:ring-3 focus:ring-accent/12";
const fieldCls =
  "h-8 w-full rounded-lg border border-hair bg-white px-2 text-[11.5px] outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/12";
const btnCls =
  "h-9 shrink-0 rounded-lg px-4 text-[12px] font-medium text-white bg-accent hover:bg-[#0077ed] disabled:cursor-not-allowed disabled:bg-accent/50";
const smallBtnCls =
  "h-8 rounded-lg px-3 text-[11.5px] font-medium text-white bg-accent hover:bg-[#0077ed] disabled:cursor-not-allowed disabled:bg-accent/50";

const WELCOME =
  "说一句话，我判断是要干活还是回答问题：\n· 干活：生成文章、排期、投放建议、数据分析、建档\n· 问答：从企业知识库里找资料回答，并标出来源\n参数不够时我会先把参数摆出来让你改，不会闷头按默认值执行。";

export default function Agent() {
  const { brandId, me } = useSession();
  const canWrite = me?.permissions?.write !== false;
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [presets, setPresets] = useState<AgentPreset[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([{ id: 0, role: "agent", text: WELCOME }]);
  const seq = useRef(1);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, busy]);

  useEffect(() => {
    void fetchAgentPresets()
      .then((r) => setPresets(r.presets || []))
      .catch(() => setPresets([]));
  }, []);

  const tasksQ = useApi(brandId ? () => fetchAgentTasks(brandId, 8) : null, [brandId]);

  async function send(text?: string, params?: Record<string, unknown>, confirm?: boolean) {
    const t = String(text ?? input).trim();
    if (!t || !brandId || busy) return;
    if (!params) {
      setInput("");
      setMsgs((m) => [...m, { id: seq.current++, role: "user", text: t }]);
    }
    setBusy(true);
    try {
      const r = await agentAct(brandId, t, params, confirm);
      setPresets(r.presets || []);
      setMsgs((m) => [
        ...m,
        {
          id: seq.current++,
          role: "agent",
          text: r.reply,
          card: r.card,
          actions: r.actions,
          fields: r.fields || [],
          needsConfirm: r.needsConfirm,
        },
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "执行失败";
      setToast(msg);
      setMsgs((m) => [...m, { id: seq.current++, role: "agent", text: msg }]);
    } finally {
      setBusy(false);
      void tasksQ.reload();
    }
  }

  return (
    <div className="enter flex flex-col gap-3.5">
      <Note tone="info" title="怎么理解它：">
        这里是入口，不是黑箱。能识别的动作会调已有接口并把参数摊开给你改；识别不到就在企业资料里检索后回答，
        检索不到就直说没有，不编内容。排期只生成计划、不代发；投放只给建议、不下单。
      </Note>

      <div className="rounded-2xl border border-hair bg-white">
        <div className="border-b border-hair px-4 py-3">
          <CardHead
            title="Agent 工作台"
            sub="一句话触发 · 参数可改 · 问答标来源 · 每次操作都可回溯"
            right={<Badge tone={busy ? "warn" : "ok"}>{busy ? "执行中" : "就绪"}</Badge>}
          />
        </div>

        <div ref={listRef} className="flex max-h-[520px] min-h-[380px] flex-col gap-3 overflow-y-auto px-4 py-4">
          {msgs.map((m) => (
            <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[90%] rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-relaxed",
                  m.role === "user" ? "bg-accent text-white" : "bg-[#f6f6f7] text-ink"
                )}
              >
                <div className="whitespace-pre-wrap">{m.text}</div>
                {m.card && <CardView card={m.card} />}
                {!!m.actions?.length && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {m.actions.map((a) => (
                      <Link
                        key={a.to + a.label}
                        to={a.to}
                        className="rounded-full border border-hair bg-white px-3 py-1 text-[11px] text-accent hover:bg-[#f7f9ff]"
                      >
                        {a.label} →
                      </Link>
                    ))}
                  </div>
                )}
                {!!m.fields?.length && (
                  <details open={m.needsConfirm} className="mt-2">
                    <summary className="cursor-pointer select-none text-[10.5px] text-accent">
                      {m.needsConfirm ? "待确认：改好参数后生成" : "调整参数重跑"}
                    </summary>
                    <FieldForm
                      fields={m.fields}
                      disabled={busy || !canWrite}
                      submitLabel={m.needsConfirm ? "确认生成" : "按这些参数重跑"}
                      onSubmit={(v) => void send(m.text, v, true)}
                    />
                  </details>
                )}
              </div>
            </div>
          ))}
          {busy && <div className="text-[11.5px] text-ink3">正在执行…</div>}
        </div>

        <div className="border-t border-hair px-4 py-3">
          {!!presets.length && (
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <button
                  key={p.key}
                  onClick={() => void send(p.example)}
                  disabled={busy || !canWrite}
                  title={p.hint}
                  className="rounded-full border border-hair bg-white px-2.5 py-1 text-[11px] text-ink2 hover:bg-[#f6f6f7] disabled:opacity-40"
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder="干活：给 AgentFlow 生成一篇比较类文章 / 生成 4 周排期 / 1 万元投 AI 媒体　问答：AgentFlow 支持哪些部署方式"
              className={inputCls}
            />
            <button onClick={() => void send()} disabled={busy || !canWrite || !input.trim()} className={btnCls}>
              {busy ? "执行中…" : "发送"}
            </button>
          </div>
          <div className="mt-2 text-[10.5px] text-ink3">
            Enter 发送，Shift + Enter 换行。带默认值的参数会标「默认」，改完再执行；生成的文章与排期会真实落库。
          </div>
        </div>
      </div>

      <Card flush>
        <div className="px-4 pt-4 pb-2">
          <CardHead
            title="最近执行"
            sub="每次指令都会落库：意图、状态、耗时与结果均可追溯"
            right={
              <button onClick={() => void tasksQ.reload()} className="text-[11px] text-accent hover:underline">
                刷新
              </button>
            }
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[11.5px]">
            <thead>
              <tr className="border-b border-hair bg-[#fafafb] text-[10px] font-semibold tracking-[0.05em] text-ink3 uppercase">
                <th className="px-3.5 py-2">时间</th>
                <th className="px-3.5 py-2">指令</th>
                <th className="px-3.5 py-2">意图</th>
                <th className="px-3.5 py-2">状态</th>
                <th className="px-3.5 py-2">耗时</th>
              </tr>
            </thead>
            <tbody>
              {(tasksQ.data || []).map((t) => (
                <tr key={t.id} className="border-b border-hair/60">
                  <td className={cn(td, "tnum text-ink3")}>{t.createdAt.slice(5, 16).replace("T", " ")}</td>
                  <td className={cn(td, "max-w-[280px] truncate")} title={t.text}>
                    {t.text}
                  </td>
                  <td className={td}>{t.intent}</td>
                  <td className={td}>
                    <Badge tone={t.status === "done" ? "ok" : t.status === "failed" ? "warn" : "info"}>
                      {t.status === "done" ? "成功" : t.status === "failed" ? "失败" : "执行中"}
                    </Badge>
                  </td>
                  <td className={cn(td, "tnum")}>{t.ms}ms</td>
                </tr>
              ))}
              {!tasksQ.data?.length && (
                <tr>
                  <td colSpan={5} className={cn(td, "py-6 text-center text-ink3")}>
                    还没有执行记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {toast && (
        <div className="pointer-events-none fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-[#1d1d1f] px-4 py-2.5 text-[12px] text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function FieldForm({
  fields,
  submitLabel,
  onSubmit,
  disabled,
}: {
  fields: AgentField[];
  submitLabel: string;
  onSubmit: (values: Record<string, string>) => void;
  disabled: boolean;
}) {
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, String(f.value ?? "")]))
  );
  const set = (k: string, v: string) => setVals((prev) => ({ ...prev, [k]: v }));

  return (
    <div className="mt-2 rounded-xl border border-hair bg-white p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.key} className="flex items-center gap-2 text-[11px]">
            <span className="w-[74px] shrink-0 text-ink3">{f.label}</span>
            {f.type === "select" ? (
              <select value={vals[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} className={fieldCls}>
                {(f.options || []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={f.type === "number" ? "number" : "text"}
                value={vals[f.key] ?? ""}
                min={f.min}
                max={f.max}
                step={f.step}
                onChange={(e) => set(f.key, e.target.value)}
                placeholder={f.type === "text" ? "未填" : ""}
                className={fieldCls}
              />
            )}
            {!f.fromUser && <span className="shrink-0 text-[9.5px] text-[#a35f12]">默认</span>}
          </label>
        ))}
      </div>
      <button onClick={() => onSubmit(vals)} disabled={disabled} className={cn(smallBtnCls, "mt-2.5")}>
        {submitLabel}
      </button>
    </div>
  );
}

function CardView({ card }: { card: AgentCard }) {
  if (card.type === "article") {
    return (
      <div className="mt-2 rounded-xl border border-hair bg-white p-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 text-[12px] font-medium leading-snug text-ink">{card.title}</div>
          <Badge tone={card.geos >= 80 ? "ok" : "warn"}>GEOS {card.geos}</Badge>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-ink3">
          <span>{card.chars} 字</span>
          <span>事实回比 {card.factIssues}</span>
          <span>合规 {card.compliance}</span>
        </div>
      </div>
    );
  }

  if (card.type === "plan") {
    return (
      <div className="mt-2 rounded-xl border border-hair bg-white p-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            ["排期总数", card.created],
            ["养号", card.warmup],
            ["GEO 文章", card.geo],
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-lg bg-[#fbfbfc] px-2 py-2">
              <div className="text-[15px] font-semibold tnum">{v}</div>
              <div className="mt-0.5 text-[10px] text-ink3">{k}</div>
            </div>
          ))}
        </div>
        {card.hint && <div className="mt-2 text-[10.5px] leading-relaxed text-ink3">{card.hint}</div>}
      </div>
    );
  }

  if (card.type === "placement") {
    return (
      <div className="mt-2 rounded-xl border border-hair bg-white p-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-ink3">
          <span>预算 {card.budget} 元</span>
          <span>已选 {card.total} 元</span>
          <span>剩余 {card.remaining} 元</span>
          <span>候选 {card.candidates} 家</span>
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="text-[10px] text-ink3">
                <th className="py-1 pr-2 font-medium">媒体</th>
                <th className="py-1 pr-2 font-medium">单价</th>
                <th className="py-1 font-medium">AIW</th>
              </tr>
            </thead>
            <tbody>
              {card.picks.map((m) => (
                <tr key={m.name} className="border-t border-hair/70">
                  <td className={cn(td, "py-1 pr-2")}>{m.name}</td>
                  <td className={cn(td, "tnum py-1 pr-2")}>{m.price}</td>
                  <td className={cn(td, "tnum py-1")}>{m.aiw}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (card.type === "analyze") {
    const items: [string, string | number][] = [
      ["AVI", card.avi ?? "—"],
      ["提及率", card.mentionRate == null ? "—" : `${card.mentionRate}%`],
      ["SEO 曝光率", card.exposureRate == null ? "—" : `${card.exposureRate}%`],
      ["关键词", card.keywords],
    ];
    return (
      <div className="mt-2 rounded-xl border border-hair bg-white p-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {items.map(([k, v]) => (
            <div key={k} className="rounded-lg bg-[#fbfbfc] px-2 py-2 text-center">
              <div className="text-[14px] font-semibold tnum">{v}</div>
              <div className="mt-0.5 text-[9.5px] text-ink3">{k}</div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 text-[10px] text-ink3">
          <span>样本 {card.samples}</span>
          <span>曝光来源 {card.exposureSource}</span>
          <span>事实冲突 {card.conflicts}</span>
        </div>
      </div>
    );
  }

  if (card.type === "profile") {
    return (
      <div className="mt-2 rounded-xl border border-hair bg-white p-3 text-[11px]">
        {[
          ["品牌", card.params.name || "待填"],
          ["城市", card.params.city || "待填"],
          ["行业", card.params.industry || "待填"],
        ].map(([k, v]) => (
          <div key={k} className="flex gap-2 py-0.5">
            <span className="w-10 shrink-0 text-ink3">{k}</span>
            <span className="text-ink">{v}</span>
          </div>
        ))}
      </div>
    );
  }

  if (card.type === "answer") {
    return (
      <div className="mt-2 rounded-xl border border-hair bg-white p-3">
        {card.generated && card.text ? (
          <>
            <div className="whitespace-pre-wrap text-[11.5px] leading-relaxed text-ink2">{card.text}</div>
            <div className="mt-1.5 text-[10px] text-[#a35f12]">通用回答 · 未引用企业资料</div>
          </>
        ) : card.hits.length ? (
          <ul className="flex flex-col gap-2.5">
            {card.hits.map((h, i) => (
              <li key={i} className="text-[11.5px] leading-relaxed text-ink2">
                <div>{h.text}</div>
                {h.docName && <div className="mt-0.5 text-[10px] text-ink3">来源：{h.docName}</div>}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-[11.5px] text-ink3">没有命中企业资料，也未生成内容。</div>
        )}
      </div>
    );
  }

  return null;
}
