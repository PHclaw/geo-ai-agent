import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Card, CardHead, Note, cn, td, trHover } from "./ui";
import { deleteBrand, fetchBrands, useApi, useSession } from "../api";

export default function BrandManager() {
  const { brandId, me, reload } = useSession();
  const { data: brands, loading, reload: reloadBrands } = useApi(() => fetchBrands(), []);
  const [pending, setPending] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const canManage = me?.user.role === "owner";
  const list = brands || [];

  function flash(m: string) {
    setToast(m);
    window.setTimeout(() => setToast(null), 3000);
  }

  async function doDelete(id: string, name: string) {
    if (confirmText.trim() !== name) return flash("输入的品牌名不一致，已取消");
    setBusy(true);
    try {
      const out = await deleteBrand(id, name);
      const total = Object.values(out.deleted || {}).reduce((a, b) => a + b, 0);
      flash(`已删除「${out.name}」，同时清理 ${total} 条关联数据`);
      setPending(null);
      setConfirmText("");
      await reloadBrands();
      // 删的正好是当前品牌 → 回工作台并重新取会话
      if (id === brandId) {
        await reload();
        window.location.href = "/";
      }
    } catch (e) {
      flash(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card flush>
      <div className="px-[18px] pt-[15px]">
        <CardHead
          title="品牌管理"
          sub="一个租户可有多个品牌（例如演示品牌 + 自己的客户）；切换在左侧「当前品牌」"
          right={
            canManage ? (
              <Link
                to="/wizard?new=1"
                className="rounded-full bg-accent px-3 py-1.5 text-[11.5px] font-medium text-white hover:bg-[#0077ed]"
              >
                新建品牌
              </Link>
            ) : (
              <Badge tone="warn">仅负责人可管理</Badge>
            )
          }
        />
      </div>

      <div className="mt-3 w-full overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              {["品牌", "城市", "行业", "创建时间", "操作"].map((h) => (
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
            {list.map((b) => (
              <tr key={b.id} className={trHover}>
                <td className={cn(td, "font-medium text-ink")}>
                  {b.name}
                  {b.id === brandId && (
                    <span className="ml-2">
                      <Badge tone="info">当前</Badge>
                    </span>
                  )}
                </td>
                <td className={td}>{b.city || "—"}</td>
                <td className={td}>{b.industry || "—"}</td>
                <td className={cn(td, "tnum")}>{new Date(b.createdAt).toLocaleDateString("zh-CN")}</td>
                <td className={cn(td, "text-right whitespace-nowrap")}>
                  {canManage ? (
                    <button
                      onClick={() => {
                        setPending(pending === b.id ? null : b.id);
                        setConfirmText("");
                      }}
                      className="text-[11.5px] text-ink3 hover:text-bad"
                    >
                      {pending === b.id ? "取消" : "删除"}
                    </button>
                  ) : (
                    <span className="text-[11px] text-ink3">—</span>
                  )}
                </td>
              </tr>
            ))}
            {!list.length && !loading && (
              <tr>
                <td colSpan={5} className="px-3.5 py-10 text-center text-[12px] text-ink3">
                  还没有品牌，点右上角「新建品牌」建档
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pending && (
        <div className="mx-[18px] mt-3 mb-4">
          <Note tone="warn" title="删除不可恢复：">
            将同时清空该品牌的
            <b className="mx-1">事实卡、提问、探测记录、内容、产品、订单、知识库文档与切片</b>
            （共 12 张表）。删除前系统会先整包备份到服务端
            <code className="mx-1 rounded bg-black/5 px-1 py-0.5 text-[11px]">data/backups/</code>
            ，但界面不提供一键恢复，建议只删确属废弃的品牌。
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={`输入「${list.find((b) => b.id === pending)?.name || ""}」确认`}
                className="h-8 w-56 rounded-lg border border-hair bg-white px-2.5 text-[12px] outline-none focus:border-bad/60"
              />
              <button
                onClick={() => {
                  const target = list.find((b) => b.id === pending);
                  if (target) void doDelete(target.id, target.name);
                }}
                disabled={busy}
                className={cn(
                  "rounded-full px-3 py-1.5 text-[12px] font-medium text-white",
                  busy ? "cursor-wait bg-bad/50" : "bg-bad hover:opacity-90"
                )}
              >
                {busy ? "删除中…" : "确认删除"}
              </button>
            </div>
          </Note>
        </div>
      )}

      <div
        className={cn(
          "fixed bottom-6 left-1/2 z-[200] -translate-x-1/2 rounded-full bg-[rgba(28,28,30,0.94)] px-4 py-2.5 text-[12px] text-white backdrop-blur-md transition-all duration-300",
          toast ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
        )}
      >
        {toast}
      </div>
    </Card>
  );
}
