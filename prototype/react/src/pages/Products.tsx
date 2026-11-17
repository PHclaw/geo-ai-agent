import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Card, CardHead, Drawer, Note, cn, td, trHover } from "../components/ui";
import {
  createProduct,
  deleteProduct,
  fetchProducts,
  organizeProducts,
  updateProduct,
  useApi,
  useSession,
  type Product,
  type ProductInput,
} from "../api";

const EMPTY: ProductInput = { name: "", category: "", price: "", unit: "", specs: "", sellingPoints: "", applicable: "" };

const inputCls =
  "h-10 w-full rounded-lg border border-hair bg-[#fbfbfc] px-3 text-[12.5px] outline-none transition-all duration-200 focus:border-accent/60 focus:bg-white focus:ring-3 focus:ring-accent/12";

export default function Products() {
  const { brandId, brand, me } = useSession();
  const { data: products, loading, error, reload } = useApi(brandId ? () => fetchProducts(brandId) : null, [brandId]);

  const [cat, setCat] = useState("全部");
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ProductInput>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const canWrite = me?.permissions?.write !== false;
  const list = useMemo(() => products || [], [products]);

  const cats = useMemo(() => ["全部", ...Array.from(new Set(list.map((p) => p.category).filter(Boolean)))], [list]);
  const rows = cat === "全部" ? list : list.filter((p) => p.category === cat);
  const warned = list.filter((p) => p.priceCheck?.level === "warn");

  function flash(m: string) {
    setToast(m);
    window.setTimeout(() => setToast(null), 2800);
  }

  async function extract() {
    if (!brandId || extracting) return;
    const ok = window.confirm(
      "将读取知识库文档，用 AI 提取可售卖的产品/套餐（约 20–40 秒）。\n\n同名产品会自动跳过；价格会对事实卡区间做校验，超区间只提醒不阻断。继续吗？"
    );
    if (!ok) return;
    setExtracting(true);
    try {
      const out = await organizeProducts(brandId);
      const parts = [`新增 ${out.added} 个`];
      if (out.skipped) parts.push(`跳过同名 ${out.skipped} 个`);
      if (out.warned) parts.push(`${out.warned} 个价格超区间`);
      flash(`AI 提取完成：${parts.join("，")}`);
      await reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "AI 提取失败";
      if (msg.includes("已有") && msg.includes("产品")) {
        setExtracting(false);
        const go = window.confirm(`${msg}\n\n仍要追加一轮吗？（会产生同义条目，建议自行删减）`);
        if (!go) return;
        setExtracting(true);
        try {
          const out = await organizeProducts(brandId, true);
          flash(`已追加 ${out.added} 个（跳过 ${out.skipped} 个，超区间 ${out.warned} 个）`);
          await reload();
        } catch (e2) {
          flash(e2 instanceof Error ? e2.message : "追加失败");
        } finally {
          setExtracting(false);
        }
        return;
      }
      flash(msg);
    } finally {
      setExtracting(false);
    }
  }

  function openCreate() {
    setForm({ ...EMPTY, category: cats.find((c) => c !== "全部") || "" });
    setEditing(null);
    setCreating(true);
  }

  function openEdit(p: Product) {
    setForm({
      name: p.name,
      category: p.category,
      price: p.price,
      unit: p.unit,
      specs: p.specs,
      sellingPoints: p.sellingPoints,
      applicable: p.applicable,
      status: p.status,
    });
    setEditing(p);
    setCreating(true);
  }

  async function save() {
    if (!brandId || busy) return;
    if (!String(form.name || "").trim()) return flash("产品名称必填");
    setBusy(true);
    try {
      if (editing) {
        await updateProduct(editing.id, form);
        flash("已保存");
      } else {
        await createProduct(brandId, form);
        flash("已新增");
      }
      setCreating(false);
      setEditing(null);
      await reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Product) {
    if (!window.confirm(`删除产品「${p.name}」？`)) return;
    try {
      await deleteProduct(p.id);
      flash("已删除");
      await reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : "删除失败");
    }
  }

  if (loading) {
    return <div className="grid place-items-center py-24 text-[12.5px] text-ink3">正在读取产品库…</div>;
  }

  return (
    <div className="enter flex flex-col gap-3.5">
      <Note tone="info" title="产品库只放「明细」，价格口径仍以事实卡为准：">
        这里写每个套餐的包含项与单价；对外的价格区间、质保、工期请放在
        <Link to="/knowledge" className="mx-1 text-accent underline underline-offset-2">
          知识库 · 事实卡
        </Link>
        。SKU 价格若超出事实卡区间，会在列表里标黄提醒。
      </Note>

      {(error || warned.length > 0) && (
        <div className="flex flex-col gap-2">
          {error && <Note tone="warn" title="读取失败：">{error}</Note>}
          {warned.length > 0 && (
            <Note tone="warn" title={`${warned.length} 个产品价格超出事实卡区间：`}>
              {warned.map((p) => `${p.name}（${p.price}）`).join("、")}
            </Note>
          )}
        </div>
      )}

      {/* 概览 */}
      <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <Card className="p-4!">
          <div className="text-[10.5px] font-semibold tracking-[0.07em] text-ink3 uppercase">产品 / 服务</div>
          <div className="tnum mt-1.5 text-[26px] leading-none font-semibold">
            {list.length}
            <small className="ml-1 text-[11.5px] font-medium text-ink3">个 SKU</small>
          </div>
        </Card>
        <Card className="p-4!">
          <div className="text-[10.5px] font-semibold tracking-[0.07em] text-ink3 uppercase">类目</div>
          <div className="tnum mt-1.5 text-[26px] leading-none font-semibold">
            {Math.max(0, cats.length - 1)}
            <small className="ml-1 text-[11.5px] font-medium text-ink3">类</small>
          </div>
        </Card>
        <Card className="p-4!">
          <div className="text-[10.5px] font-semibold tracking-[0.07em] text-ink3 uppercase">价格口径异常</div>
          <div className={cn("tnum mt-1.5 text-[26px] leading-none font-semibold", warned.length ? "text-warn" : "")}>
            {warned.length}
            <small className="ml-1 text-[11.5px] font-medium text-ink3">个待核对</small>
          </div>
        </Card>
      </section>

      {/* 列表 */}
      <Card flush>
        <div className="px-[18px] pt-[15px]">
          <CardHead
            title="产品与服务"
            sub={`${brand?.name || ""} · 会进 llms.txt 的「服务与产品」与 JSON-LD 的 OfferCatalog`}
            right={
              canWrite ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => void extract()}
                    disabled={extracting}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-[11.5px] transition-colors",
                      extracting
                        ? "cursor-wait border-accent/30 bg-accent/6 text-accent"
                        : "border-hair bg-white hover:bg-[#f6f6f7]"
                    )}
                    title="读知识库文档，用 AI 提取产品清单"
                  >
                    {extracting ? "AI 提取中…" : "AI 自动提取"}
                  </button>
                  <button
                    onClick={openCreate}
                    className="rounded-full bg-accent px-3.5 py-1.5 text-[11.5px] font-medium text-white hover:bg-[#0077ed]"
                  >
                    + 新建产品
                  </button>
                </div>
              ) : (
                <Badge tone="warn">只读</Badge>
              )
            }
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5 px-[18px] pb-3">
          {cats.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={cn(
                "rounded-full border px-3 py-1 text-[11.5px] transition-colors",
                cat === c ? "border-ink bg-ink text-white" : "border-hair bg-white hover:bg-[#f7f7f8]"
              )}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="w-full overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {["产品", "类目", "价格", "适用", "卖点", "状态", "操作"].map((h) => (
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
                  <td className={cn(td, "font-medium text-ink")}>{p.name}</td>
                  <td className={td}>{p.category || "—"}</td>
                  <td className={cn(td, "tnum whitespace-nowrap")}>
                    {p.price || "—"}
                    {p.priceCheck?.level === "warn" && (
                      <span title={p.priceCheck.note} className="ml-1.5">
                        <Badge tone="warn">超区间</Badge>
                      </span>
                    )}
                  </td>
                  <td className={cn(td, "max-w-[140px] truncate")}>{p.applicable || "—"}</td>
                  <td className={cn(td, "max-w-[240px] truncate text-ink2")}>{p.sellingPoints || "—"}</td>
                  <td className={td}>
                    <Badge tone={p.status === "active" ? "ok" : "default"}>{p.status === "active" ? "在售" : "隐藏"}</Badge>
                  </td>
                  <td className={cn(td, "text-right whitespace-nowrap")}>
                    {canWrite ? (
                      <>
                        <button onClick={() => openEdit(p)} className="text-[11.5px] text-accent hover:underline">
                          编辑
                        </button>
                        <button onClick={() => void remove(p)} className="ml-2 text-[11.5px] text-ink3 hover:text-bad">
                          删除
                        </button>
                      </>
                    ) : (
                      <span className="text-[11px] text-ink3">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7} className="px-3.5 py-14 text-center">
                    <div className="text-[12.5px] text-ink2">还没有产品</div>
                    <div className="mt-1.5 text-[11px] leading-relaxed text-ink3">
                      先把报价单 / 服务清单上传到
                      <Link to="/kb" className="mx-1 text-accent underline underline-offset-2">
                        文档与检索
                      </Link>
                      ，或点右上角手动新建
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 新建 / 编辑 */}
      <Drawer
        open={creating}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        title={editing ? `编辑：${editing.name}` : "新建产品"}
        sub="SKU 级明细；对外价格区间由事实卡统一"
        footer={
          <div className="flex items-center gap-2">
            <button
              onClick={() => void save()}
              disabled={busy}
              className={cn(
                "rounded-full px-4 py-2 text-[12.5px] font-medium text-white",
                busy ? "cursor-wait bg-accent/60" : "bg-accent hover:bg-[#0077ed]"
              )}
            >
              {busy ? "保存中…" : "保存"}
            </button>
            <button
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
              className="rounded-full border border-hair bg-white px-3.5 py-2 text-[12.5px] hover:bg-[#f6f6f7]"
            >
              取消
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">名称 *</span>
            <input className={inputCls} value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：老房翻新全包套餐" />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">类目</span>
              <input className={inputCls} value={form.category || ""} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="整装 / 翻新 / 局部改造" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">价格</span>
              <input className={inputCls} value={form.price || ""} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="1180–1600 元/㎡" />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">适用场景</span>
              <input className={inputCls} value={form.applicable || ""} onChange={(e) => setForm({ ...form, applicable: e.target.value })} placeholder="100㎡ 三居 / 房龄 15 年以上" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">状态</span>
              <select className={inputCls} value={form.status || "active"} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="active">在售</option>
                <option value="hidden">隐藏</option>
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">包含项 / 规格（一行一条）</span>
            <textarea
              rows={5}
              value={form.specs || ""}
              onChange={(e) => setForm({ ...form, specs: e.target.value })}
              placeholder={"拆除清运\n水电全改\n泥木油漆\n主材安装"}
              className="w-full resize-y rounded-[11px] border border-hair bg-[#fbfbfc] px-3.5 py-2.5 text-[12.5px] leading-relaxed outline-none focus:border-accent/60 focus:bg-white"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">卖点（一句话，会进 llms.txt）</span>
            <textarea
              rows={3}
              value={form.sellingPoints || ""}
              onChange={(e) => setForm({ ...form, sellingPoints: e.target.value })}
              placeholder="增项 500 元以上需书面确认，水电隐蔽工程质保 10 年。"
              className="w-full resize-y rounded-[11px] border border-hair bg-[#fbfbfc] px-3.5 py-2.5 text-[12.5px] leading-relaxed outline-none focus:border-accent/60 focus:bg-white"
            />
          </label>

          <Note tone="info">价格写法随意（可写区间），系统会抽数字与事实卡的价格区间比对；超区间只提醒、不阻断。</Note>
        </div>
      </Drawer>

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
