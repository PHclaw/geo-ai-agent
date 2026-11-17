/* ============================================================
   API 客户端：统一 fetch 封装 + token 管理
   ============================================================ */

const TOKEN_KEY = "geo.token";
const BRAND_KEY = "geo.brandId";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(BRAND_KEY);
};

export const getBrandId = () => localStorage.getItem(BRAND_KEY) || "";
export const setBrandId = (id: string) => localStorage.setItem(BRAND_KEY, id);

type Opts = { method?: string; body?: unknown; signal?: AbortSignal };

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
  });

  if (res.status === 401) {
    clearToken();
    if (!location.pathname.startsWith("/login")) location.href = "/login";
    throw new ApiError("未登录", 401);
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError((data as { error?: string }).error || `请求失败（${res.status}）`, res.status);
  return data as T;
}
