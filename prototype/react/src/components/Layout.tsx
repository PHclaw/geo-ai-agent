import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useState } from "react";
import { Icon, type IconName } from "./Icon";
import { useSession } from "../api";

type NavItem = { to: string; label: string; icon: IconName; tag?: string };
type NavGroup = { label: string; items: NavItem[] };

const NAV: NavGroup[] = [
  { label: "总览", items: [{ to: "/", label: "工作台", icon: "grid" }] },
  { label: "Agent", items: [{ to: "/agent", label: "Agent 工作台", icon: "radar" }] },
  {
    label: "① 诊断",
    items: [
      { to: "/diagnosis", label: "AI 全景诊断", icon: "radar" },
      { to: "/answers", label: "采集原文", icon: "layers" },
      { to: "/prompts", label: "提问矩阵", icon: "list" },
      { to: "/evidence", label: "C 端取证", icon: "camera" },
    ],
  },
  {
    label: "② 企业资产",
    items: [
      { to: "/knowledge", label: "知识库", icon: "book" },
      { to: "/kb", label: "文档与检索", icon: "layers" },
      { to: "/products", label: "产品库", icon: "box" },
      { to: "/site", label: "官网建站", icon: "globe" },
    ],
  },
  {
    label: "③ 内容",
    items: [
      { to: "/content", label: "内容创作", icon: "pen" },
      { to: "/avatar", label: "数字人与视频", icon: "video" },
    ],
  },
  {
    label: "④ 分发",
    items: [
      { to: "/media", label: "媒体分发", icon: "send" },
      { to: "/plan", label: "发布排期", icon: "list" },
      { to: "/links", label: "链接资产", icon: "globe" },
    ],
  },
  {
    label: "⑤ 复盘",
    items: [
      { to: "/monitor", label: "监测与复盘", icon: "chart" },
      { to: "/seo", label: "SEO 曝光率", icon: "search" },
    ],
  },
  { label: "服务商", items: [{ to: "/agency", label: "客户与白标", icon: "users" }] },
];

const TITLES: Record<string, { title: string; crumb: string }> = {
  "/": { title: "工作台", crumb: "和序装饰 · 南京 · 4 家门店" },
  "/agent": { title: "Agent 工作台", crumb: "和序装饰 › Agent › 一句话触发" },
  "/diagnosis": { title: "AI 全景诊断", crumb: "和序装饰 › 诊断 › 2026-10-27" },
  "/answers": { title: "采集原文", crumb: "和序装饰 › 诊断 › 答案与引用来源" },
  "/evidence": { title: "C 端取证", crumb: "和序装饰 › 诊断 › A 级证据采集" },
  "/prompts": { title: "提问矩阵", crumb: "和序装饰 › 诊断 › 取证题库" },
  "/knowledge": { title: "知识库", crumb: "和序装饰 › 企业资产 › 知识库" },
  "/kb": { title: "文档与检索", crumb: "和序装饰 › 企业资产 › 文档库（RAG）" },
  "/products": { title: "产品库", crumb: "和序装饰 › 企业资产 › 产品库" },
  "/site": { title: "官网建站", crumb: "和序装饰 › 企业资产 › 官网" },
  "/content": { title: "内容创作", crumb: "和序装饰 › 内容 › 内容工厂" },
  "/avatar": { title: "数字人与视频", crumb: "和序装饰 › 内容 › 数字人工作室" },
  "/media": { title: "媒体分发", crumb: "和序装饰 › 分发 › 媒体与投放" },
  "/plan": { title: "发布排期", crumb: "和序装饰 › 分发 › 养号与内容穿插" },
  "/links": { title: "链接资产", crumb: "和序装饰 › 分发 › 发布地址 / 收录 / 引用" },
  "/monitor": { title: "监测与复盘", crumb: "和序装饰 › 复盘 › 收录 / 竞品 / 归因" },
  "/seo": { title: "SEO 曝光率", crumb: "和序装饰 › 复盘 › 搜索曝光 / 收录 / 排名" },
  "/agency": { title: "客户与白标", crumb: "服务商控制台 › 自有品牌与录入客户" },
  "/ops": { title: "运营工作台", crumb: "平台运营 › 人工代投" },
  "/settings": { title: "设置与成员", crumb: "组织 › 成员与权限" },
};

