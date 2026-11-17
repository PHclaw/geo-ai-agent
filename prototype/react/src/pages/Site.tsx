import { useState } from "react";
import { Badge, Card, CardHead, Note, cn } from "../components/ui";
import {
  auditSite,
  downloadLlmsTxt,
  fetchSiteAssets,
  useSession,
  type SiteAssets,
  type SiteAudit,
} from "../api";

const LEVEL = {
  pass: { icon: "✓", cls: "text-good", bg: "bg-good/8", label: "通过" },
  warn: { icon: "!", cls: "text-warn", bg: "bg-warn/8", label: "待改进" },
  fail: { icon: "✕", cls: "text-bad", bg: "bg-bad/8", label: "不通过" },
} as const;

const TABS = [
  { key: "llms", label: "llms.txt" },
  { key: "jsonld", label: "JSON-LD" },
  { key: "head", label: "<head> 片段" },
] as const;

export default function Site() {
  const { brandId, brand, me } = useSession();
  const [url, setUrl] = useState("");
  const [audit, setAudit] = useState<SiteAudit | null>(null);
  const [assets, setAssets] = useState<SiteAssets | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("llms");
  const [toast, setToast] = useState<string | null>(null);

  const canWrite = me?.permissions?.write !== false;

  function flash(m: string) {
    setToast(m);
    window.setTimeout(() => setToast(null), 2800);
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      flash(`${label} 已复制`);
    } catch {
      flash("复制失败，请手动全选复制");
    }
  }

  async function runAudit() {
    if (!brandId || busy) return;
    if (!url.trim()) return flash("请先填写官网地址");
    setBusy(true);
    setError("");
    try {
      const r = await auditSite(brandId, url.trim());
      setAudit(r);
      setUrl(r.url);
      flash(`体检完成：${r.score} 分（${r.passed}/${r.total} 项通过）`);
      void loadAssets(r.url);
    } catch (e) {
      setAudit(null);
      setError(e instanceof Error ? e.message : "体检失败");
    } finally {
      setBusy(false);
    }
  }

  async function loadAssets(target: string) {
    if (!brandId) return;
    setLoadingAssets(true);
    try {
      setAssets(await fetchSiteAssets(brandId, target));
    } catch (e) {
      flash(e instanceof Error ? e.message : "资产生成失败");
    } finally {
      setLoadingAssets(false);
    }
  }

  async function saveLlmsTxt() {
    if (!brandId) return;
    try {
      const blob = await downloadLlmsTxt(brandId, audit?.url || url);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "llms.txt";
      a.click();
      URL.revokeObjectURL(a.href);
      flash("llms.txt 已下载，上传到网站根目录即可");
    } catch (e) {
      flash(e instanceof Error ? e.message : "下载失败");
    }
  }

  const currentText =
    tab === "llms" ? assets?.llmsTxt || "" : tab === "jsonld" ? [assets?.jsonLdBusiness, assets?.jsonLdFaq].filter(Boolean).join("\n\n") : assets?.headSnippet || "";

  return (
    <div className="enter flex flex-col gap-3.5">
      <Note tone="info" title="官网在这里的作用是「事实源」，不是流量入口：">
        中文 AI 引用里，品牌自有站点只占约 1.37%，绝大多数引用发生在外部渠道。所以这里做的不是建站，而是让 AI
        <b className="mx-1">读得懂、抓得到、愿意引用</b>
        你的站。
      </Note>

      {/* 体检 */}
      <Card>
        <CardHead
          title="站点 GEO 体检"
          sub="真抓你的网站：robots / llms.txt / 结构化数据 / 爬虫可达性 / 可引用段落"
          right={audit && <Badge tone={audit.score >= 75 ? "ok" : audit.score >= 50 ? "warn" : "bad"}>{audit.score} 分 · {audit.grade}</Badge>}
        />
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void runAudit()}
            placeholder={`填写官网地址，例如 ${brand?.name ? "www.your-site.com" : "example.com"}`}
            className="h-10 flex-1 rounded-lg border border-hair bg-[#fbfbfc] px-3 text-[12.5px] outline-none focus:border-accent/60 focus:bg-white focus:ring-3 focus:ring-accent/12"
          />
          <button
            onClick={() => void runAudit()}
            disabled={busy || !canWrite}
            className={cn(
              "h-10 shrink-0 rounded-lg px-5 text-[12.5px] font-medium text-white",
              busy || !canWrite ? "cursor-not-allowed bg-accent/50" : "bg-accent hover:bg-[#0077ed]"
            )}
          >
            {busy ? "体检中…" : "开始体检"}
          </button>
        </div>
        <div className="mt-2 text-[10.5px] text-ink3">
          只读取公开页面（首页 / robots.txt / llms.txt / sitemap.xml），不会修改你的站点
        </div>

        {error && (
          <div className="mt-3">
            <Note tone="warn" title="体检失败：">{error}</Note>
          </div>
        )}

        {audit && (
          <div className="mt-4">
            <div className="flex flex-wrap items-end gap-3 border-b border-hair pb-3">
              <div>
                <div className="text-[10.5px] font-semibold tracking-[0.07em] text-ink3 uppercase">总分</div>
                <div className="tnum mt-1 text-[34px] leading-none font-semibold tracking-[-0.035em]">
                  {audit.score}
                  <small className="ml-1 text-[12.5px] font-medium text-ink3">/100 · {audit.passed}/{audit.total} 项</small>
                </div>
              </div>
              <div className="ml-auto text-right text-[10.5px] leading-relaxed text-ink3">
                <div>{audit.url}</div>
                <div>体检时间 {new Date(audit.fetchedAt).toLocaleString("zh-CN", { hour12: false })}</div>
              </div>
            </div>

            <div className="mt-2 flex flex-col">
              {audit.checks.map((c) => {
                const lv = LEVEL[c.level];
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
                      {c.level !== "pass" && <div className="mt-0.5 text-[10.5px] leading-relaxed text-ink3">怎么改：{c.fix}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      {/* 资产 */}
      <Card flush>
        <div className="px-[18px] pt-[15px]">
          <CardHead
            title="GEO 资产（从事实卡生成，可直接部署）"
            sub={
              loadingAssets
                ? "生成中…"
                : assets
                  ? `含 ${assets.storeCount} 家门店、${assets.faqCount} 组问答`
                  : "填写官网后点「开始体检」，或直接点下方按钮生成"
            }
            right={
              <div className="flex gap-2">
                {!assets && !loadingAssets && canWrite && (
                  <button
                    onClick={() => void loadAssets(audit?.url || url)}
                    className="rounded-full border border-hair bg-white px-3 py-1 text-[11.5px] hover:bg-[#f6f6f7]"
                  >
                    生成资产
                  </button>
                )}
                {assets && (
                  <button
                    onClick={() => void saveLlmsTxt()}
                    className="rounded-full bg-ink px-3 py-1 text-[11.5px] font-medium text-white hover:bg-[#2b2b2e]"
                  >
                    下载 llms.txt
                  </button>
                )}
              </div>
            }
          />
        </div>

        {assets ? (
          <>
            <div className="mt-3 flex gap-1.5 px-[18px]">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-[11.5px] transition-colors",
                    tab === t.key ? "border-ink bg-ink text-white" : "border-hair bg-white hover:bg-[#f7f7f8]"
                  )}
                >
                  {t.label}
                </button>
              ))}
              <button onClick={() => void copy(currentText, TABS.find((t) => t.key === tab)?.label || "内容")} className="ml-auto text-[11.5px] text-accent">
                复制
              </button>
            </div>
            <pre className="mx-[18px] mt-2.5 max-h-[380px] overflow-auto rounded-xl border border-hair2 bg-[#fafafb] px-3.5 py-3 text-[11.5px] leading-relaxed whitespace-pre-wrap">
              {currentText || "（无内容）"}
            </pre>
            <div className="px-[18px] py-3 text-[10.5px] leading-relaxed text-ink3">
              {tab === "llms" && "把该文件放到网站根目录，访问 /llms.txt 能打开即生效。AI 抓到它会优先按这里的口径描述你。"}
              {tab === "jsonld" && "贴进页面 <head> 或由模板输出。LocalBusiness 让 AI 知道你是谁、在哪、电话多少；FAQPage 让答案可被直接摘取。"}
              {tab === "head" && "整段粘贴到首页 <head> 内。改完回上面重新体检，「结构化数据」应变为通过。"}
            </div>
          </>
        ) : (
          <div className="px-[18px] pb-6 pt-4 text-[12px] text-ink3">
            资产包含：llms.txt（品牌/门店/价格/问答的纯文本版）、LocalBusiness JSON-LD、FAQPage JSON-LD。
          </div>
        )}
      </Card>

      {/* 部署三步 */}
      <Card>
        <CardHead title="部署顺序" sub="改了才会被 AI 抓到；三个文件就够" />
        <div className="mt-3 flex flex-col gap-2.5">
          {[
            ["1", "上传 llms.txt 到网站根目录", "目标：能打开 https://你的域名/llms.txt"],
            ["2", "把 JSON-LD 贴进首页 <head>", "LocalBusiness 用于实体识别，FAQPage 用于问答摘取"],
            ["3", "回本页重新体检", "确认「llms.txt」「结构化数据」「AI 爬虫可访问」三项变绿"],
          ].map(([n, t, s]) => (
            <div key={n} className="flex items-start gap-2.5 border-b border-hair2 py-2 last:border-0">
              <span className="mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-accent/10 text-[10px] font-semibold text-accent">
                {n}
              </span>
              <div>
                <b className="text-[12.5px] font-medium">{t}</b>
                <div className="text-[10.5px] text-ink3">{s}</div>
              </div>
            </div>
          ))}
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
