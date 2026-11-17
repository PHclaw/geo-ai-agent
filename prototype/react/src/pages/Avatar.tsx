import { useEffect, useState } from "react";
import { Badge, Card, CardHead, Note, cn, td, trHover } from "../components/ui";
import {
  createAvatarAsset,
  createAvatarJob,
  deleteAvatarAsset,
  fetchAvatarConfig,
  saveAvatarConfig,
  useApi,
  useSession,
} from "../api";

type AvTab = "speak" | "look" | "voice";
type AssetKind = "look" | "voice" | "tpl";

const inputCls =
  "h-9 rounded-lg border border-hair bg-[#fbfbfc] px-2.5 text-[12px] outline-none focus:border-accent/60 focus:bg-white focus:ring-3 focus:ring-accent/12";
const btnCls =
  "h-9 rounded-lg px-3.5 text-[12px] font-medium text-white bg-accent hover:bg-[#0077ed] disabled:cursor-not-allowed disabled:bg-accent/50";

export default function Avatar() {
  const { brandId, me } = useSession();
  const canWrite = me?.permissions?.write !== false;
  const [tab, setTab] = useState<AvTab>("speak");
  const [script, setScript] = useState<Record<string, string>>({});
  const [look, setLook] = useState("");
  const [voice, setVoice] = useState("");
  const [tpl, setTpl] = useState("");
  const [assetKind, setAssetKind] = useState<AssetKind>("look");
  const [assetName, setAssetName] = useState("");
  const [assetMeta, setAssetMeta] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const { data, loading, error, reload } = useApi(
    brandId ? () => fetchAvatarConfig(brandId) : null,
    [brandId]
  );

  useEffect(() => {
    if (!data) return;
    const next: Record<string, string> = {};
    for (const s of data.segments) next[s.key] = s.text || "";
    setScript(next);
    setLook((v) => v || data.assets.looks[0]?.id || "");
    setVoice((v) => v || data.assets.voices[0]?.id || "");
    setTpl((v) => v || data.assets.tpls[0]?.id || "");
  }, [data]);

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3000);
  }

  async function saveScript() {
    if (!brandId || !data) return;
    try {
      const r = await saveAvatarConfig(
        brandId,
        data.segments.map((s) => ({ key: s.key, text: script[s.key] || "" }))
      );
      flash(`脚本已保存 ${r.saved} 段`);
      void reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "保存失败");
    }
  }

  async function addAsset() {
    if (!brandId || !assetName.trim()) return flash("请填写名称");
    try {
      await createAvatarAsset(brandId, { kind: assetKind, name: assetName.trim(), meta: assetMeta.trim() });
      setAssetName("");
      setAssetMeta("");
      flash("配置已添加");
      void reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "添加失败");
    }
  }

  async function removeAsset(id: string) {
    if (!brandId) return;
    try {
      await deleteAvatarAsset(brandId, id);
      flash("配置已删除");
      void reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "删除失败");
    }
  }

  async function submitJob(kind: string) {
    if (!brandId) return;
    try {
      const r = await createAvatarJob(brandId, kind, { script, look, voice, tpl });
      flash(`任务已登记（${r.status}）：${r.note}`);
      void reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "登记失败");
    }
  }

  if (loading && !data) return <div className="enter p-6 text-[13px] text-ink3">正在读取数字人配置…</div>;
  if (error && !data) return <Note tone="warn" title="读取失败：">{error}</Note>;

  const segments = data?.segments || [];
  const assets = data?.assets || { looks: [], voices: [], tpls: [] };
  const jobs = data?.jobs || [];
  const words = Object.values(script).join("").replace(/\s/g, "").length;
  const seconds = Math.round((words / 245) * 60);

  return (
    <div className="enter flex flex-col gap-3.5">
      <Note tone="info" title="能力边界：">
        脚本、形象、音色、模板配置与生成任务都<b className="mx-1">真实落库</b>；
        视频播放器、语音克隆与外部视频生成服务<b className="mx-1">尚未接入</b>，点「生成」只会登记一条 pending 任务，不会假装已出片。
      </Note>

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="info">配置来源：数据库</Badge>
        <Badge tone="warn">播放器 / 生成服务未接入</Badge>
        <span className="text-[11.5px] text-ink3">待处理任务 {jobs.length} 条</span>
        <div className="ml-auto flex gap-2">
          <button onClick={() => void submitJob("speak")} disabled={!canWrite} className={btnCls}>
            登记 1 条口播任务
          </button>
        </div>
      </div>

      <Card flush>
        <div className="flex gap-5 overflow-x-auto border-b border-hair px-[18px]">
          {([
            ["speak", "口播生产"],
            ["look", "我的形象"],
            ["voice", "声音与模板"],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={cn(
                "h-[46px] shrink-0 border-b-2 text-[12.5px]",
                tab === k ? "border-accent font-medium text-ink" : "border-transparent text-ink3 hover:text-ink2"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "speak" && (
          <div className="p-[16px_18px]">
            <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1.3fr)_320px]">
              <Card>
                <CardHead
                  title="口播脚本 · 60 秒"
                  sub="按分段编辑并保存到数据库；留空表示尚未编写"
                  right={
                    <button onClick={() => void saveScript()} disabled={!canWrite} className="rounded-full border border-hair bg-white px-2.5 py-1 text-[11.5px] hover:bg-[#f6f6f7] disabled:opacity-40">
                      保存脚本
                    </button>
                  }
                />
                <div className="mt-3">
                  {segments.map((s) => (
                    <div key={s.key} className="border-b border-hair2 py-2.5 last:border-0">
                      <div className="mb-1.5 flex items-center gap-2 text-[10.5px] tracking-[0.05em] text-ink3 uppercase">
                        <b className="text-[11.5px] font-semibold tracking-normal text-ink">{s.label}</b>
                        <span className="ml-auto tabular-nums">{s.time}</span>
                      </div>
                      <textarea
                        rows={3}
                        value={script[s.key] || ""}
                        onChange={(e) => setScript((prev) => ({ ...prev, [s.key]: e.target.value }))}
                        placeholder={`填写${s.label}内容…`}
                        className="w-full resize-y rounded-lg border border-transparent bg-[#fbfbfc] px-2.5 py-2 text-[12.5px] leading-relaxed text-[#2b2b2e] outline-none focus:border-accent/50 focus:bg-white focus:ring-3 focus:ring-accent/10"
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3.5 text-[12px] text-[#3a3a3c]">
                  <span className="ml-auto text-[11px] text-ink3">字数 {words} · 预计时长 {seconds}s</span>
                </div>
              </Card>

              <div className="flex flex-col gap-3.5">
                <Card>
                  <CardHead title="预览" right={<Badge tone="default">9:16</Badge>} />
                  <div className="mt-3">
                    <div
                      className="relative mx-auto aspect-[9/16] w-full max-w-[248px] overflow-hidden rounded-[22px] border border-white/10"
                      style={{ background: "radial-gradient(110% 80% at 50% 0%, #2a3341 0%, #10141b 55%, #05070a 100%)" }}
                    >
                      <div className="absolute right-2.5 bottom-10 left-2.5 z-2 rounded-[7px] bg-black/42 px-2 py-1.5 text-center text-[9.5px] leading-[1.55] text-white">
                        {(script.pain || script.hook || "尚未编写脚本").slice(0, 34)}
                      </div>
                      <button
                        disabled
                        title="播放器未接入"
                        aria-label="播放"
                        className="absolute top-1/2 left-1/2 z-3 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-not-allowed place-items-center rounded-full border border-white/30 bg-white/10 text-white/60"
                      >
                        ▶
                      </button>
                    </div>
                  </div>
                  <div className="mt-2.5 text-center text-[10.5px] text-ink3">播放器未接入，此处仅展示脚本字幕预览</div>
                </Card>

                <Card>
                  <CardHead title="配置新增" sub="形象 / 音色 / 模板都存进数据库" />
                  <div className="mt-3 flex flex-col gap-2">
                    <select value={assetKind} onChange={(e) => setAssetKind(e.target.value as AssetKind)} className={inputCls}>
                      <option value="look">形象</option>
                      <option value="voice">音色</option>
                      <option value="tpl">模板</option>
                    </select>
                    <input value={assetName} onChange={(e) => setAssetName(e.target.value)} placeholder="名称" className={inputCls} />
                    <input value={assetMeta} onChange={(e) => setAssetMeta(e.target.value)} placeholder="备注（相似度 / 比例等）；形象可填 mine" className={inputCls} />
                    <button onClick={() => void addAsset()} disabled={!canWrite} className={btnCls}>添加配置</button>
                  </div>
                </Card>
              </div>
            </div>
          </div>
        )}

        {tab === "look" && (
          <div className="p-[16px_18px]">
            <CardHead title="形象库" sub={`已登记 ${assets.looks.length} 个形象；当前选中 ${assets.looks.find((x) => x.id === look)?.name || "无"}`} />
            <div className="mt-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
              {assets.looks.map((l) => (
                <div key={l.id} className={cn("overflow-hidden rounded-xl border", look === l.id ? "border-accent" : "border-hair")}>
                  <button onClick={() => setLook(l.id)} className="w-full text-left">
                    <div className="relative h-[74px] bg-linear-to-b from-[#eceef2] to-[#dfe3e9]">
                      <div className="absolute top-[20%] left-1/2 h-[30px] w-[30px] -translate-x-1/2 rounded-full bg-[#b9c0cb]" />
                    </div>
                    <div className="border-t border-hair px-2 py-1.5 text-[10.5px]">{l.name}</div>
                  </button>
                  <button
                    onClick={() => void removeAsset(l.id)}
                    disabled={!canWrite}
                    className="w-full border-t border-hair2 py-1 text-[10px] text-ink3 hover:text-[#bf0010] disabled:opacity-40"
                  >
                    删除
                  </button>
                </div>
              ))}
              {!assets.looks.length && <div className="col-span-full py-8 text-center text-[12px] text-ink3">暂无形象，在「口播生产 › 配置新增」添加</div>}
            </div>
            <div className="mt-3.5">
              <Note tone="warn" title="合规提示：">
                使用真人肖像或克隆音色前需取得授权书并完成活体校验；<b>上传授权书与活体校验服务尚未接入</b>，请先在线下完成并留档。
              </Note>
            </div>
          </div>
        )}

        {tab === "voice" && (
          <div className="p-[16px_18px]">
            <div className="grid gap-3.5 lg:grid-cols-2">
              <Card>
                <CardHead title="音色" sub={`已登记 ${assets.voices.length} 个`} />
                <div className="mt-3 flex flex-col gap-1.5">
                  {assets.voices.map((v) => (
                    <div key={v.id} className={cn("flex items-center gap-2.5 rounded-[10px] border px-2.5 py-2", voice === v.id ? "border-accent bg-accent/4" : "border-hair")}>
                      <button onClick={() => setVoice(v.id)} className="flex flex-1 items-center gap-2.5 text-left">
                        <span className="text-[12px]">{v.name}</span>
                        <span className="ml-auto text-[10px] text-ink3">{v.meta}</span>
                      </button>
                      <button onClick={() => void removeAsset(v.id)} disabled={!canWrite} className="text-[10px] text-ink3 hover:text-[#bf0010] disabled:opacity-40">删除</button>
                    </div>
                  ))}
                  {!assets.voices.length && <div className="py-6 text-center text-[12px] text-ink3">暂无音色配置</div>}
                </div>
              </Card>
              <Card>
                <CardHead title="视频模板" sub={`已登记 ${assets.tpls.length} 个`} />
                <div className="mt-3 flex flex-col gap-1.5">
                  {assets.tpls.map((t) => (
                    <div key={t.id} className={cn("flex items-center gap-2.5 rounded-[10px] border px-2.5 py-2", tpl === t.id ? "border-accent bg-accent/4" : "border-hair")}>
                      <button onClick={() => setTpl(t.id)} className="flex flex-1 items-center gap-2.5 text-left">
                        <span className="text-[12px]">{t.name}</span>
                        <span className="ml-auto text-[10px] text-ink3">{t.meta}</span>
                      </button>
                      <button onClick={() => void removeAsset(t.id)} disabled={!canWrite} className="text-[10px] text-ink3 hover:text-[#bf0010] disabled:opacity-40">删除</button>
                    </div>
                  ))}
                  {!assets.tpls.length && <div className="py-6 text-center text-[12px] text-ink3">暂无模板配置</div>}
                </div>
              </Card>
            </div>
          </div>
        )}
      </Card>

      <Card flush>
        <div className="px-4 pt-4 pb-3">
          <CardHead title="生成任务" sub="真实落库；外部生成服务接入前一律保持 pending" right={<Badge tone="default">{jobs.length} 条</Badge>} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-hair bg-[#fafafb] text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">
                <th className="px-3.5 py-2.5">登记时间</th>
                <th className="px-3.5 py-2.5">类型</th>
                <th className="px-3.5 py-2.5">状态</th>
                <th className="px-3.5 py-2.5">说明</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className={trHover}>
                  <td className={cn(td, "tnum")}>{j.createdAt.slice(5, 16)}</td>
                  <td className={td}>{j.kind}</td>
                  <td className={td}><Badge tone="warn">{j.status}</Badge></td>
                  <td className={td}>{j.note}</td>
                </tr>
              ))}
              {!jobs.length && (
                <tr>
                  <td colSpan={4} className={cn(td, "py-8 text-center text-ink3")}>还没有任务，点上方「登记口播任务」创建一条</td>
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
