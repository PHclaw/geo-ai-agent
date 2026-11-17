import { useState } from "react";
import { Badge, Card, CardHead, Note, cn, td, trHover } from "../components/ui";
import BrandManager from "../components/BrandManager";
import {
  createMember,
  fetchAuditLogs,
  fetchMembers,
  removeMember,
  updateMemberRole,
  useApi,
  useSession,
  type Member,
} from "../api";

const ROLE_TEXT: Record<string, string> = { owner: "负责人", editor: "编辑", viewer: "只读", ops: "平台运营" };
const ROLE_TONE: Record<string, "ok" | "info" | "warn" | "default" | "purple"> = {
  owner: "ok",
  editor: "info",
  viewer: "default",
  ops: "purple",
};

const PERMISSIONS = [
  ["查看看板与报告", "✓", "✓", "✓"],
  ["新建/修改事实卡（非价格）", "✓", "✓", "—"],
  ["修改价格类事实卡", "✓", "—", "—"],
  ["运行诊断 / 生成内容", "✓", "✓", "—"],
  ["下单与投放", "✓", "✓", "—"],
  ["邀请成员 / 改角色", "✓", "—", "—"],
  ["查看审计日志", "✓", "—", "—"],
];

const inputCls =
  "h-10 w-full rounded-lg border border-hair bg-[#fbfbfc] px-3 text-[12.5px] outline-none transition-all duration-200 focus:border-accent/60 focus:bg-white focus:ring-3 focus:ring-accent/12";

