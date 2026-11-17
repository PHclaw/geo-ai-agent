/* ============================================================
   业务 API + 轻量数据 hooks（不引第三方数据层，保持零依赖）
   ============================================================ */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, getBrandId, getToken, setBrandId } from "./client";

/* ---------------- 类型 ---------------- */
export type Brand = {
  id: string;
  name: string;
  alias: string;
  city: string;
  since: string;
  intro: string;
  industry: string;
  priceRange: string;
};

export type Me = {
  user: { id: string; phone: string; name: string; role: "owner" | "editor" | "viewer" | "ops" };
  tenant: { id: string; name: string; plan: string };
  brands: Brand[];
  mode: "mock" | "live" | "mixed";
  permissions: { write: boolean; manage: boolean; ops: boolean };
};

export type Fact = {
  id: string;
  subject: string;
  attr: string;
  value: string;
  validFrom: string;
  source: string;
  status: "active" | "conflict" | "expiring" | "missing" | "archived";
  conflictGroup: string;
};

export type Prompt = {
  id: string;
  text: string;
  intent: string;
  weight: number;
  createdAt?: string;
  /** 已取证的平台数（去重） */
  evidenced?: number;
};

export type RunSummary = {
  avi: number;
  mentionRate: number;
  firstRate: number;
  accuracy: number;
  sov: number;
  sources: { live: number; mock: number; error: number };
  byPlatform: {
    platform: string;
    avi: number;
    mentionRate: number;
    firstRate: number;
    samples: number;
    source: "live" | "mock" | "error";
    live: number;
    mock: number;
    error: number;
  }[];
  byIntent: { intent: string; avi: number }[];
};

export type LatestRun = {
  run: { id: string; status: string; total: number; done: number; mode: string; finishedAt: string | null } | null;
  summary: RunSummary | null;
  results: {
    id: string;
    promptId: string;
    platform: string;
    answer: string;
    position: number;
    mention: boolean;
    accuracy: number;
    platforms: string[];
    prompt: Prompt | null;
  }[];
};

export type Quadrant = {
  key: string;
  label: string;
  diagnosis: string;
  action: string;
  tone: "ok" | "warn" | "bad";
};

export type Overview = {
  brand: Brand;
  kpi: {
    avi: number;
    aviModel: number | null;
    aviCend: number | null;
    aviDelta: number;
    accuracy: number;
    sov: number;
    mentionRate: number;
    firstRate: number;
    facts: number;
    prompts: number;
    samples: number;
    cendSamples: number;
  };
  quadrant: Quadrant;
  trend: { date: string; avi: number; aviModel: number | null; aviCend: number | null }[];
  byPlatform: RunSummary["byPlatform"];
  byIntent: RunSummary["byIntent"];
  lastRun: { id: string; status: string; mode: string; finishedAt: string; total: number } | null;
  todos: { tag: string; title: string; sub: string }[];
};

/* ---------------- C 端取证（A 级证据） ---------------- */

export type EvidenceItem = {
  id: string;
  promptId: string;
  prompt: string;
  intent: string | null;
  platform: string;
  position: number;
  mention: boolean;
  accuracy: number;
  answer: string;
  screenshotUrl: string;
  location: string;
  createdAt: string;
};

export type EvidenceResult = {
  id: string;
  platform: string;
  platformName: string;
  mention: boolean;
  position: number;
  accuracy: number;
  duplicate: number;
  note: string;
  metrics: { aviModel: number | null; aviCend: number | null; quadrant: Quadrant; cendSamples: number };
};

export type EvidenceQueue = {
  platforms: {
    key: string;
    name: string;
    web: string;
    total: number;
    done: number;
    pending: { id: string; text: string; intent: string | null; weight: number }[];
  }[];
  summary: { totalPrompts: number; platformCount: number; totalSamples: number; doneSamples: number; coverage: number };
};

export const fetchEvidenceQueue = (brandId: string, limit = 12) =>
  api<EvidenceQueue>(`/evidence/queue?brandId=${brandId}&limit=${limit}`);

export const fetchEvidence = (brandId: string) => api<EvidenceItem[]>(`/evidence?brandId=${brandId}`);

export const submitEvidence = (payload: {
  brandId: string;
  promptId: string;
  platform: string;
  answer: string;
  screenshotUrl?: string;
  location?: string;
}) => api<EvidenceResult>("/evidence", { method: "POST", body: payload });

export const deleteEvidence = (evidenceId: string) =>
  api<{ ok: true; metrics: { aviModel: number | null; aviCend: number | null; quadrant: Quadrant } }>(
    `/evidence/${evidenceId}`,
    { method: "DELETE" }
  );

/* ---------------- 知识库文档与检索（RAG 基础层） ---------------- */

export type KbDoc = {
  id: string;
  name: string;
  ext: string;
  size: number;
  status: "processing" | "ready" | "empty" | "failed" | "image";
  pages: number;
  chunks: number;
  chars: number;
  error: string;
  createdAt: string;
};