const ROLE_TEXT: Record<string, string> = { owner: "负责人", editor: "编辑", viewer: "只读", ops: "平台运营" };

export default function Layout() {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const { pathname } = useLocation();
  const { me, brand, brands, switchBrand } = useSession();
  const isOps = me?.user.role === "ops";
  const meta = TITLES[pathname] ?? { title: "页面", crumb: "工作台" };
  // 面包屑跟着当前品牌走；首页不能用模板尾巴（原来写死了“南京 · 4 家门店”）
  const crumb =
    pathname === "/" && brand
      ? [brand.name, brand.city, brand.industry].filter(Boolean).join(" · ")
      : brand
        ? meta.crumb.replace(/^和序装饰/, brand.name)
        : meta.crumb;

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[244px_minmax(0,1fr)]">
      {/* 移动端遮罩 */}
      {open && (
        <button
          aria-label="关闭导航"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/25 lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-screen w-[250px] flex-col gap-5 overflow-y-auto border-r border-hair bg-white/70 px-3 py-4 backdrop-blur-2xl transition-transform duration-500 ease-apple lg:sticky lg:top-0 lg:z-[60] lg:w-auto lg:translate-x-0 ${
          open ? "translate-x-0 shadow-2xl" : "-translate-x-full"
        }`}
      >
        <NavLink to="/" className="flex items-center gap-2.5 px-2 pb-1 text-[13px] font-semibold">
          <span className="h-[17px] w-[17px] shrink-0 rounded-[5px] bg-linear-to-br from-[#7ac1ff] via-accent to-accent2" />
          GEO AI Agent
          <span className="ml-auto text-[10px] font-medium text-ink3">V1.0</span>
        </NavLink>

        {/* 品牌切换：多品牌（如演示 + 自己的客户）必须能切 */}
        {brands.length > 0 && (
          <div className="px-1">
            <div className="px-1.5 pb-1 text-[10px] font-semibold tracking-[0.09em] text-ink3 uppercase">当前品牌</div>
            <select
              value={brand?.id || ""}
              onChange={(e) => {
                setSwitching(true);
                switchBrand(e.target.value);
              }}
              disabled={switching}
              className="h-8 w-full rounded-lg border border-hair bg-white px-2 text-[12px] text-ink outline-none focus:border-accent/60 disabled:opacity-60"
              title="切换品牌"
            >
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.city ? ` · ${b.city}` : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {NAV.map((group) => (
          <nav key={group.label} className="flex flex-col gap-px">
            <div className="px-2.5 pb-1.5 text-[10px] font-semibold tracking-[0.09em] text-ink3 uppercase">
              {group.label}
            </div>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `flex h-[33px] items-center gap-2.5 rounded-[9px] px-2.5 text-[12.5px] transition-colors duration-200 ease-apple ${
                    isActive
                      ? "bg-white font-medium text-black shadow-[0_1px_2px_rgba(0,0,0,0.07)]"
                      : "text-[#3a3a3c] hover:bg-black/4"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      name={item.icon}
                      className={`h-[15px] w-[15px] shrink-0 ${isActive ? "text-accent" : "opacity-60"}`}
                    />
                    <span>{item.label}</span>
                    {item.tag && <span className="ml-auto text-[10px] text-ink3">{item.tag}</span>}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        ))}

        {isOps && (
          <nav className="flex flex-col gap-px">
            <div className="px-2.5 pb-1.5 text-[10px] font-semibold tracking-[0.09em] text-ink3 uppercase">
              内部
            </div>
            <NavLink
              to="/ops"
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex h-[33px] items-center gap-2.5 rounded-[9px] px-2.5 text-[12.5px] transition-colors duration-200 ease-apple ${
                  isActive
                    ? "bg-white font-medium text-black shadow-[0_1px_2px_rgba(0,0,0,0.07)]"
                    : "text-[#3a3a3c] hover:bg-black/4"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon name="gear" className={`h-[15px] w-[15px] shrink-0 ${isActive ? "text-accent" : "opacity-60"}`} />
                  <span>运营工作台</span>
                </>
              )}
            </NavLink>
          </nav>
        )}

        <div className="mt-auto flex flex-col gap-px border-t border-hair pt-3">
          <NavLink
            to="/settings"
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              `flex h-[33px] items-center gap-2.5 rounded-[9px] px-2.5 text-[12.5px] transition-colors duration-200 ease-apple ${
                isActive
                  ? "bg-white font-medium text-black shadow-[0_1px_2px_rgba(0,0,0,0.07)]"
                  : "text-[#3a3a3c] hover:bg-black/4"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon name="gear" className={`h-[15px] w-[15px] shrink-0 ${isActive ? "text-accent" : "opacity-60"}`} />
                <span>设置与成员</span>
                <span className="ml-auto text-[10px] text-ink3">{ROLE_TEXT[me?.user.role || "viewer"] || ""}</span>
              </>
            )}
          </NavLink>
          <NavLink
            to="/login"
            className="flex h-[33px] items-center gap-2.5 rounded-[9px] px-2.5 text-[12.5px] text-[#3a3a3c] hover:bg-black/4"
          >
            <Icon name="user" className="h-[15px] w-[15px] opacity-60" />
            登录页
          </NavLink>
          <NavLink
            to="/wizard"
            className="flex h-[33px] items-center gap-2.5 rounded-[9px] px-2.5 text-[12.5px] text-[#3a3a3c] hover:bg-black/4"
          >
            <Icon name="pen" className="h-[15px] w-[15px] opacity-60" />
            建档向导
          </NavLink>
          <a
            href="/index.html"
            className="flex h-[33px] items-center gap-2.5 rounded-[9px] px-2.5 text-[12.5px] text-[#3a3a3c] hover:bg-black/4"
          >
            <Icon name="home" className="h-[15px] w-[15px] opacity-60" />
            开始界面
          </a>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-[58px] items-center gap-3.5 border-b border-hair bg-bg/80 px-4 backdrop-blur-xl md:px-7">
          <button
            onClick={() => setOpen(true)}
            aria-label="打开导航"
            className="grid h-8 w-8 place-items-center rounded-full border border-hair bg-white text-ink2 lg:hidden"
          >
            <Icon name="menu" className="h-4 w-4" />
          </button>
          <div>
            <div className="hidden text-[11.5px] text-ink3 md:block">{crumb}</div>
            <h1 className="m-0 text-[17px] font-semibold tracking-[-0.022em]">{meta.title}</h1>
          </div>
          <div className="flex-1" />
          <label className="hidden h-[31px] w-[208px] items-center gap-2 rounded-full border border-hair bg-white/80 px-3 text-[12px] text-ink3 md:flex">
            <Icon name="search" className="h-[13px] w-[13px]" />
            <input
              type="search"
              placeholder="搜索品牌 / 内容 / 媒体"
              className="w-full border-0 bg-transparent text-ink outline-none placeholder:text-ink3"
            />
          </label>
          <button
            aria-label="通知"
            className="relative grid h-[31px] w-[31px] place-items-center rounded-full border border-hair bg-white text-ink2"
          >
            <Icon name="bell" className="h-[15px] w-[15px]" />
            <span className="absolute top-[5px] right-[5px] h-1.5 w-1.5 rounded-full border-[1.5px] border-white bg-bad" />
          </button>
          <div className="grid h-[29px] w-[29px] place-items-center rounded-full bg-linear-to-br from-[#0a84ff] to-accent2 text-[10.5px] font-semibold text-white">
            {(me?.user.name || me?.user.phone || "").slice(0, 2) || "—"}
          </div>
        </header>

        <main className="w-full max-w-[1440px] px-4 pt-5 pb-14 md:px-7">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
