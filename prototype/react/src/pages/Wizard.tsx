import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Badge, Note, cn } from "../components/ui";
import { api, setBrandId } from "../api/client";

const STEPS = [
  { n: 1, label: "品牌信息" },
  { n: 2, label: "品类与区域" },
  { n: 3, label: "门店" },
  { n: 4, label: "卖点与资质" },
  { n: 5, label: "确认" },
];

const TIPS = ["预计还需 3 分钟", "还差门店信息", "建议至少填 1 家门店", "最后一步，确认后开始探测", "确认后约 30 分钟出报告"];

const inputCls =
  "h-[43px] w-full rounded-[11px] border border-hair bg-[#fbfbfc] px-3.5 text-[13.5px] outline-none transition-all duration-200 focus:border-accent/60 focus:bg-white focus:ring-3 focus:ring-accent/12";
const selectCls =
  "h-[43px] w-full rounded-[11px] border border-hair bg-[#fbfbfc] px-3.5 text-[13.5px] outline-none focus:border-accent/60 focus:bg-white";
const labelCls = "mb-1.5 block text-[11.5px] font-semibold tracking-[0.04em] text-ink3 uppercase";

const CATS = ["住宅整装", "老房翻新", "局部改造", "工装 / 商业空间", "软装陈设"];
const AREAS = ["南京 · 主城六区", "南京 · 江宁", "南京 · 浦口", "镇江", "扬州"];
const QUALS = ["建筑装饰装修二级资质", "ISO 9001", "行业协会会员", "地方媒体报道"];
const RIVALS = ["栖岸设计", "木言空间", "连云装饰"];

