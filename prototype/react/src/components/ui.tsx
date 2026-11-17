import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/* ---------------- Card ---------------- */
export function Card({
  children,
  className,
  flush,
}: {
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-card border border-hair bg-surface",
        flush ? "overflow-hidden" : "p-[16px_18px]",
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHead({
  title,
  sub,
  right,
  className,
}: {
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <div>
        <h2 className="m-0 text-[13.5px] font-semibold tracking-[-0.015em]">{title}</h2>
        {sub && <div className="mt-1 text-[11.5px] leading-relaxed text-ink3">{sub}</div>}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}

/* ---------------- KPI ---------------- */
export function Kpi({
  label,
  value,
  unit,
  delta,
  deltaTone = "up",
  sub,
}: {
  label: string;
  value: string | number;
  unit?: string;
  delta?: string;
  deltaTone?: "up" | "down" | "flat";
  sub?: string;
}) {
  const tone =
    deltaTone === "up"
      ? "bg-good/10 text-[#1a7a45]"
      : deltaTone === "down"
        ? "bg-bad/8 text-[#bf0010]"
        : "bg-[#f1f1f3] text-ink2";
  return (
    <div className="rounded-card border border-hair bg-surface px-[17px] pt-[15px] pb-[17px] transition-shadow duration-400 ease-apple hover:shadow-[0_10px_30px_rgba(0,0,0,0.05)]">
      <div className="text-[10.5px] font-semibold tracking-[0.07em] text-ink3 uppercase">{label}</div>
      <div className="tnum mt-[9px] text-[30px] leading-none font-semibold tracking-[-0.038em]">
        {value}
        {unit && <small className="ml-1 text-[12.5px] font-medium tracking-normal text-ink3">{unit}</small>}
      </div>
      <div className="mt-2.5 flex items-center gap-1.5">
        {delta && (
          <span className={cn("tnum inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold", tone)}>
            {delta}
          </span>
        )}
        {sub && <span className="text-[11.5px] text-ink3">{sub}</span>}
      </div>
    </div>
  );
}

/* ---------------- Badge ---------------- */
type Tone = "default" | "ok" | "warn" | "bad" | "info" | "purple";
const TONES: Record<Tone, string> = {
  default: "bg-[#f2f2f4] text-[#4a4a4d]",
  ok: "bg-good/10 text-[#1a7a45]",
  warn: "bg-warn/10 text-[#9a4a00]",
  bad: "bg-bad/8 text-[#bf0010]",
  info: "bg-accent/9 text-[#0066cc]",
  purple: "bg-accent2/10 text-[#4b48c8]",
};

export function Badge({
  children,
  tone = "default",
  dot,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-md px-[7px] text-[10.5px] font-medium whitespace-nowrap",
        TONES[tone],
        className
      )}
    >
      {dot && <span className="h-1 w-1 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/* ---------------- Bar / Meter ---------------- */
export function Bar({
  value,
  tone = "accent",
  thin,
  className,
}: {
  value: number;
  tone?: "accent" | "good" | "warn" | "bad" | "grey";
  thin?: boolean;
  className?: string;
}) {
  const fill =
    tone === "good"
      ? "bg-good"
      : tone === "warn"
        ? "bg-[#f0a33a]"
        : tone === "bad"
          ? "bg-bad"
          : tone === "grey"
            ? "bg-[#c7c7cc]"
            : "bg-accent";
  return (
    <span className={cn("block overflow-hidden rounded-full bg-[#ececef]", thin ? "h-1" : "h-1.5", className)}>
      <i
        className={cn("block h-full rounded-full transition-[width] duration-1000 ease-apple", fill)}
        style={{ width: `${value}%` }}
      />
    </span>
  );
}

export function Meter({
  label,
  value,
  display,
  tone,
}: {
  label: string;
  value: number;
  display?: string;
  tone?: "accent" | "good" | "warn" | "bad" | "grey";
}) {
  return (
    <div className="grid grid-cols-[84px_1fr_46px] items-center gap-2.5">
      <span className="text-[12px] text-ink2">{label}</span>
      <Bar value={value} tone={tone} />
      <span className="tnum text-right text-[12px] font-semibold">{display ?? value}</span>
    </div>
  );
}

/* ---------------- Ring ---------------- */
export function Ring({
  value,
  size = "md",
  caption = "AVI / 100",
}: {
  value: number;
  size?: "md" | "sm";
  caption?: string;
}) {
  const sm = size === "sm";
  return (
    <div
      className={cn("relative grid shrink-0 place-items-center rounded-full", sm ? "h-[68px] w-[68px]" : "h-[152px] w-[152px]")}
      style={{
        background: `conic-gradient(from -90deg, #0071e3 ${value * 3.6}deg, #ececf0 0deg)`,
      }}
    >
      <div className={cn("absolute rounded-full bg-white", sm ? "inset-[6px]" : "inset-[11px]")} />
      <div className="relative z-1 text-center">
        <b className={cn("tnum block font-semibold tracking-[-0.04em]", sm ? "text-[16px]" : "text-[33px] leading-none")}>
          {value}
        </b>
        {!sm && (
          <span className="mt-1.5 block text-[9.5px] font-semibold tracking-[0.09em] text-ink3 uppercase">
            {caption}
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------------- Segmented ---------------- */
export function Seg<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex gap-0.5 rounded-[9px] bg-[#ebebef] p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={cn(
            "h-[26px] rounded-[7px] px-3 text-[11.5px] transition-all duration-200 ease-apple",
            value === o ? "bg-white font-medium text-black shadow-[0_1px_2px_rgba(0,0,0,0.09)]" : "text-[#5a5a5e]"
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Table ---------------- */
export function Table({
  head,
  children,
  className,
  foot,
}: {
  head: ReactNode[];
  children: ReactNode;
  className?: string;
  foot?: ReactNode;
}) {
  return (
    <div className={cn("overflow-hidden rounded-card border border-hair bg-surface", className)}>
      <div className="w-full overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              {head.map((h, i) => (
                <th
                  key={i}
                  className="border-b border-hair bg-[#fafafb]/70 px-3.5 py-2.5 text-left text-[10px] font-semibold tracking-[0.07em] whitespace-nowrap text-ink3 uppercase"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
      {foot && <div className="border-t border-hair px-4 py-3">{foot}</div>}
    </div>
  );
}

export const td = "border-b border-hair2 px-3.5 py-3 align-middle text-[#3a3a3c]";
export const trHover = "hover:bg-[#fbfbfc] transition-colors duration-200";

/* ---------------- Note ---------------- */
export function Note({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "warn" | "bad";
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const style =
    tone === "bad"
      ? "bg-bad/4 border-bad/14 text-[#a40010]"
      : tone === "warn"
        ? "bg-warn/5 border-warn/16 text-[#7a3a00]"
        : "bg-accent/5 border-accent/13 text-[#0a4a80]";
  return (
    <div className={cn("flex items-start gap-2.5 rounded-[11px] border px-3 py-2.5 text-[12px]", style, className)}>
      <Icon name={tone === "info" ? "alert" : "alert"} className="mt-px h-3.5 w-3.5 shrink-0" />
      <div>
        {title && <b className="font-medium">{title}</b>}
        {children}
      </div>
    </div>
  );
}

/* ---------------- Drawer ---------------- */
export function Drawer({
  open,
  onClose,
  title,
  sub,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const content = (
    <>
      <div
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-[90] bg-black/25 transition-opacity duration-300",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />
      <aside
        role="dialog"
        aria-label={typeof title === "string" ? title : "详情"}
        aria-hidden={!open}
        onTransitionEnd={(e) => {
          // 关闭后焦点若还在抽屉内（隐藏元素），会让读屏器困惑，主动释放
          const el = e.currentTarget as HTMLElement;
          const active = document.activeElement as HTMLElement | null;
          if (!open && active && el.contains(active)) active.blur();
        }}
        className={cn(
          "fixed inset-y-0 right-0 z-[95] h-[100dvh] w-[min(560px,94vw)] overflow-y-auto border-l border-hair bg-white px-[22px] pt-5 pb-10 transition-transform duration-500 ease-apple",
          open ? "translate-x-0" : "translate-x-[102%]"
        )}
      >
        <div className="sticky top-0 z-1 -mx-[22px] mb-0 flex items-start gap-3 border-b border-hair bg-white px-[22px] pt-5 pb-3.5">
          <div>
            <h3 className="m-0 text-[15px] font-semibold tracking-[-0.02em]">{title}</h3>
            {sub && <div className="mt-1 text-[11.5px] text-ink3">{sub}</div>}
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-full border border-hair bg-white text-ink2"
          >
            ✕
          </button>
        </div>
        <div className="pt-4">{children}</div>
        {footer && <div className="mt-5 flex gap-2.5">{footer}</div>}
      </aside>
    </>
  );

  // 用 Portal 挂到 body，避免祖先的 transform/filter 影响 fixed 定位
  if (typeof document === "undefined") return content;
  return createPortal(content, document.body);
}