export type KbChunk = { id: string; seq: number; page: number; titlePath: string; chars: number; text: string };

export type KbHit = {
  chunkId: string;
  docId: string;
  docName: string;
  page: number;
  titlePath: string;
  chars: number;
  score: number;
  text: string;
};

export const fetchKbDocs = (brandId: string) => api<KbDoc[]>(`/kb/documents?brandId=${brandId}`);
export const fetchKbStats = (brandId: string) =>
  api<{ documents: number; ready: number; chars: number; chunks: number }>(`/kb/stats?brandId=${brandId}`);
export const deleteKbDoc = (docId: string) => api<{ ok: true }>(`/kb/documents/${docId}`, { method: "DELETE" });
export const fetchKbChunks = (docId: string) =>
  api<{ document: KbDoc; chunks: KbChunk[] }>(`/kb/documents/${docId}/chunks?limit=200`);
export const searchKb = (brandId: string, query: string, topK = 8) =>
  api<{ hits: KbHit[]; matched: number; indexSize: number }>("/kb/search", {
    method: "POST",
    body: { brandId, query, topK },
  });

/** 上传需要 multipart，单独走 fetch（不使用 JSON 封装） */
export async function uploadKbDoc(brandId: string, file: File): Promise<{ id: string; name: string; chunks: number; pages: number; chars: number; ms: number; warning: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`/api/kb/documents?brandId=${brandId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken()}` },
    body: fd,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || `上传失败（${res.status}）`);
  return data;
}

/* ---------------- 智能体生成（SSE 流式） ---------------- */

export type AgentEvent =
  | { type: "stage" | "log" | "warn"; content: string }
  | { type: "thinking" | "text"; delta: string }
  | { type: "tool"; content: string }
  | { type: "facts"; issues: { value: number; unit: string; context: string }[]; checked: number }
  | { type: "figures"; count: number; inserted: number }
  | {
      type: "compliance";
      blocked: { word: string; level: string; reason: string; context: string }[];
      warnings: { word: string; level: string; reason: string; context: string }[];
      summary: string;
    }
  | {
      type: "done";
      ok: boolean;
      chars: number;
      thinkingChars: number;
      error: string;
      files: { name: string; size: number }[];
      usage?: { input: number; output: number };
    }
  | {
      type: "saved";
      contentId: string;
      title: string;
      geos: number;
      dims: Record<string, number>;
      chars: number;
      body: string;
      factIssues: number;
      figures: number;
      complianceBlocked: number;
      complianceWarnings: number;
    }
  | { type: "error"; content: string };

export const fetchAgentStatus = () =>
  api<{ available: boolean; entry: string; hint: string; node: string }>("/agent/status");

export async function streamAgent(
  payload: { brandId: string; promptId?: string; genre?: string },
  onEvent: (e: AgentEvent) => void
): Promise<void> {
  const res = await fetch("/api/contents/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let msg = `生成失败（${res.status}）`;
    try {
      const d = await res.json();
      msg = d.error || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  if (!res.body) throw new Error("当前浏览器不支持流式读取");

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)) as AgentEvent);
      } catch {
        /* 忽略半包 */
      }
    }
  }
}