export default function Wizard() {
  const nav = useNavigate();
  const loc = useLocation();
  // ?new=1 表示“从设置页新建品牌”：不要预填演示品牌，否则会建出同名品牌
  const isNew = new URLSearchParams(loc.search).get("new") === "1";
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(
    isNew
      ? { name: "", alias: "", since: "", city: "", intro: "", industry: "", priceRange: "" }
      : {
          name: "和序装饰",
          alias: "和序、和序空间设计",
          since: "2012",
          city: "南京",
          intro: "自 2012 年起服务南京主城，专注住宅整装与老房翻新，目前 4 家直营门店。",
          industry: "家装",
          priceRange: "980–1350 元/㎡",
        }
  );
  const [stores, setStores] = useState<
    { name: string; address: string; phone: string; hours: string; features: string }[]
  >([]);
  const [cats, setCats] = useState<string[]>(isNew ? [] : ["住宅整装", "老房翻新", "局部改造"]);
  const [areas, setAreas] = useState<string[]>(isNew ? [] : ["南京 · 主城六区", "南京 · 江宁", "南京 · 浦口"]);
  const [quals, setQuals] = useState<string[]>(isNew ? [] : ["建筑装饰装修二级资质", "ISO 9001"]);
  const [rivals, setRivals] = useState<string[]>(isNew ? [] : ["栖岸设计", "木言空间", "连云装饰"]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function flash(m: string) {
    setMsg(m);
    window.setTimeout(() => setMsg(null), 2600);
  }

  function toggle(list: string[], set: (v: string[]) => void, v: string) {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  }

  function go(n: number) {
    const next = Math.max(1, Math.min(5, n));
    if (next > 1 && !form.name.trim()) {
      flash("请先填写品牌名称");
      setStep(1);
      return;
    }
    setStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function finish() {
    if (busy) return;
    setBusy(true);
    try {
      const brand = await api<{ id: string; name: string }>("/brands", {
        method: "POST",
        body: {
          name: form.name,
          alias: form.alias,
          city: form.city,
          since: form.since,
          intro: form.intro,
          industry: form.industry,
          priceRange: form.priceRange,
          stores: stores.filter((s) => s.name.trim()),
          competitors: rivals,
        },
      });
      setBrandId(brand.id);
      flash(`已创建「${brand.name}」与 40 条提问，正在进入诊断…`);
      window.setTimeout(() => nav("/diagnosis"), 800);
    } catch (e) {
      flash(e instanceof Error ? e.message : "创建失败，请确认后端已启动");
    } finally {
      setBusy(false);
    }
  }

  const picks = (list: string[], set: (v: string[]) => void, all: string[]) => (
    <div className="flex flex-wrap gap-1.5">
      {all.map((v) => (
        <button
          key={v}
          onClick={() => toggle(list, set, v)}
          className={cn(
            "h-[31px] rounded-full border px-3.5 text-[12.5px] transition-all duration-200",
            list.includes(v) ? "border-ink bg-ink text-white" : "border-hair bg-white text-[#3a3a3c] hover:bg-[#f7f7f8]"
          )}
        >
          {v}
        </button>
      ))}
      <button
        onClick={() => {
          const v = window.prompt("输入自定义项")?.trim();
          if (!v) return;
          if (list.includes(v)) return flash("该项已存在");
          set([...list, v]);
        }}
        className="h-[31px] rounded-full border border-dashed border-hair px-3.5 text-[12.5px] text-accent"
      >
        + 自定义
      </button>
    </div>
  );

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex h-[54px] items-center gap-3 border-b border-hair bg-white/70 px-4 backdrop-blur-xl md:px-10">
        <Link to="/" className="flex items-center gap-2.5 text-[13px] font-semibold">
          <span className="h-[17px] w-[17px] rounded-[5px] bg-linear-to-br from-[#7ac1ff] via-accent to-accent2" />
          GEO AI Agent
        </Link>
        <div className="ml-auto flex items-center gap-3.5 text-[12px] text-ink3">
          <span>草稿已自动保存 · 第 {step} 步</span>
          <Link to="/" className="hover:text-ink">
            稍后继续 〉
          </Link>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[880px] px-4 py-8 pb-20 md:px-10">
        {/* 步骤条 */}
        <ol className="m-0 flex list-none items-start p-0">
          {STEPS.map((s, i) => (
            <li key={s.n} className="relative flex flex-1 cursor-pointer flex-col items-center gap-1.5" onClick={() => go(s.n)}>
              {i > 0 && <span className="absolute top-[13px] -left-1/2 h-px w-full bg-hair" />}
              <i
                className={cn(
                  "relative z-1 grid h-[27px] w-[27px] place-items-center rounded-full border text-[11px] font-semibold not-italic transition-all duration-300",
                  step === s.n
                    ? "border-transparent bg-ink text-white shadow-[0_0_0_4px_rgba(29,29,31,0.08)]"
                    : step > s.n
                      ? "border-transparent bg-good text-white"
                      : "border-hair bg-white text-ink3"
                )}
              >
                {step > s.n ? "✓" : s.n}
              </i>
              <span
                className={cn(
                  "hidden text-[11px] whitespace-nowrap sm:block",
                  step === s.n ? "font-medium text-ink" : step > s.n ? "text-ink2" : "text-ink3"
                )}
              >
                {s.label}
              </span>
            </li>
          ))}
        </ol>

        {/* 标题 */}
        <div className="mt-6 mb-4">
          <div className="text-[11px] font-semibold tracking-[0.08em] text-accent uppercase">Step {step} / 5</div>
          <h1 className="mt-2 text-[clamp(23px,3.2vw,31px)] leading-[1.2] font-semibold tracking-[-0.028em]">
            {step === 1 && "先告诉我们，你是谁。"}
            {step === 2 && "客户会怎么找你？"}
            {step === 3 && "你有几家店，开在哪？"}
            {step === 4 && "凭什么选你而不是对手？"}
            {step === 5 && "确认一下，就可以开始了。"}
          </h1>
          <p className="mt-2 max-w-[560px] text-[13px] leading-relaxed text-ink2">
            {step === 1 && "这些信息会写进知识库，成为所有内容的唯一口径。别名很关键——AI 常用别称提到你。"}
            {step === 2 && "选得越准，后面生成的 120 条真实问法就越贴近你的客户。最少选 1 个类目、1 个区域。"}
            {step === 3 && "门店信息是 AI 最容易说错的部分（电话、营业时间、是否可预约）。填准了，识别准确率会明显提升。"}
            {step === 4 && "写具体的、可验证的差异点。避免「品质第一」「行业领先」这类 AI 不会引用的空话。"}
            {step === 5 && "确认后将自动生成 120 条提问矩阵，并在 8 个 AI 平台开始首次探测，约 30 分钟出报告。"}
          </p>
        </div>

        {/* 面板 */}
        <div key={step} className="animate-[fadeUp_0.45s_var(--ease-apple)] rounded-[18px] border border-hair bg-white p-6">
          {step === 1 && (
            <div className="flex flex-col gap-[18px]">
              <label>
                <span className={labelCls}>
                  品牌名称<span className="ml-0.5 text-bad">*</span>
                </span>
                <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：和序装饰" />
                <span className="mt-1.5 block text-[11px] text-ink3">建议使用营业执照上的全称，或对外统一使用的品牌名。</span>
              </label>

              <label>
                <span className={labelCls}>别名 / 简称 / 曾用名</span>
                <input className={inputCls} value={form.alias} onChange={(e) => setForm({ ...form, alias: e.target.value })} placeholder="多个用逗号分隔" />
                <span className="mt-1.5 block text-[11px] text-ink3">AI 答案里出现这些词也会被统计为提及。</span>
              </label>

              <div className="grid gap-3.5 sm:grid-cols-2">
                <label>
                  <span className={labelCls}>成立年份</span>
                  <input className={inputCls} value={form.since} onChange={(e) => setForm({ ...form, since: e.target.value })} />
                </label>
                <label>
                  <span className={labelCls}>
                    所在城市<span className="ml-0.5 text-bad">*</span>
                  </span>
                  <input className={inputCls} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                </label>
              </div>

              <div className="grid gap-3.5 sm:grid-cols-2">
                <label>
                  <span className={labelCls}>行业</span>
                  <input
                    className={inputCls}
                    value={form.industry}
                    onChange={(e) => setForm({ ...form, industry: e.target.value })}
                    placeholder="例如：家装"
                  />
                </label>
                <label>
                  <span className={labelCls}>价格区间</span>
                  <input
                    className={inputCls}
                    value={form.priceRange}
                    onChange={(e) => setForm({ ...form, priceRange: e.target.value })}
                    placeholder="例如：980–1350 元/㎡"
                  />
                </label>
              </div>

              <label>
                <span className={labelCls}>一句话介绍</span>
                <textarea
                  rows={3}
                  value={form.intro}
                  onChange={(e) => setForm({ ...form, intro: e.target.value })}
                  className="w-full resize-y rounded-[11px] border border-hair bg-[#fbfbfc] px-3.5 py-2.5 text-[13.5px] leading-relaxed outline-none transition-all duration-200 focus:border-accent/60 focus:bg-white focus:ring-3 focus:ring-accent/12"
                />
                <span className="mt-1.5 block text-[11px] text-ink3">不超过 60 字，会成为 AI 答案里最可能被引用的那句描述。</span>
              </label>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-[18px]">
              <div>
                <span className={labelCls}>
                  主营类目<span className="ml-0.5 text-bad">*</span>
                </span>
                {picks(cats, setCats, CATS)}
              </div>
              <div>
                <span className={labelCls}>
                  服务区域<span className="ml-0.5 text-bad">*</span>
                </span>
                {picks(areas, setAreas, AREAS)}
                <span className="mt-2 block text-[11px] text-ink3">地域词会参与诊断（例如「河西附近有哪些装修公司」）。</span>
              </div>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <label>
                  <span className={labelCls}>价格带</span>
                  <select className={selectCls} defaultValue="980–1,350 元/㎡（中端）">
                    <option>980–1,350 元/㎡（中端）</option>
                    <option>600–980 元/㎡（性价比）</option>
                    <option>1,350 元/㎡ 以上（高端）</option>
                  </select>
                </label>
                <label>
                  <span className={labelCls}>主要客户</span>
                  <select className={selectCls} defaultValue="二手房 / 老房业主">
                    <option>二手房 / 老房业主</option>
                    <option>新房交付业主</option>
                    <option>投资出租房业主</option>
                  </select>
                </label>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-3">
              {stores.map((s, i) => (
                <div key={i} className="rounded-[13px] border border-dashed border-hair p-4">
                  <div className="mb-2.5 flex items-center text-[11px] text-ink3">
                    门店 {i + 1}
                    <button onClick={() => setStores((v) => v.filter((_, j) => j !== i))} className="ml-auto text-[11px] text-[#bf0010]">
                      删除
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label>
                      <span className={labelCls}>门店名称</span>
                      <input
                        className={inputCls}
                        value={s.name}
                        onChange={(e) => setStores((v) => v.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                        placeholder="例如：和序装饰 · 河西店"
                      />
                    </label>
                    <label>
                      <span className={labelCls}>联系电话</span>
                      <input
                        className={inputCls}
                        value={s.phone}
                        onChange={(e) => setStores((v) => v.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))}
                      />
                    </label>
                  </div>
                  <label className="mt-3 block">
                    <span className={labelCls}>详细地址</span>
                    <input
                      className={inputCls}
                      value={s.address}
                      onChange={(e) => setStores((v) => v.map((x, j) => (j === i ? { ...x, address: e.target.value } : x)))}
                    />
                  </label>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label>
                      <span className={labelCls}>营业时间</span>
                      <input
                        className={inputCls}
                        value={s.hours}
                        onChange={(e) => setStores((v) => v.map((x, j) => (j === i ? { ...x, hours: e.target.value } : x)))}
                      />
                    </label>
                    <label>
                      <span className={labelCls}>特色</span>
                      <input
                        className={inputCls}
                        value={s.features}
                        onChange={(e) => setStores((v) => v.map((x, j) => (j === i ? { ...x, features: e.target.value } : x)))}
                      />
                    </label>
                  </div>
                </div>
              ))}
              {!stores.length && (
                <div className="rounded-[13px] bg-[#fbfbfc] px-4 py-6 text-center text-[12px] text-ink3">
                  还没有门店，点下方按钮添加；也可以稍后在「知识库 › 门店信息」补全
                </div>
              )}
              <button
                onClick={() => setStores((v) => [...v, { name: "", address: "", phone: "", hours: "", features: "" }])}
                className="w-fit rounded-full border border-hair bg-white px-3.5 py-1.5 text-[12.5px] hover:bg-[#f6f6f7]"
              >
                + 添加门店
              </button>
              <span className="text-[11px] text-ink3">填写的门店会随建档一起写入数据库，不再使用演示门店。</span>
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-col gap-[18px]">
              <div>
                <span className={labelCls}>核心卖点（建议 3~5 条）</span>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {["水电 10 年质保，写进合同", "工地全程直播，业主随时可看", "报价单逐项列明，增项需书面确认", "48 小时内出平面方案"].map((s, i) => (
                    <input key={i} className={inputCls} defaultValue={s} />
                  ))}
                </div>
                <span className="mt-2 block text-[11px] text-ink3">每条都应该是「可以拿出来验证」的事实，而不是形容词。</span>
              </div>
              <div>
                <span className={labelCls}>资质与背书</span>
                {picks(quals, setQuals, QUALS)}
                <span className="mt-2 block text-[11px] text-ink3">资质是 AI 判断「权威性」的重要依据，会直接影响首选率。</span>
              </div>
              <div>
                <span className={labelCls}>竞品（可自动推荐）</span>
                {picks(rivals, setRivals, RIVALS)}
              </div>
            </div>
          )}

          {step === 5 && (
            <div>
              <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-[13px] border border-hair bg-hair sm:grid-cols-2">
                {[
                  ["品牌", `${form.name}（别名：${form.alias}）`],
                  ["城市 / 成立", `${form.city} · ${form.since} 年`],
                  ["主营类目", cats.join("、") || "—"],
                  ["服务区域", areas.map((a) => a.replace("南京 · ", "")).join("、") || "—"],
                  ["门店", "4 家（河西旗舰店、江宁店等）"],
                  ["价格带", "980–1,350 元/㎡"],
                  ["核心卖点", "水电 10 年质保、工地直播、增项书面确认"],
                  ["竞品", rivals.join("、") || "—"],
                ].map(([k, v]) => (
                  <div key={k} className="bg-white px-4 py-3.5">
                    <dt className="mb-1 text-[10.5px] tracking-[0.05em] text-ink3 uppercase">{k}</dt>
                    <dd className="m-0 text-[13px]">{v}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-4">
                <Note>首次诊断将消耗 2,880 次探测配额（120 条 × 8 平台 × 3 次采样），不占用内容与投放额度。</Note>
              </div>

              <label className="mt-4 flex items-center gap-2 text-[12.5px] text-ink2">
                <input type="checkbox" defaultChecked />
                允许系统采集公开 AI 回答作为诊断证据
              </label>
            </div>
          )}
        </div>

        {/* 底部 */}
        <div className="mt-5 flex items-center gap-3">
          <span className="text-[11.5px] text-ink3">{TIPS[step - 1]}</span>
          <div className="ml-auto flex gap-2.5">
            {step > 1 && (
              <button onClick={() => go(step - 1)} className="h-[42px] rounded-[10px] border border-hair bg-white px-5 text-[13px] hover:bg-[#f7f7f8]">
                上一步
              </button>
            )}
            <button
              onClick={() => (step === 5 ? finish() : go(step + 1))}
              disabled={busy}
              className={cn(
                "h-[42px] rounded-[10px] px-6 text-[13px] font-medium text-white shadow-[0_6px_18px_rgba(0,113,227,0.22)]",
                busy ? "cursor-wait bg-accent/60" : "bg-accent hover:bg-[#0077ed]"
              )}
            >
              {busy ? "正在创建…" : step === 5 ? "开始 AI 全景诊断" : "继续"}
            </button>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 text-[11px] text-ink3">
          <Badge tone="info">提示</Badge>
          点击上方步骤条可直接回跳；所有字段均自动保存为草稿
        </div>
      </div>

      <div
        className={cn(
          "fixed bottom-6 left-1/2 z-[200] -translate-x-1/2 rounded-full bg-[rgba(28,28,30,0.94)] px-4 py-2.5 text-[12px] text-white backdrop-blur-md transition-all duration-400",
          msg ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3.5 opacity-0"
        )}
      >
        {msg}
      </div>
    </div>
  );
}
