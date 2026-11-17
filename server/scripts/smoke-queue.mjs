/* 取证队列验证：node scripts/smoke-queue.mjs */
const base = process.env.GEO_BASE || "http://127.0.0.1:8002/api";

async function req(path, { method = "GET", token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : {} };
}

const login = await req("/auth/login", { method: "POST", body: { phone: "13800000000", password: "123456" } });
const token = login.data.token;
const me = (await req("/me", { token })).data;
const brandId = me.brands[0].id;

const q = (await req(`/evidence/queue?brandId=${brandId}&limit=5`, { token })).data;
console.log("SUMMARY prompts=%s platforms=%s samples=%s/%s coverage=%s%%",
  q.summary.totalPrompts, q.summary.platformCount, q.summary.doneSamples, q.summary.totalSamples, q.summary.coverage);

for (const p of q.platforms) {
  console.log(`\n[${p.key}] ${p.name}  done=${p.done}/${p.total}  web=${p.web || "(未配置)"}  pending=${p.pending.length}`);
  p.pending.slice(0, 2).forEach((x) => console.log(`   - (${x.intent} w${x.weight}) ${x.text}`));
}

/* 一致性校验：pending 不应包含已取证的 (promptId, platform) */
const ev = (await req(`/evidence?brandId=${brandId}`, { token })).data;
const doneSet = new Set(ev.map((e) => `${e.promptId}|${e.platform}`));
let conflict = 0;
for (const p of q.platforms) for (const x of p.pending) if (doneSet.has(`${x.id}|${p.key}`)) conflict++;
console.log("\nCHECK  已取证样本=%s, 队列与台账冲突=%s (expect 0)", ev.length, conflict);

/* 未配置 web 的平台数量 */
const noWeb = q.platforms.filter((p) => !p.web).map((p) => p.key);
console.log("CHECK  缺少网页地址的平台: %s", noWeb.length ? noWeb.join(",") : "无");
