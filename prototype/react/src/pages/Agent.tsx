import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, CardHead, Note, cn, td } from "../components/ui";
import { agentAct, fetchAgentPresets, useSession, type AgentCard, type AgentPreset } from "../api";

type Msg = {
  id: number;
  role: "user" | "agent";
  text: string;
  card?: AgentCard | null;
  actions?: { label: string; to: string }[];
};

const inputCls =
  "w-full resize-none rounded-xl border border-hair bg-[#fbfbfc] px-3 py-2.5 text-[12.5px] leading-relaxed outline-none focus:border-accent/60 focus:bg-white focus:ring-3 focus:ring-accent/12";
const btnCls =
  "h-9 shrink-0 rounded-lg px-4 text-[12px] font-medium text-white bg-accent hover:bg-[#0077ed] disabled:cursor-not-allowed disabled:bg-accent/50";

const WELCOME = "我是工作台入口：你说一句话，我把它路由到已有能力——生成文章、排期、投放建议、数据分析或建档。只调用系统已有接口，不编数据、不代发。";

export default function Agent() {
  const { brandId, me } = useSession();
  const canWrite = me?.permissions?.write !== false;
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
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

  async function send(text?: string) {
    const t = String(text ?? input).trim();
    if (!t || !brandId || busy) return;
    setInput("");
    setMsgs((m) => [...m, { id: seq.current++, role: "user", text: t }]);
    setBusy(true);
    try {
      const r = await agentAct(brandId, t);
      setPresets(r.presets || []);
      setMsgs((m) => [
        ...m,
        { id: seq.current++, role: "agent", text: r.reply, card: r.card, actions: r.actions },
      ]);
    } catch (e) {
      setMsgs((m) => [
        ...m,
        { id: seq.current++, role: "agent", text: e instanceof Error ? e.message : "执行失败" },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="enter flex flex-col gap-3.5">
      <Note tone="info" title="边界说明：">
        这里只做「识别意图 → 调已有接口」，不额外调用模型；排期只生成计划、不代发；投放只给组合建议、不下单；
        识别不到的动作会返回预设指令，不会硬猜。
      </Note>

      <div className="rounded-2xl border border-hair bg-white">
        <div className="border-b border-hair px-4 py-3">
          <CardHead
            title="Agent 工作台"
            sub="一句话触发 · 结果以卡片返回 · 每次操作都可回溯到对应页面"
            right={<Badge tone={busy ? "warn" : "ok"}>{busy ? "执行中" : "就绪"}</Badge>}
          />
        </div>

        <div ref={listRef} className="flex max-h-[480px] min-h-[360px] flex-col gap-3 overflow-y-auto px-4 py-4">
          {msgs.map((m) => (
            <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-relaxed",
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
              placeholder="例如：给 AgentFlow 生成一篇比较类文章 / 按 4 条养号 3:1 穿插生成 4 周排期 / 1 万元预算投 AI 行业媒体"
              className={inputCls}
            />
            <button onClick={() => void send()} disabled={busy || !canWrite || !input.trim()} className={btnCls}>
              {busy ? "执行中…" : "发送"}
            </button>
          </div>
          <div className="mt-2 text-[10.5px] text-ink3">
            Enter 发送，Shift + Enter 换行。生成的排期与文章会真实落库，可在对应页面继续编辑。
          </div>
        </div>
      </div>
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

  return null;
}
