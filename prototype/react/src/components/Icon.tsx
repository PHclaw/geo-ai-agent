import type { ReactNode } from "react";

export type IconName =
  | "grid"
  | "radar"
  | "book"
  | "box"
  | "globe"
  | "pen"
  | "send"
  | "chart"
  | "gear"
  | "search"
  | "bell"
  | "menu"
  | "home"
  | "users"
  | "user"
  | "video"
  | "camera"
  | "layers"
  | "list"
  | "check"
  | "alert";

const PATHS: Record<IconName, ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
    </>
  ),
  radar: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 12l6-6" />
      <path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" />
    </>
  ),
  book: (
    <>
      <path d="M5 4.5h9a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3V4.5z" />
      <path d="M8 4.5V17a3 3 0 0 0 3 3" />
    </>
  ),
  box: (
    <>
      <path d="M12 3.5l8 4.2v8.6l-8 4.2-8-4.2V7.7l8-4.2z" />
      <path d="M4 7.7l8 4.3 8-4.3" />
      <path d="M12 12v8.5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.4 2.4 3.6 5.3 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.3-3.6-8.5S9.6 5.9 12 3.5z" />
    </>
  ),
  pen: (
    <>
      <path d="M15.5 4.5l4 4-9.5 9.5-4.5.5.5-4.5 9.5-9.5z" />
      <path d="M14 6l4 4" />
    </>
  ),
  send: (
    <>
      <path d="M4 11.5l16-7-6 15-3.2-6.1L4 11.5z" />
      <path d="M10.8 13.4L20 4.5" />
    </>
  ),
  chart: (
    <>
      <path d="M4 19.5h16" />
      <path d="M7 19.5v-6" />
      <path d="M12 19.5V6.5" />
      <path d="M17 19.5v-9" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.5v2.2M12 18.3v2.2M4.6 12H6.8M17.2 12h2.2M6.7 6.7l1.6 1.6M15.7 15.7l1.6 1.6M17.3 6.7l-1.6 1.6M8.3 15.7l-1.6 1.6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  bell: (
    <>
      <path d="M18 15.5V11a6 6 0 1 0-12 0v4.5L4.5 18h15L18 15.5z" />
      <path d="M10 18a2 2 0 0 0 4 0" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  home: <path d="M4 10.5L12 4l8 6.5V20H4v-9.5z" />,
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19.5c0-3 2.5-5.2 5.5-5.2s5.5 2.2 5.5 5.2" />
      <path d="M16 5.6a3 3 0 0 1 0 5.8" />
      <path d="M17.5 14.6c2 .6 3.5 2.4 3.5 4.9" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20c0-3.6 3.1-6.2 7-6.2s7 2.6 7 6.2" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="6" width="12" height="12" rx="2.6" />
      <path d="M15 11.2l5.5-3.2v9l-5.5-3.2" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8.5h3l1.5-2h6L16 8.5h4v11H4v-11z" />
      <circle cx="12" cy="13.2" r="3.2" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3.5l8 4.4-8 4.4-8-4.4 8-4.4z" />
      <path d="M4 12.4l8 4.4 8-4.4" />
      <path d="M4 16.4l8 4.4 8-4.4" />
    </>
  ),
  list: (
    <>
      <path d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11" />
      <circle cx="4.5" cy="6.5" r="1" />
      <circle cx="4.5" cy="12" r="1" />
      <circle cx="4.5" cy="17.5" r="1" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  alert: (
    <>
      <path d="M12 4.5l8 15H4l8-15z" />
      <path d="M12 10v4.5" />
      <path d="M12 17.2v.1" />
    </>
  ),
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