/** 导出图文 HTML（单文件，图片内联）；png=true 时为公众号版（SVG 转 PNG） */
export async function exportContentHtml(contentId: string, format: "svg" | "png" = "svg") {
  const res = await fetch(`/api/contents/${contentId}/export.html${format === "png" ? "?format=png" : ""}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error(`导出失败（${res.status}）`);
  const text = await res.text();
  const title = /<title>([^<]*)<\/title>/.exec(text)?.[1] || "content";
  const safe = title.replace(/[\\/:*?"<>|]/g, "").slice(0, 40);
  const suffix = format === "png" ? "-公众号版" : "";
  return { blob: new Blob([text], { type: "text/html;charset=utf-8" }), filename: `${safe}${suffix}.html` };
}

/* ---------------- 监测复盘 ---------------- */

export type MonitorTrendPoint = {
  date: string;
  avi: number;
  aviModel: number | null;
  aviCend: number | null;
  samples: number;
  cendSamples: number;
};

export type MonitorData = {
  range: { days: number; from: string };
  summary: {
    avi: number | null;
    aviModel: number | null;
    aviCend: number | null;
    delta: number | null;
    deltaComparable: boolean;
    points: number;
    lastDate: string | null;
    /** cend=有 A 级证据；model=有模型样本；baseline=仅历史基线；none=无数据 */
    source: "cend" | "model" | "baseline" | "none";
    prevSource: "cend" | "model" | "baseline" | "none";
  };
  trend: MonitorTrendPoint[];
  runs: { id: string; mode: string; total: number; status: string; finishedAt: string }[];
  lastRun: { id: string; mode: string; total: number; finishedAt: string } | null;
  platforms: { platform: string; samples: number; mention: number; rate: number; avgPosition: number | null }[];
  intents: { intent: string; samples: number; mention: number; rate: number }[];
  cend: {
    total: number;
    byPlatform: { platform: string; count: number; mention: number; rate: number }[];
    recent: { id: string; platform: string; prompt: string; position: number; mention: boolean; accuracy: number; createdAt: string }[];
  };
  gaps: { key: string; label: string; action: string; to: string }[];
};

export const fetchMonitor = (brandId: string, days = 30) =>
  api<MonitorData>(`/monitor?brandId=${brandId}&days=${days}`);

/* ---------------- 产品库（SKU 明细） ---------------- */

export type Product = {
  id: string;
  name: string;
  category: string;
  price: string;
  unit: string;
  specs: string;
  sellingPoints: string;
  applicable: string;
  status: string;
  createdAt: string;
  priceCheck: { level: "ok" | "warn" | "unknown"; note: string };
};

export type ProductInput = {
  name: string;
  category?: string;
  price?: string;
  unit?: string;
  specs?: string;
  sellingPoints?: string;
  applicable?: string;
  status?: string;
};

export const fetchProducts = (brandId: string) => api<Product[]>(`/products?brandId=${brandId}`);

export const createProduct = (brandId: string, input: ProductInput) =>
  api<Product>("/products", { method: "POST", body: { brandId, ...input } });

export const updateProduct = (productId: string, input: Partial<ProductInput>) =>
  api<Product>(`/products/${productId}`, { method: "PATCH", body: input });

export const deleteProduct = (productId: string) =>
  api<{ ok: true }>(`/products/${productId}`, { method: "DELETE" });

export type OrganizeProductsResult = {
  ok: true;
  added: number;
  skipped: number;
  warned: number;
  total: number;
  docCount: number;
  preview: { name: string; price: string; check: string }[];
};

/** 读知识库文档，用智能体抽出产品/套餐（耗时 20–40s）；已有产品时需 force 才追加 */
export const organizeProducts = (brandId: string, force = false) =>
  api<OrganizeProductsResult>("/products/agent", { method: "POST", body: { brandId, force } });

/* ---------------- 事实卡 AI 自动整理 ---------------- */

export type OrganizeResult = {
  ok: true;
  added: number;
  skipped: number;
  conflicts: number;
  total: number;
  docCount: number;
  preview: { attr: string; value: string; status: string }[];
};

/** 读知识库文档，用智能体抽出事实卡初版（耗时 20–40s）；已有事实卡时需 force 才追加 */
export const organizeFacts = (brandId: string, force = false) =>
  api<OrganizeResult>("/facts/agent", { method: "POST", body: { brandId, force } });

/* ---------------- 品牌管理 ---------------- */

export type BrandRow = { id: string; name: string; city: string; industry: string; intro: string; createdAt: string };

export const fetchBrands = () => api<BrandRow[]>("/brands");

export const deleteBrand = (brandId: string, confirmName: string) =>
  api<{ ok: true; name: string; deleted: Record<string, number> }>(
    `/brands/${brandId}?confirmName=${encodeURIComponent(confirmName)}`,
    { method: "DELETE" }
  );

/* ---------------- 官网体检与 GEO 资产 ---------------- */

export type SiteCheck = { key: string; label: string; level: "pass" | "warn" | "fail"; detail: string; fix: string };

export type SiteAudit = {
  url: string;
  fetchedAt: string;
  score: number;
  grade: string;
  passed: number;
  total: number;
  checks: SiteCheck[];
  facts: {
    title: string;
    desc: string;
    h1: string;
    h2Count: number;
    paragraphs: number;
    quotable: number;
    jsonLdTypes: string[];
    bots: Record<string, { status: number; ok: boolean }>;
    robotsTxt: boolean;
    llmsTxt: boolean;
    sitemapUrls: number;
  };
};

export type SiteAssets = {
  llmsTxt: string;
  faqCount: number;
  jsonLdBusiness: string;
  jsonLdFaq: string;
  headSnippet: string;
  baseUrl: string;
  storeCount: number;
};

export const auditSite = (brandId: string, url: string) =>
  api<SiteAudit>("/site/audit", { method: "POST", body: { brandId, url } });

export const fetchSiteAssets = (brandId: string, url = "") =>
  api<SiteAssets>(`/site/assets?brandId=${brandId}${url ? `&url=${encodeURIComponent(url)}` : ""}`);

export async function downloadLlmsTxt(brandId: string, url = ""): Promise<Blob> {
  const res = await fetch(`/api/site/llms.txt?brandId=${brandId}${url ? `&url=${encodeURIComponent(url)}` : ""}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error(`下载失败（${res.status}）`);
  return res.blob();
}

/* ---------------- 基础请求 ---------------- */

export const login = (phone: string, password: string) =>
  api<{ token: string; user: { id: string; phone: string; name: string } }>("/auth/login", {
    method: "POST",
    body: { phone, password },
  });

export const register = (phone: string, password: string, name: string) =>
  api<{ token: string }>("/auth/register", { method: "POST", body: { phone, password, name } });

export const fetchMe = () => api<Me>("/me");

export const fetchOverview = (brandId: string) => api<Overview>(`/overview?brandId=${brandId}`);

export const fetchFacts = (brandId: string) => api<Fact[]>(`/facts?brandId=${brandId}`);

export const createFact = (payload: {
  brandId: string;
  subject: string;
  attr: string;
  value: string;
  validFrom?: string;
  source?: string;
}) => api<Fact>("/facts", { method: "POST", body: payload });

export const deleteFact = (factId: string) => api<{ ok: true }>(`/facts/${factId}`, { method: "DELETE" });

export const resolveFact = (factId: string, keepId: string) =>
  api<{ ok: true; keptId: string; archived: number }>(`/facts/${factId}/resolve`, {
    method: "POST",
    body: { keepId },
  });

export const fetchPrompts = (brandId: string) => api<Prompt[]>(`/prompts?brandId=${brandId}`);

export const createPrompt = (brandId: string, input: { text: string; intent?: string; weight?: number }) =>
  api<Prompt>("/prompts", { method: "POST", body: { brandId, ...input } });

export const deletePrompt = (promptId: string) => api<{ ok: true }>(`/prompts/${promptId}`, { method: "DELETE" });

export const updatePrompt = (promptId: string, input: { text?: string; intent?: string; weight?: number }) =>
  api<Prompt>(`/prompts/${promptId}`, { method: "PATCH", body: input });

export const deletePromptsBatch = (brandId: string, ids: string[]) =>
  api<{ ok: true; deleted: number }>("/prompts/batch-delete", { method: "POST", body: { brandId, ids } });

export type AgentPromptsResult = {
  ok: true;
  added: number;
  skipped: number;
  total: number;
  preview: { text: string; intent: string; weight: number }[];
  fromDocs: number;
  fromFacts: number;
};

/** AI 生成提问：读知识库 + 事实卡，出贴合行业的问题（约 20–40s） */
export const agentPrompts = (brandId: string) =>
  api<AgentPromptsResult>("/prompts/agent", { method: "POST", body: { brandId } });

export const generatePrompts = (brandId: string, count = 40) =>
  api<{ added: number; total: number }>("/prompts/generate", { method: "POST", body: { brandId, count } });

export const runProbe = (brandId: string, sample = 1) =>
  api<{ runId: string; total: number; mode: string }>("/probes/run", { method: "POST", body: { brandId, sample } });

export const fetchRun = (runId: string) =>
  api<{ run: { status: string; done: number; total: number }; summary: RunSummary | null }>(`/probes/${runId}`);

export const fetchLatestRun = (brandId: string) => api<LatestRun>(`/probes/latest?brandId=${brandId}`);

export type GeneratedContent = {
  id: string;
  title: string;
  genre: string;
  geos: number;
  status: string;
  body: string;
  createdAt: string;
};

export type GeosDim = { k: string; v: number; max: number };

export const fetchContents = (brandId: string) => api<GeneratedContent[]>(`/contents?brandId=${brandId}`);

export const generateContents = (
  brandId: string,
  opts: { genre?: string; promptId?: string; promptIds?: string[]; count?: number } = {}
) => api<{ items: (GeneratedContent & { dims: GeosDim[] })[]; count: number }>("/contents/generate", {
  method: "POST",
  body: { brandId, ...opts },
});

export const fetchContent = (contentId: string) =>
  api<GeneratedContent & { dims: GeosDim[] }>(`/contents/${contentId}`);

export const updateContentStatus = (contentId: string, status: string) =>
  api<{ ok: true; status: string }>(`/contents/${contentId}`, { method: "PATCH", body: { status } });

/* ---------------- 媒体与投放 ---------------- */

export type MediaItem = {
  id: string;
  name: string;
  type: string;
  region: string;
  industry: string;
  aiw: number;
  cycle: string;
  price: number;
  covered: boolean;
  note: string;
};

export type OrderPlacement = {
  id: string;
  media: string;
  content: string;
  url: string;
  state: string;
  publishedAt: string;
  note: string;
};

export type Order = {
  id: string;
  objective: string;
  total: number;
  status: string;
  createdAt: string;
  assignee: string;
  claimedAt: string;
  deliveryMode: string;
  media: { id: string; name: string; aiw: number; price: number }[];
  placements: OrderPlacement[];
};

export type Placement = {
  id: string;
  orderId: string;
  content: string;
  media: string;
  mediaAiw: number;
  state: string;
  url: string;
  publishedAt: string;
  indexed: boolean;
  cited: number;
  /** 链接台账里的存活状态；untracked = 尚未同步进台账 */
  linkStatus?: string;
};

export const fetchMediaList = () => api<MediaItem[]>("/media");
export const fetchOrders = (brandId: string) => api<Order[]>(`/orders?brandId=${brandId}`);
export const fetchPlacements = (brandId: string) => api<Placement[]>(`/placements?brandId=${brandId}`);

export const createOrder = (brandId: string, mediaIds: string[], objective: string) =>
  api<{ id: string; total: number; count: number; status: string; avgAiw: number }>("/orders", {
    method: "POST",
    body: { brandId, mediaIds, objective },
  });

export const publishOrder = (orderId: string) =>
  api<{ ok: true; status: string }>(`/orders/${orderId}`, { method: "PATCH", body: { status: "published" } });

export const cancelOrder = (orderId: string) =>
  api<{ ok: true; status: string }>(`/orders/${orderId}/cancel`, { method: "POST", body: {} });

/* ---------------- 运营工作台（人工代投） ---------------- */

export type OpsOrder = Order & {
  statusText: string;
  brand: { id: string; name: string; city: string };
  ownerPhone: string;
  note: string;
  doneCount: number;
  totalCount: number;
};

export type OpsStats = {
  pending: number;
  claimed: number;
  publishedToday: number;
  amount: number;
  clients: number;
};

export const fetchOpsOrders = (status = "all") => api<OpsOrder[]>(`/ops/orders?status=${status}`);
export const fetchOpsStats = () => api<OpsStats>("/ops/stats");

export const claimOrder = (orderId: string) =>
  api<{ ok: true; status: string; assignee: string }>(`/ops/orders/${orderId}/claim`, {
    method: "POST",
    body: {},
  });

export const publishPlacement = (placementId: string, payload: { url: string; publishedAt?: string; contentTitle?: string }) =>
  api<{ ok: true; remaining: number; orderStatus: string }>(`/ops/placements/${placementId}/publish`, {
    method: "POST",
    body: payload,
  });

export const rejectPlacement = (placementId: string, note: string) =>
  api<{ ok: true; state: string; note: string }>(`/ops/placements/${placementId}/reject`, {
    method: "POST",
    body: { note },
  });

/* ---------------- 成员与权限 ---------------- */

export type Member = {
  id: string;
  phone: string;
  name: string;
  role: "owner" | "editor" | "viewer" | "ops";
  isSelf: boolean;
  createdAt: string;
};

export type AuditLog = {
  id: string;
  action: string;
  actionText: string;
  objectType: string;
  objectId: string;
  userName: string;
  createdAt: string;
};

export const fetchMembers = () => api<Member[]>("/members");

export const createMember = (payload: { phone: string; name: string; role: string; password: string }) =>
  api<{ id: string; phone: string; name: string; role: string; initialPassword: string }>("/members", {
    method: "POST",
    body: payload,
  });

export const updateMemberRole = (memberId: string, role: string) =>
  api<{ ok: true; role: string }>(`/members/${memberId}`, { method: "PATCH", body: { role } });

export const removeMember = (memberId: string) => api<{ ok: true }>(`/members/${memberId}`, { method: "DELETE" });

export const fetchAuditLogs = () => api<AuditLog[]>("/audit-logs");

/* ---------------- 模型接入 ---------------- */

export type Provider = {
  key: string;
  name: string;
  vendor: string;
  model: string;
  base: string;
  live: boolean;
  caveat: string;
};

export const fetchProviders = () => api<{ mode: string; providers: Provider[] }>("/providers");

export const testProvider = (key: string) =>
  api<{ ok: boolean; ms?: number; model?: string; sample?: string; error?: string; kind?: string }>(
    "/providers/test",
    { method: "POST", body: { key } }
  );

/* ---------------- SEO 曝光率 ---------------- */

export type SeoCheck = { key: string; label: string; level: "pass" | "warn" | "fail"; detail: string };

export type SeoScan = {
  id?: string;
  url: string;
  score: number;
  grade: string;
  passed: number;
  total: number;
  checks: SeoCheck[];
  facts: Record<string, unknown>;
  createdAt?: string;
};

export type SeoTrendPoint = {
  date: string;
  exposureRate: number | null;
  avgPosition: number | null;
  impressions: number | null;
  source: string;
};

export type SeoKeyword = {
  id: string;
  keyword: string;
  engine: string;
  intent: string;
  enabled: boolean;
  createdAt: string;
  position: number | null;
  exposed: boolean;
  source: string;
  error: string;
  checkedAt: string | null;
  url: string;
  title: string;
};

export type SeoRecord = {
  date: string;
  indexedPages: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  avgPosition: number | null;
  exposureRate: number | null;
  keywordsTotal: number;
  keywordsExposed: number;
  source: string;
  note: string;
};

export type SeoHistoryPoint = {
  date: string;
  position: number | null;
  exposed: boolean;
  source: string;
  error: string;
  url: string;
  title: string;
};

export type SeoSchedule = {
  enabled: boolean;
  intervalMin: number;
  lastAutoAt: string | null;
  lastAutoError: string;
};

export type SeoOverview = {
  range: { days: number; from: string };
  target: { url: string; lastScanAt: string | null };
  sources: {
    serp: { live: boolean; provider: string; engine: string; base: string };
    site: { available: boolean; label: string };
    manual: { records: number };
  };
  summary: {
    exposureRate: number | null;
    exposureSource: string;
    indexedPages: number | null;
    indexedSource: string;
    impressions: number | null;
    clicks: number | null;
    ctr: number | null;
    avgPosition: number | null;
    keywordsTotal: number;
    keywordsExposed: number;
    delta: number | null;
    deltaComparable: boolean;
    asOf: string | null;
    note: string;
  };
  trend: SeoTrendPoint[];
  keywords: SeoKeyword[];
  scan: SeoScan | null;
  scans: { id: string; url: string; score: number; grade: string; createdAt: string }[];
  records: SeoRecord[];
  gaps: { key: string; label: string; action: string; to: string }[];
  schedule: SeoSchedule;
};

export type SeoScanResult = {
  scan: SeoScan;
  mode: string;
  checked: number;
  errors: number;
  keywords: number;
  hint: string;
};

export type SeoRecordInput = {
  date?: string;
  indexedPages?: number | null;
  impressions?: number | null;
  clicks?: number | null;
  avgPosition?: number | null;
  exposureRate?: number | null;
  keywordsExposed?: number;
  note?: string;
};

export const fetchSeoOverview = (brandId: string, days = 30) =>
  api<SeoOverview>(`/seo/overview?brandId=${brandId}&days=${days}`);

export const createSeoKeyword = (brandId: string, input: { keyword: string; engine?: string; intent?: string }) =>
  api<SeoKeyword>("/seo/keywords", { method: "POST", body: { brandId, ...input } });

export const deleteSeoKeyword = (brandId: string, id: string) =>
  api<{ ok: true }>(`/seo/keywords/${id}?brandId=${brandId}`, { method: "DELETE" });

export const runSeoScan = (brandId: string, url: string) =>
  api<SeoScanResult>("/seo/scan", { method: "POST", body: { brandId, url } });

export const createSeoRecord = (brandId: string, input: SeoRecordInput) =>
  api<{ ok: true; date: string }>("/seo/records", { method: "POST", body: { brandId, ...input } });

export const deleteSeoRecord = (brandId: string, date: string) =>
  api<{ ok: true }>(`/seo/records/${date}?brandId=${brandId}`, { method: "DELETE" });

export const updateSeoKeyword = (brandId: string, id: string, enabled: boolean) =>
  api<{ ok: true; enabled: boolean }>(`/seo/keywords/${id}`, { method: "PATCH", body: { brandId, enabled } });

export const fetchSeoKeywordHistory = (brandId: string, id: string) =>
  api<{ keyword: string; points: SeoHistoryPoint[] }>(`/seo/keywords/${id}/history?brandId=${brandId}`);

/* ---------------- SEO 半自动数据通道 ---------------- */

export type SeoPositionItem = {
  keywordId: string;
  keyword: string;
  position: number | null;
  source: string;
};
export type SeoPositions = { date: string; topN: number; items: SeoPositionItem[] };
export type SeoPositionInput = { keywordId: string; position: number | null };
export type SeoPositionResult = {
  ok: true;
  date: string;
  written: number;
  samples: number;
  exposed: number;
  exposureRate: number | null;
};
export type SeoCsvImportResult = { ok: true; imported: number; skipped: number; errors: string[] };

export const fetchSeoPositions = (brandId: string, date: string) =>
  api<SeoPositions>(`/seo/positions?brandId=${brandId}&date=${date}`);

export const saveSeoPositions = (brandId: string, date: string, positions: SeoPositionInput[]) =>
  api<SeoPositionResult>("/seo/positions", { method: "POST", body: { brandId, date, positions } });

export const importSeoCsv = (brandId: string, csv: string) =>
  api<SeoCsvImportResult>("/seo/records/import", { method: "POST", body: { brandId, csv } });

/* ---------------- 链接资产台账 ---------------- */

export type LinkAsset = {
  id: string;
  url: string;
  host: string;
  kind: string;
  title: string;
  placementId: string;
  mediaId: string;
  contentId: string;
  publishedAt: string;
  source: string;
  status: string;
  httpStatus: number | null;
  indexed: number | null;
  lastCheckedAt: string;
  note: string;
  createdAt: string;
  citedByAi: number;
  citedBySerp: number;
  citedMock: number;
  citedCount: number;
};

export type LinkSummary = {
  total: number;
  byKind: Record<string, number>;
  active: number;
  broken: number;
  unknown: number;
  indexed: number;
  citedTotal: number;
  citedMock: number;
  lastCheckedAt: string | null;
};

export type LinksData = { items: LinkAsset[]; kinds: string[]; summary: LinkSummary };

export type LinkCheck = {
  id: string;
  linkId: string;
  url: string;
  checkedAt: string;
  ok: boolean;
  httpStatus: number;
  error: string;
  ms: number;
};

export const fetchLinks = (brandId: string, kind = "", status = "") =>
  api<LinksData>(`/links?brandId=${brandId}&kind=${kind}&status=${status}`);

export const createLink = (
  brandId: string,
  input: { url: string; kind?: string; title?: string; publishedAt?: string; note?: string }
) => api<LinkAsset>("/links", { method: "POST", body: { brandId, ...input } });

export const updateLink = (
  brandId: string,
  id: string,
  input: { kind?: string; title?: string; note?: string; publishedAt?: string; indexed?: number | null }
) => api<LinkAsset>(`/links/${id}`, { method: "PATCH", body: { brandId, ...input } });

export const deleteLink = (brandId: string, id: string) =>
  api<{ ok: true }>(`/links/${id}?brandId=${brandId}`, { method: "DELETE" });

export const syncLinks = (brandId: string) =>
  api<{ ok: true; found: number; added: number; skipped: number; byFrom: Record<string, number> }>("/links/sync", {
    method: "POST",
    body: { brandId },
  });

export const checkLinks = (brandId: string, ids?: string[]) =>
  api<{ ok: true; checked: number; active: number; broken: number; networkErrors: number; at: string }>("/links/check", {
    method: "POST",
    body: { brandId, ...(ids ? { ids } : {}) },
  });

export const fetchLinkChecks = (brandId: string) => api<LinkCheck[]>(`/links/checks?brandId=${brandId}`);

/* ---------------- 数字人工作台 ---------------- */

export type AvatarSegment = { key: string; label: string; time: string; text: string; id: string };
export type AvatarAsset = { id: string; name: string; meta: string; mine: boolean };
export type AvatarJob = { id: string; kind: string; status: string; note: string; createdAt: string };
export type AvatarConfig = {
  segments: AvatarSegment[];
  assets: { looks: AvatarAsset[]; voices: AvatarAsset[]; tpls: AvatarAsset[] };
  jobs: AvatarJob[];
  capability: { player: boolean; generator: boolean };
};

export const fetchAvatarConfig = (brandId: string) => api<AvatarConfig>(`/avatar/config?brandId=${brandId}`);
export const saveAvatarConfig = (brandId: string, segments: { key: string; text: string }[]) =>
  api<{ ok: true; saved: number }>("/avatar/config", { method: "PUT", body: { brandId, segments } });
export const createAvatarAsset = (brandId: string, input: { kind: string; name: string; meta?: string }) =>
  api<{ id: string; name: string; kind: string; meta: string }>("/avatar/assets", {
    method: "POST",
    body: { brandId, ...input },
  });
export const deleteAvatarAsset = (brandId: string, assetId: string) =>
  api<{ ok: true }>(`/avatar/assets/${assetId}?brandId=${brandId}`, { method: "DELETE" });
export const createAvatarJob = (brandId: string, kind: string, payload: Record<string, unknown> = {}) =>
  api<{ ok: true; id: string; status: string; note: string }>("/avatar/jobs", {
    method: "POST",
    body: { brandId, kind, payload },
  });

/* ---------------- 服务商工作台 ---------------- */

export type AgencyClient = {
  id: string;
  name: string;
  plan: string;
  brands: string;
  avi: number | null;
  contents: number;
  budget: number;
  state: string;
  expire: string;
  primary: boolean;
  source: "brand" | "manual";
  note: string;
};
export type AgencyTask = { id: string; kind: string; target: string; status: string; note: string; createdAt: string };
export type AgencyOverview = {
  items: AgencyClient[];
  summary: { clients: number; brands: number; budget: number; warning: number };
  settings: { themeColor: string; reportTemplate: string };
  tasks: AgencyTask[];
};
export type AgencyClientInput = {
  name: string;
  plan?: string;
  avi?: number | null;
  contents?: number;
  budget?: number;
  state?: string;
  expire?: string;
  isPrimary?: boolean;
  note?: string;
};

export const fetchAgencyOverview = () => api<AgencyOverview>("/agency/overview");
export const createAgencyClient = (input: AgencyClientInput) =>
  api<{ ok: true; id: string }>("/agency/clients", { method: "POST", body: input });
export const updateAgencyClient = (id: string, input: Partial<AgencyClientInput>) =>
  api<{ ok: true }>(`/agency/clients/${id}`, { method: "PATCH", body: input });
export const deleteAgencyClient = (id: string) => api<{ ok: true }>(`/agency/clients/${id}`, { method: "DELETE" });
export const saveAgencySettings = (input: { themeColor: string; reportTemplate: string }) =>
  api<{ ok: true }>("/agency/settings", { method: "PUT", body: input });
export const createAgencyTask = (kind: string) =>
  api<{ ok: true; id: string; status: string }>("/agency/tasks", { method: "POST", body: { kind } });

/* ---------------- 发布排期（养号 + 知识/GEO 穿插） ---------------- */

export type PlanItem = {
  id: string;
  contentId: string;
  title: string;
  kind: "knowledge" | "geo";
  stage: "warmup" | "mixed";
  channel: string;
  plannedAt: string;
  state: "planned" | "published" | "skipped";
  url: string;
  note: string;
  createdAt: string;
};
export type PlanSummary = {
  total: number;
  warmup: number;
  knowledge: number;
  geo: number;
  published: number;
  withUrl: number;
  geoEffective: number;
  channels: string[];
};
export type PlanDefaults = {
  warmupCount: number;
  ratio: number;
  weeks: number;
  intervalDays: number;
  channels: string[];
  startDate: string;
};
export type PlansData = { items: PlanItem[]; summary: PlanSummary; defaults: PlanDefaults };
export type PlanGenerateResult = {
  ok: true;
  created: number;
  removed: number;
  warmup: number;
  geo: number;
  articlesAvailable: number;
  hint: string;
  options: PlanDefaults;
};

export const fetchPlans = (brandId: string) => api<PlansData>(`/plans?brandId=${brandId}`);
export const generatePlans = (brandId: string, options: Partial<PlanDefaults>) =>
  api<PlanGenerateResult>("/plans/generate", { method: "POST", body: { brandId, ...options } });
export const updatePlan = (
  brandId: string,
  id: string,
  patch: Partial<Pick<PlanItem, "title" | "kind" | "stage" | "channel" | "plannedAt" | "state" | "note">>
) => api<PlanItem>(`/plans/${id}`, { method: "PATCH", body: { brandId, ...patch } });
export const deletePlan = (brandId: string, id: string) =>
  api<{ ok: true }>(`/plans/${id}?brandId=${brandId}`, { method: "DELETE" });
export const publishPlan = (brandId: string, id: string, url: string, note?: string) =>
  api<{ ok: true; url: string; linked: boolean }>(`/plans/${id}/publish`, {
    method: "POST",
    body: { brandId, url, note },
  });

/* ---------------- Agent 工作台 ---------------- */

export type AgentPreset = { key: string; label: string; hint: string; example: string };

export type AgentField = {
  key: string;
  label: string;
  type: "number" | "select" | "text";
  value: string | number;
  fromUser: boolean;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
};

export type AgentCard =
  | { type: "article"; contentId: string; title: string; geos: number; chars: number; factIssues: number; compliance: number }
  | { type: "plan"; created: number; warmup: number; geo: number; removed: number; hint: string }
  | {
      type: "placement";
      budget: number;
      picks: { name: string; price: number; aiw: number }[];
      total: number;
      remaining: number;
      candidates: number;
    }
  | {
      type: "analyze";
      avi: number | null;
      aviDelta: number | null;
      mentionRate: number | null;
      samples: number;
      exposureRate: number | null;
      exposureSource: string;
      keywords: number;
      conflicts: number;
    }
  | { type: "profile"; params: { name?: string; city?: string; industry?: string } }
  | { type: "presets"; presets: AgentPreset[] }
  | { type: "answer"; hits: { text: string; docName: string }[] }
  | { type: "confirm" };

export type AgentActResult = {
  ok: true;
  intent: string;
  label: string;
  reply: string;
  card: AgentCard | null;
  actions: { label: string; to: string }[];
  presets: AgentPreset[];
  fields: AgentField[];
  needsConfirm: boolean;
};

export const agentAct = (
  brandId: string,
  text: string,
  params?: Record<string, unknown>,
  confirm?: boolean
) => api<AgentActResult>("/agent/act", { method: "POST", body: { brandId, text, params, confirm } });

export const fetchAgentPresets = () => api<{ presets: AgentPreset[] }>("/agent/presets");

/* ---------------- hooks ---------------- */

export function useApi<T>(fn: (() => Promise<T>) | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(fn));
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const load = useCallback(async () => {
    if (!fnRef.current) return;
    setLoading(true);
    setError(null);
    try {
      setData(await fnRef.current());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, reload: load, setData };
}

/** 当前用户 + 当前品牌（自动写入 localStorage） */
export function useSession() {
  const { data, loading, error, reload } = useApi<Me>(() => fetchMe(), []);
  const [brandId, setBrand] = useState<string>(getBrandId());

  useEffect(() => {
    if (!data?.brands?.length) return;
    const saved = getBrandId();
    const valid = data.brands.some((b) => b.id === saved);
    const next = valid ? saved : data.brands[0].id;
    if (next !== saved) setBrandId(next);
    setBrand(next);
  }, [data]);

  const current = data?.brands.find((b) => b.id === brandId) || data?.brands[0] || null;

  return {
    me: data,
    brand: current,
    brandId: current?.id || "",
    brands: data?.brands || [],
    /** 切换品牌：写入 localStorage 并重载（各页面数据全部按新品牌重取） */
    switchBrand: (nextId: string) => {
      if (!nextId || nextId === current?.id) return;
      setBrandId(nextId);
      setBrand(nextId);
      window.location.reload();
    },
    loading,
    error,
    reload,
    mode: data?.mode || "mock",
  };
}
