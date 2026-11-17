import { useEffect, useRef, useState } from "react";
import { Badge, Drawer, Note, cn } from "./ui";
import Markdown from "./Markdown";
import { fetchAgentStatus, fetchPrompts, streamAgent, useApi, useSession } from "../api";

const GENRES = ["攻略", "问答", "清单", "对比", "案例", "本地指南"];

export default function AgentPanel({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { brandId, me } = useSession();
  const { data: status } = useApi(open ? fetchAgentStatus : null, [open]);
  const { data: prompts } = useApi(open && brandId ? () => fetchPrompts(brandId) : null, [open, brandId]);

  const [promptId, setPromptId] = useState("");
  const [genre, setGenre] = useState("攻略");
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<string[]>([]);
  const [thinking, setThinking] = useState("");
  const [text, setText] = useState("");
  const [usage, setUsage] = useState<{ input: number; output: number } | null>(null);
  const [result, setResult] = useState<{ geos: number; title: string; chars: number; factIssues: number; figures: number } | null>(null);
  const [issues, setIssues] = useState<{ value: number; unit: string; context: string }[]>([]);
  const [showIssues, setShowIssues] = useState(false);
  const [blocked, setBlocked] = useState<{ word: string; reason: string; context: string }[]>([]);
  const [warnings, setWarnings] = useState<{ word: string; reason: string; context: string }[]>([]);
  const [error, setError] = useState("");
  const [showThink, setShowThink] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [text]);

  useEffect(() => {
    if (!open) {
      setRunning(false);
    }
  }, [open]);

  async function start() {
    if (!brandId || running) return;
    setRunning(true);
    setError("");
    setResult(null);
    setText("");
    setThinking("");
    setStage([]);
    setUsage(null);
    setIssues([]);
    setShowIssues(false);
    setBlocked([]);
    setWarnings([]);
    try {
      await streamAgent({ brandId, promptId: promptId || undefined, genre }, (e) => {
        if (e.type === "stage" || e.type === "log") setStage((s) => [...s, e.content]);
        else if (e.type === "warn") setStage((s) => [...s, `⚠ ${e.content}`]);
        else if (e.type === "thinking") setThinking((t) => t + e.delta);
        else if (e.type === "tool") setStage((s) => [...s, `调用工具：${e.content}`]);
        else if (e.type === "text") setText((t) => t + e.delta);
        else if (e.type === "facts") {
          setIssues(e.issues);
          setStage((s) => [...s, `事实校验：${e.issues.length} 个数字在事实卡里找不到出处`]);
        } else if (e.type === "figures") {
          setStage((s) => [...s, `已生成 ${e.count} 张数据图并插入正文`]);
        } else if (e.type === "compliance") {
          setBlocked(e.blocked);
          setWarnings(e.warnings);
          setStage((s) => [...s, `合规检查：${e.summary}`]);
        } else if (e.type === "saved") {
          // 用后端插图后的最终正文替换流式原文，否则预览里看不到图
          if (e.body) setText(e.body);
          setResult({ geos: e.geos, title: e.title, chars: e.chars, factIssues: e.factIssues, figures: e.figures });
          onSaved();
        } else if (e.type === "done") {
          if (!e.ok) setError(e.error || "生成失败");
          if (e.usage) setUsage({ input: e.usage.input, output: e.usage.output });
        } else if (e.type === "error") {
          setError(e.content);
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setRunning(false);
    }
  }

  const available = status?.available !== false;
  const canWrite = me?.permissions?.write !== false;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="智能体写作"
      sub="由写手智能体读事实卡与文档后成文；生成结果以草稿入库，需人工审核"
      footer={
        <div className="flex items-center gap-2">
          <button
            onClick={() => void start()}
            disabled={running || !available || !canWrite}
            className={cn(
              "rounded-full px-4 py-2 text-[12.5px] font-medium text-white",
              running || !available || !canWrite ? "cursor-not-allowed bg-accent/50" : "bg-accent hover:bg-[#0077ed]"
            )}
          >
            {running ? "生成中…" : text ? "重新生成" : "开始生成"}
          </button>
          <button onClick={onClose} className="rounded-full border border-hair bg-white px-3.5 py-2 text-[12.5px] hover:bg-[#f6f6f7]">
            关闭
          </button>
          <span className="ml-auto text-[10.5px] text-ink3">{usage ? `${usage.input} / ${usage.output} tok` : ""}</span>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {!available && <Note tone="warn" title="智能体不可用：">{status?.hint || "未检测到 pi CLI"}</Note>}
        {!canWrite && <Note tone="warn" title="当前角色为只读：">没有写入权限，无法生成内容。</Note>}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">围绕哪个问题写</span>
            <select
              value={promptId}
              onChange={(e) => setPromptId(e.target.value)}
              className="h-10 w-full rounded-lg border border-hair bg-[#fbfbfc] px-3 text-[12.5px] outline-none focus:border-accent/60 focus:bg-white"
            >
              <option value="">（不指定，按品牌通用选题）</option>
              {(prompts || []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.intent} · {p.text}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">体裁</span>
            <select
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              className="h-10 w-full rounded-lg border border-hair bg-[#fbfbfc] px-3 text-[12.5px] outline-none focus:border-accent/60 focus:bg-white"
            >
              {GENRES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
        </div>

        {stage.length > 0 && (
          <div className="rounded-lg border border-hair2 bg-[#fafafb] px-3 py-2">
            {stage.map((s, i) => (
              <div key={i} className="text-[10.5px] leading-relaxed text-ink3">
                · {s}
              </div>
            ))}
          </div>
        )}

        {thinking && (
          <div className="rounded-lg border border-hair2 bg-white">
            <button
              onClick={() => setShowThink((v) => !v)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11.5px] text-ink2"
            >
              <Badge tone="info">思考</Badge>
              <span>{thinking.length} 字</span>
              <span className="ml-auto text-ink3">{showThink ? "收起" : "展开"}</span>
            </button>
            {showThink && (
              <div className="max-h-40 overflow-y-auto border-t border-hair2 px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap text-ink3">
                {thinking}
              </div>
            )}
          </div>
        )}

        <div
          ref={boxRef}
          className={cn(
            "max-h-[46vh] min-h-[160px] overflow-y-auto rounded-xl border px-3.5 py-3",
            text ? "border-hair bg-white" : "border-dashed border-hair bg-[#fbfbfc]"
          )}
        >
          {text ? (
            <Markdown text={text} />
          ) : (
            <div className="py-10 text-center text-[12px] text-ink3">
              {running ? "等待模型输出…" : "选好问题与体裁，点「开始生成」。生成过程会实时显示在这里。"}
            </div>
          )}
        </div>

        {error && <Note tone="warn" title="生成中断：">{error}</Note>}

        {blocked.length > 0 && (
          <div className="rounded-xl border border-bad/30 bg-bad/4 px-3.5 py-2.5">
            <div className="text-[11.5px] font-semibold text-bad">
              {blocked.length} 处禁用词，改完才能发布（广告法绝对化用语）
            </div>
            <div className="mt-1.5 flex flex-col gap-1">
              {blocked.map((b, i) => (
                <div key={i} className="text-[10.5px] leading-relaxed text-ink2">
                  <b className="text-bad">{b.word}</b>
                  <span className="text-ink3"> {b.reason} · … {b.context} …</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="rounded-xl border border-hair bg-[#fafafb] px-3.5 py-2.5">
            <div className="text-[11px] font-medium text-ink2">{warnings.length} 处建议调整（不阻断发布）</div>
            <div className="mt-1 text-[10.5px] leading-relaxed text-ink3">
              {warnings.map((w) => w.word).join("、")}
            </div>
          </div>
        )}

        {result && (
          <div className="rounded-xl border border-good/30 bg-good/4 px-3.5 py-3">
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <Badge tone="ok">已入库草稿</Badge>
              <span className="font-medium">{result.title}</span>
              <span className="ml-auto tnum">
                GEOS <b className="text-[14px]">{result.geos}</b> · {result.chars} 字
              </span>
            </div>
            <div className="mt-1 text-[10.5px] text-ink3">
              已按事实卡与检索原文生成；请到列表中审阅后再发布（智能体内容不自动发布）。
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10.5px] text-ink2">
              {result.figures > 0 && <Badge tone="info">已插入 {result.figures} 张数据图</Badge>}
              {result.factIssues > 0 ? (
                <button onClick={() => setShowIssues((v) => !v)} className="text-[10.5px] font-medium text-[#9a4a00] underline underline-offset-2">
                  {result.factIssues} 个数字未溯源，{showIssues ? "收起" : "查看"}
                </button>
              ) : (
                <Badge tone="ok">数字全部可溯源</Badge>
              )}
            </div>
          </div>
        )}

        {showIssues && issues.length > 0 && (
          <div className="rounded-xl border border-warn/25 bg-warn/4 px-3.5 py-2.5">
            <div className="text-[11px] font-medium text-[#7a3a00]">以下数字在事实卡里找不到出处，发布前请核对或删改：</div>
            <div className="mt-1.5 flex flex-col gap-1">
              {issues.map((it, i) => (
                <div key={i} className="text-[10.5px] leading-relaxed text-ink2">
                  <b className="tnum text-[#7a3a00]">
                    {it.value} {it.unit}
                  </b>
                  <span className="text-ink3"> … {it.context} …</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}
