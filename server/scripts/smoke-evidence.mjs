/* C 端取证与双轨指标验证：node scripts/smoke-evidence.mjs */
const base = process.env.GEO_BASE || "http://127.0.0.1:8002/api";

async function req(path, { method = "GET", token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

async function login(phone, password) {
  const { status, data } = await req("/auth/login", { method: "POST", body: { phone, password } });
  if (!data.token) throw new Error(`login failed ${status} ${JSON.stringify(data)}`);
  return data.token;
}

const owner = await login("13800000000", "123456");
const me = (await req("/me", { token: owner })).data;
const brandId = me.brands[0].id;

const before = (await req(`/overview?brandId=${brandId}`, { token: owner })).data;
console.log("BEFORE  aviCend=%s aviModel=%s quadrant=%s(%s)", before.kpi.aviCend, before.kpi.aviModel, before.quadrant.key, before.quadrant.label);

const prompts = (await req(`/prompts?brandId=${brandId}`, { token: owner })).data;
const p1 = prompts[0];
const p2 = prompts[1];
const p3 = prompts[2];

const goodAnswer = `南京地区可参考以下几家：
1. 栖岸设计：主打设计驱动。
2. 和序装饰：南京本地 4 家门店，整装报价 980–1350 元/㎡，工期 45–60 天，水电质保 10 年。
3. 木言空间：偏软装。
信息来源：njhouse.com、zhihu.com`;

const missAnswer = `可参考栖岸设计、木言空间、连云装饰等，建议实地对比在建工地与报价单漏项。
信息来源：本地家居门户`;

const wrongAnswer = `推荐和序装饰，他们在南京有 3 家门店，整装报价大约 1500 元/㎡ 起。
信息来源：某 ranking 站`;

const cases = [
  { label: "豆包·被提及且口径一致", platform: "doubao", promptId: p1.id, answer: goodAnswer, screenshotUrl: "https://evidence.example.com/shot-001.png", location: "南京" },
  { label: "DeepSeek·未提及", platform: "deepseek", promptId: p2.id, answer: missAnswer, location: "南京" },
  { label: "Kimi·提及但门店数与价格不符", platform: "kimi", promptId: p3.id, answer: wrongAnswer, location: "南京" },
];

const ids = [];
for (const c of cases) {
  const { status, data } = await req("/evidence", {
    method: "POST",
    token: owner,
    body: { brandId, platform: c.platform, promptId: c.promptId, answer: c.answer, screenshotUrl: c.screenshotUrl || "", location: c.location },
  });
  ids.push(data.id);
  console.log(
    "SUBMIT  %s -> http %s | mention=%s pos=%s accuracy=%s | aviCend=%s",
    c.label,
    status,
    data.mention,
    data.position,
    data.accuracy,
    data.metrics?.aviCend
  );
}

const after = (await req(`/overview?brandId=${brandId}`, { token: owner })).data;
console.log("AFTER   aviCend=%s aviModel=%s samples(cend)=%s quadrant=%s(%s)", after.kpi.aviCend, after.kpi.aviModel, after.kpi.cendSamples, after.quadrant.key, after.quadrant.label);
console.log("        diagnosis=%s", after.quadrant.diagnosis);
console.log("        action=%s", after.quadrant.action);

const list = (await req(`/evidence?brandId=${brandId}`, { token: owner })).data;
console.log("LIST    evidence=%s", list.length);

/* 只读成员不能提交 */
const viewerLogin = await login("13911110002", "pass1234").catch(() => null);
if (viewerLogin) {
  const { status } = await req("/evidence", {
    method: "POST",
    token: viewerLogin,
    body: { brandId, platform: "doubao", promptId: p1.id, answer: goodAnswer },
  });
  console.log("PERM    viewer submit -> http %s (expect 403)", status);
} else {
  console.log("PERM    viewer account missing, skipped");
}

/* 撤销一条，指标应重算 */
const del = await req(`/evidence/${ids[0]}`, { method: "DELETE", token: owner });
console.log("DELETE  http %s -> aviCend=%s", del.status, del.data.metrics?.aviCend);

const back = (await req(`/overview?brandId=${brandId}`, { token: owner })).data;
console.log("FINAL   aviCend=%s cendSamples=%s", back.kpi.aviCend, back.kpi.cendSamples);
