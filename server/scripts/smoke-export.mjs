/* 导出两种格式验证：node scripts/smoke-export.mjs */
const base = process.env.GEO_BASE || "http://127.0.0.1:8002/api";

const token = (
  await (
    await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "13800000000", password: "123456" }),
    })
  ).json()
).token;

const me = await (await fetch(`${base}/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
const list = await (
  await fetch(`${base}/contents?brandId=${me.brands[0].id}`, { headers: { Authorization: `Bearer ${token}` } })
).json();

const c = list[0];
const count = (h, re) => (h.match(re) || []).length;

for (const fmt of ["svg", "png"]) {
  const url = `${base}/contents/${c.id}/export.html${fmt === "png" ? "?format=png" : ""}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const html = await res.text();
  console.log(
    "%s  http=%s  %sKB  img=%s  svgData=%s  pngData=%s  残留了**=%s",
    fmt.toUpperCase(),
    res.status,
    (html.length / 1024).toFixed(1),
    count(html, /<img /g),
    count(html, /data:image\/svg/g),
    count(html, /data:image\/png/g),
    count(html, /\*\*/g)
  );
}
