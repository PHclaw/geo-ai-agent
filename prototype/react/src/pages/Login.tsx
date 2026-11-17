import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "../components/Icon";
import { cn } from "../components/ui";
import { login, register } from "../api";
import { ApiError, setToken } from "../api/client";

const TRUST: [string, string][] = [
  ["和", "#0a84ff"],
  ["栖", "#5e5ce6"],
  ["木", "#1d9d5a"],
  ["连", "#b25000"],
];

const DEMO = { phone: "13800000000", password: "123456" };

export default function Login() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function flash(m: string) {
    setMsg(m);
    window.setTimeout(() => setMsg(null), 2600);
  }

  async function submit() {
    setErr(null);
    if (!/^1\d{10}$/.test(phone.trim())) {
      setErr("请输入 11 位手机号");
      return;
    }
    if (password.length < 6) {
      setErr("密码至少 6 位");
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") {
        const out = await login(phone.trim(), password);
        setToken(out.token);
        flash("登录成功，正在进入工作台…");
        window.setTimeout(() => nav("/"), 500);
      } else {
        const out = await register(phone.trim(), password, name.trim() || phone.trim());
        setToken((out as { token: string }).token);
        flash("注册成功，先花 3 分钟建档");
        window.setTimeout(() => nav("/wizard"), 500);
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "网络异常，请确认后端已启动（:4100）");
    } finally {
      setBusy(false);
    }
  }

  function fillDemo() {
    setMode("login");
    setPhone(DEMO.phone);
    setPassword(DEMO.password);
    setErr(null);
    flash("已填入演示账号，直接点登录即可");
  }

  const inputCls =
    "h-10 w-full rounded-[10px] border border-hair bg-[#fbfbfc] px-3 text-[13px] outline-none transition-all duration-200 focus:border-accent/60 focus:bg-white focus:ring-3 focus:ring-accent/12";

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-[52px] items-center gap-2.5 px-4 md:px-10">
        <Link to="/" className="flex items-center gap-2.5 text-[13px] font-semibold">
          <span className="h-[17px] w-[17px] rounded-[5px] bg-linear-to-br from-[#7ac1ff] via-accent to-accent2" />
          GEO AI Agent
        </Link>
        <button onClick={fillDemo} className="ml-auto rounded-full border border-hair bg-white px-3 py-1 text-[11.5px] text-ink2 hover:bg-[#f7f7f8]">
          用演示账号体验
        </button>
      </header>

      <main className="mx-auto grid w-full max-w-[1080px] flex-1 items-center gap-8 px-4 py-6 pb-16 md:px-10 xl:grid-cols-[minmax(0,1fr)_460px] xl:gap-20">
        <section className="order-2 xl:order-1">
          <h1 className="m-0 text-[26px] leading-[1.1] font-semibold tracking-[-0.032em] xl:text-[46px]">
            先看清 AI 眼里的你，
            <br />
            <span className="text-ink3">再决定钱该花在哪。</span>
          </h1>
          <p className="mt-4 max-w-[420px] text-[13.5px] leading-relaxed text-ink2 xl:mt-[18px] xl:text-[14px]">
            登录后即可创建品牌档案，跑一次真实探测，拿到带证据原文的 AI 可见度报告。
          </p>

          <ul className="mt-6 hidden list-none flex-col gap-2.5 p-0 xl:flex">
            {[
              "6 个主流 AI 平台并行探测，结果可追溯到答案原文",
              "诊断 → 事实卡 → 内容 → 分发 全流程数据打通",
              "首次诊断免费，不绑定投放预算",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5 text-[12.5px] text-[#3a3a3c]">
                <span className="mt-0.5 grid h-[15px] w-[15px] shrink-0 place-items-center rounded-full bg-accent/10 text-[9px] text-accent">
                  ✓
                </span>
                {t}
              </li>
            ))}
          </ul>

          <div className="mt-7 hidden items-center gap-2.5 text-[11.5px] text-ink3 xl:flex">
            <div className="flex">
              {TRUST.map(([t, c], i) => (
                <span
                  key={t}
                  className={cn(
                    "grid h-6 w-6 place-items-center rounded-full border-2 border-bg text-[9px] font-semibold text-white",
                    i > 0 && "-ml-[7px]"
                  )}
                  style={{ background: c }}
                >
                  {t}
                </span>
              ))}
            </div>
            演示租户：和序装饰（南京 · 4 家门店）
          </div>
        </section>

        <section className="order-1 rounded-[20px] border border-hair bg-white p-6 shadow-[0_20px_60px_rgba(0,0,0,0.06)] xl:order-2 xl:p-[30px]">
          <div className="mb-4 flex gap-1 rounded-[10px] bg-[#ebebef] p-1">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  setErr(null);
                }}
                className={cn(
                  "h-8 flex-1 rounded-[7px] text-[12.5px] transition-all duration-200",
                  mode === m ? "bg-white font-medium text-black shadow-[0_1px_2px_rgba(0,0,0,0.09)]" : "text-[#5a5a5e]"
                )}
              >
                {m === "login" ? "登录" : "注册新账号"}
              </button>
            ))}
          </div>

          <p className="mb-5 text-[12.5px] text-ink2">
            {mode === "login" ? "登录后进入工作台；演示账号已预置品牌与事实卡。" : "注册后进入建档向导，3 分钟建完可跑第一次诊断。"}
          </p>

          <label className="mb-3 block">
            <span className="mb-1.5 block text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">手机号</span>
            <span className="relative block">
              <span className="absolute top-1/2 left-3 -translate-y-1/2 border-r border-hair pr-2.5 text-[13px] text-ink2">+86</span>
              <input
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
                placeholder="请输入手机号"
                className={cn(inputCls, "pl-[54px]")}
              />
            </span>
          </label>

          <label className="mb-3 block">
            <span className="mb-1.5 block text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">密码</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
              className={inputCls}
            />
          </label>

          {mode === "register" && (
            <label className="mb-3 block">
              <span className="mb-1.5 block text-[10.5px] font-semibold tracking-[0.05em] text-ink3 uppercase">称呼</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：李敏" className={inputCls} />
            </label>
          )}

          {err && (
            <div className="mb-3 rounded-lg border border-bad/15 bg-bad/4 px-3 py-2 text-[11.5px] text-[#a40010]">{err}</div>
          )}

          <button
            onClick={submit}
            disabled={busy}
            className={cn(
              "mt-1 h-[42px] w-full rounded-[10px] text-[13.5px] font-medium text-white transition-all duration-200",
              busy ? "cursor-wait bg-accent/60" : "bg-accent hover:bg-[#0077ed] active:scale-[0.99]"
            )}
          >
            {busy ? "处理中…" : mode === "login" ? "登录" : "注册并开始建档"}
          </button>

          <div className="my-5 flex items-center gap-2.5 text-[11px] text-ink3">
            <span className="h-px flex-1 bg-hair" />
            或
            <span className="h-px flex-1 bg-hair" />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              disabled
              title="微信开放平台资质尚未申请，暂未开放"
              className="flex h-[38px] cursor-not-allowed items-center justify-center gap-1.5 rounded-[10px] border border-hair bg-[#f7f7f8] text-[12.5px] text-ink3"
            >
              <Icon name="user" className="h-3.5 w-3.5" />
              微信扫码（未开放）
            </button>
            <button
              onClick={fillDemo}
              className="flex h-[38px] items-center justify-center gap-1.5 rounded-[10px] border border-hair bg-white text-[12.5px] hover:bg-[#f7f7f8]"
            >
              <Icon name="users" className="h-3.5 w-3.5" />
              演示账号
            </button>
          </div>

          <p className="mt-5 text-[10.5px] leading-relaxed text-ink3">
            演示账号 <span className="font-mono">13800000000 / 123456</span>。真实部署时请通过环境变量
            <span className="font-mono"> GEO_TOKEN_SECRET </span>替换默认密钥。
          </p>

          <div className="mt-3.5 text-center text-[12px] text-ink2">
            还没有品牌档案？
            <Link to="/wizard" className="text-accent">
              先建一个 →
            </Link>
          </div>
        </section>
      </main>

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