export default function Settings() {
  const { me, loading: meLoading, reload: reloadMe } = useSession();
  const perms = me?.permissions || { write: false, manage: false, ops: false };
  const isOwner = perms.manage;

  const { data: members, loading, reload: reloadMembers } = useApi(() => fetchMembers(), []);
  const { data: logs, reload: reloadLogs } = useApi(isOwner ? () => fetchAuditLogs() : null, [isOwner]);

  const [form, setForm] = useState({ phone: "", name: "", role: "editor", password: "" });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [invited, setInvited] = useState<{ phone: string; password: string } | null>(null);

  function flash(m: string) {
    setToast(m);
    window.setTimeout(() => setToast(null), 3000);
  }

  async function invite() {
    if (!isOwner) return;
    if (!/^1\d{10}$/.test(form.phone)) {
      flash("请输入 11 位手机号");
      return;
    }
    setBusy(true);
    try {
      const password = form.password || `geo-${Math.random().toString(36).slice(2, 8)}`;
      const out = await createMember({ ...form, password });
      setInvited({ phone: out.phone, password: out.initialPassword || password });
      flash(`已添加成员 ${out.phone}`);
      setForm({ phone: "", name: "", role: "editor", password: "" });
      await reloadMembers();
    } catch (e) {
      flash(e instanceof Error ? e.message : "添加失败");
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(m: Member) {
    if (!isOwner || m.role === "owner") return;
    const next = m.role === "editor" ? "viewer" : "editor";
    try {
      await updateMemberRole(m.id, next);
      flash(`${m.phone} 已设为${ROLE_TEXT[next]}`);
      await reloadMembers();
    } catch (e) {
      flash(e instanceof Error ? e.message : "修改失败");
    }
  }

  async function remove(m: Member) {
    if (!isOwner || m.isSelf || m.role === "owner") return;
    if (!window.confirm(`确认移除成员 ${m.name || m.phone}？移除后该账号无法登录本租户`)) return;
    try {
      await removeMember(m.id);
      flash("已移除");
      await reloadMembers();
    } catch (e) {
      flash(e instanceof Error ? e.message : "移除失败");
    }
  }

  if (meLoading || loading) {
    return <div className="grid place-items-center py-24 text-[12.5px] text-ink3">正在读取成员…</div>;
  }

  const list = members || [];

  return (
    <div className="enter flex flex-col gap-3.5">
      {/* 当前身份 */}
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="text-[15px] font-semibold tracking-[-0.02em]">
              {me?.tenant.name} · {me?.user.name || me?.user.phone}
            </div>
            <div className="mt-1 text-[11.5px] text-ink3">
              你的角色：
              <b className="text-ink">{ROLE_TEXT[me?.user.role || "viewer"]}</b>
              {!perms.write && "（只读：不能修改数据，如需编辑请联系负责人调整角色）"}
            </div>
          </div>
          <div className="ml-auto flex gap-2">
            <Badge tone={ROLE_TONE[me?.user.role || "viewer"]}>{ROLE_TEXT[me?.user.role || "viewer"]}</Badge>
            {!perms.write && <Badge tone="warn">只读：不能修改数据</Badge>}
          </div>
        </div>
      </Card>

      {/* 非负责人提示：让“看不到”变成“知道为什么看不到” */}
      {!isOwner && (
        <Note tone="info" title="你当前是编辑/只读角色：">
          邀请成员、调整角色与查看操作日志仅负责人可见；价格类事实卡也只能由负责人修改。如需这些权限，请联系负责人调整。
        </Note>
      )}

      {/* 品牌管理：新建 / 删除 / 看清当前品牌 */}
      <BrandManager />

      {/* 邀请 */}
      {isOwner && (
        <Card>
          <CardHead title="邀请成员" sub="同租户成员共享品牌数据；角色可随时调整" right={<Badge tone="info">仅负责人可操作</Badge>} />
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">手机号</span>
              <input
                className={inputCls}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "").slice(0, 11) })}
                placeholder="11 位手机号"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">姓名</span>
              <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="可留空" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">角色</span>
              <select className={inputCls} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="editor">编辑（可改内容与事实，不能改价格/成员）</option>
                <option value="viewer">只读（仅查看看板与报告）</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">初始密码</span>
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="留空自动生成"
                />
                <button
                  onClick={invite}
                  disabled={busy}
                  className={cn(
                    "shrink-0 rounded-lg px-3.5 text-[12.5px] font-medium text-white",
                    busy ? "bg-accent/60" : "bg-accent hover:bg-[#0077ed]"
                  )}
                >
                  {busy ? "添加中" : "添加"}
                </button>
              </div>
            </label>
          </div>
          {invited && (
            <div className="mt-3">
              <Note tone="warn" title="请把初始密码转告成员：">
                {invited.phone} / <span className="font-mono">{invited.password}</span>，登录后建议尽快修改。
              </Note>
            </div>
          )}
        </Card>
      )}

      {/* 成员列表 */}
      <Card flush>
        <div className="px-[18px] pt-[15px]">
          <CardHead title="成员" sub="负责人唯一，不能降级或移除；其余成员可调整角色" right={<Badge tone="info">{list.length} 人</Badge>} />
        </div>
        <div className="mt-3 w-full overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {["成员", "手机号", "角色", "加入时间", "操作"].map((h) => (
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
              {list.map((m) => (
                <tr key={m.id} className={trHover}>
                  <td className={cn(td, "font-medium text-ink")}>
                    {m.name || "—"}
                    {m.isSelf && <Badge tone="info" className="ml-1.5">我</Badge>}
                  </td>
                  <td className={cn(td, "font-mono text-[11px]")}>{m.phone}</td>
                  <td className={td}>
                    <Badge tone={ROLE_TONE[m.role]}>{ROLE_TEXT[m.role] || m.role}</Badge>
                  </td>
                  <td className={cn(td, "tnum")}>{new Date(m.createdAt).toLocaleDateString("zh-CN")}</td>
                  <td className={cn(td, "text-right")}>
                    {isOwner && m.role !== "owner" && !m.isSelf ? (
                      <>
                        <button onClick={() => changeRole(m)} className="rounded-full border border-hair bg-white px-2.5 py-1 text-[11.5px] hover:bg-[#f6f6f7]">
                          设为{ROLE_TEXT[m.role === "editor" ? "viewer" : "editor"]}
                        </button>
                        <button onClick={() => remove(m)} className="ml-1.5 text-[11.5px] text-ink3 hover:text-bad">
                          移除
                        </button>
                      </>
                    ) : (
                      <span className="text-[11px] text-ink3">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 权限矩阵 */}
      <Card flush>
        <div className="px-[18px] pt-[15px]">
          <CardHead title="权限说明" sub="价格类事实卡单独限制：口径一旦被改，所有内容与 AI 回答都会跟着错" />
        </div>
        <div className="mt-3 w-full overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {["能力", "负责人", "编辑", "只读"].map((h) => (
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
              {PERMISSIONS.map(([name, o, e, v]) => (
                <tr key={name} className={trHover}>
                  <td className={cn(td, "font-medium text-ink")}>{name}</td>
                  <td className={cn(td, o === "✓" ? "text-good" : "text-ink3")}>{o}</td>
                  <td className={cn(td, e === "✓" ? "text-good" : "text-ink3")}>{e}</td>
                  <td className={cn(td, v === "✓" ? "text-good" : "text-ink3")}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 审计日志 */}
      {isOwner && (
        <Card flush>
          <div className="px-[18px] pt-[15px]">
            <CardHead
              title="操作日志"
              sub="所有写操作自动记录（谁、何时、对什么做了什么），保留最近 100 条"
              right={
                <button
                  onClick={() => {
                    void reloadLogs();
                    void reloadMe();
                  }}
                  className="rounded-full border border-hair bg-white px-2.5 py-1 text-[11.5px] hover:bg-[#f6f6f7]"
                >
                  刷新
                </button>
              }
            />
          </div>
          <div className="mt-2 max-h-[360px] overflow-y-auto px-[18px] pb-3">
            {(logs || []).map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-2 border-b border-hair2 py-2 text-[11.5px] last:border-0">
                <span className="text-ink3">{new Date(l.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
                <span className="font-medium">{l.userName || "—"}</span>
                <span className="text-ink2" title={l.action}>
                  {l.actionText || l.action}
                </span>
                {l.objectId && <span className="text-ink3">#{l.objectId.slice(0, 8)}</span>}
              </div>
            ))}
            {!(logs || []).length && <div className="py-6 text-center text-[11.5px] text-ink3">暂无记录</div>}
          </div>
        </Card>
      )}

      <Note tone="info" title="多租户隔离：">
        每个企业是独立租户，成员只能看到本租户的品牌与数据；跨租户访问会返回 404。平台运营角色（ops）只用于内部代投，不属于客户租户。
      </Note>

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
