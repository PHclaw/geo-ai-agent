/* SSE 智能体生成接口验证：node scripts/smoke-agent-api.mjs */
const base = process.env.GEO_BASE || "http://127.0.0.1:8002/api";

async function login() {
  const res = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "13800000000", password: "123456" }),
  });
  return (await res.json()).token;
}

const token = await login();
const me = await (await fetch(`${base}/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
const brandId = me.brands[0].id;

const st = await (await fetch(`${base}/agent/status`, { headers: { Authorization: `Bearer ${token}` } })).json();
console.log("STATUS available=%s hint=%s", st.available, st.hint || "-");

const t0 = Date.now();
const res = await fetch(`${base}/contents/agent`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ brandId, genre: "攻略" }),
});
console.log("HTTP   %s %s", res.status, res.headers.get("content-type"));

const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = "";
let chars = 0;
let saved = null;
let error = "";
const marks = [];

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
    let e;
    try {
      e = JSON.parse(line.slice(6));
    } catch {
      continue;
    }
    if (e.type === "text") chars += e.delta.length;
    else if (e.type === "stage" || e.type === "warn" || e.type === "log") marks.push(`${e.type}:${e.content}`);
    else if (e.type === "saved") saved = e;
    else if (e.type === "facts") {
      marks.push(`facts:${e.issues.length}/${e.checked}`);
      if (e.issues.length) marks.push(`issue0:${e.issues[0].value}${e.issues[0].unit} @ ${e.issues[0].context.slice(0, 24)}`);
    } else if (e.type === "figures") marks.push(`figures:${e.count}/inserted=${e.inserted}`);
    else if (e.type === "error") error = e.content;
    else if (e.type === "done") {
      marks.push(`done:ok=${e.ok} chars=${e.chars} usage=${e.usage ? `${e.usage.input}/${e.usage.output}` : "-"}`);
      if (!e.ok) error = e.error;
    }
  }
}

console.log("MARKS  %s", marks.join(" | "));
console.log("STREAM text=%s chars elapsed=%ss", chars, ((Date.now() - t0) / 1000).toFixed(1));
console.log("ERROR  %s", error || "-");
if (saved) {
  console.log("SAVED  id=%s geos=%s chars=%s factIssues=%s figures=%s title=%s", saved.contentId.slice(0, 8), saved.geos, saved.chars, saved.factIssues, saved.figures, saved.title);

  const detail = await (
    await fetch(`${base}/contents/${saved.contentId}?brandId=${brandId}`, { headers: { Authorization: `Bearer ${token}` } })
  ).json();
  const body = detail.body || detail.content?.body || "";
  const imgs = body.match(/!\[[^\]]*\]\(([^)]+)\)/g) || [];
  console.log("BODY   len=%s 含图=%s 张", body.length, imgs.length);
  imgs.forEach((m) => console.log("   %s", m.slice(0, 70)));

  const url = imgs.length ? imgs[0].match(/\(([^)]+)\)/)[1] : "";
  if (url) {
    const r = await fetch(`http://127.0.0.1:8002${url}`);
    const svg = await r.text();
    console.log("IMG    %s -> %s %s bytes=%s hasTitleAndDesc=%s", url.slice(0, 26), r.status, r.headers.get("content-type"), svg.length, /<title>[^<]+<\/title>[\s\S]*<desc>/.test(svg));
  }

  const list = await (await fetch(`${base}/contents?brandId=${brandId}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const hit = list.find((c) => c.id === saved.contentId);
  console.log("LIST   total=%s 新条目在列表中=%s status=%s", list.length, Boolean(hit), hit?.status);
} else {
  console.log("SAVED  无（生成失败或未落库）");
}
