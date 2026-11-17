/* 产品库验证：node scripts/smoke-products.mjs */
const base = process.env.GEO_BASE || "http://127.0.0.1:8002/api";

async function req(path, { method = "GET", token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  return { status: res.status, data };
}

const token = (await req("/auth/login", { method: "POST", body: { phone: "13800000000", password: "123456" } })).data.token;
const me = (await req("/me", { token })).data;
const brand = me.brands.find((b) => b.name.includes("和序")) || me.brands[0];
console.log("BRANDS %s", me.brands.map((b) => b.name).join(" / "));
console.log("BRAND  %s (%s)", brand.name, brand.id.slice(0, 8));

const facts = (await req(`/facts?brandId=${brand.id}`, { token })).data;
const priceFact = facts.find((f) => f.status === "active" && f.attr.includes("价格"));
console.log("FACT   价格事实卡：%s = %s", priceFact?.attr || "-", priceFact?.value || "-");

/* 清掉同名旧数据，保证可重复跑 */
const before = (await req(`/products?brandId=${brand.id}`, { token })).data;
for (const p of before) await req(`/products/${p.id}`, { method: "DELETE", token });

const cases = [
  { name: "整装基础包（区间内）", category: "整装", price: "980–1200 元/㎡", applicable: "80–120㎡ 两居/三居", sellingPoints: "含拆除清运、水电全改、泥木油漆、主材安装", specs: "拆除清运\n水电全改\n泥木油漆\n主材安装" },
  { name: "老房翻新全包（超区间）", category: "翻新", price: "1180–1600 元/㎡", applicable: "房龄 15 年以上", sellingPoints: "增项 500 元以上需书面确认", specs: "拆改加固\n水电全改\n防水重做" },
  { name: "局改小包（无价格）", category: "局改", price: "", applicable: "单间 / 卫生间", sellingPoints: "按现场尺寸报价", specs: "拆旧\n防水\n贴砖" },
];

console.log("\n=== 新增 ===");
const ids = [];
for (const c of cases) {
  const r = await req("/products", { method: "POST", token, body: { brandId: brand.id, ...c } });
  if (r.status !== 201) {
    console.log("  %s → http=%s %s", c.name, r.status, r.data.error || "");
    continue;
  }
  ids.push(r.data.id);
  console.log(
    "  %s → http=201  价格=%s  校验=%s %s",
    c.name, r.data.price || "(空)", r.data.priceCheck.level, r.data.priceCheck.note || ""
  );
}

console.log("\n=== 列表（含校验结果）===");
const list = (await req(`/products?brandId=${brand.id}`, { token })).data;
for (const p of list) {
  console.log("  %s ｜ %s ｜ %s ｜ %s", p.name, p.category || "-", p.price || "-", p.priceCheck.level);
}

/* 编辑测试：把超区间的改成区间内 */
const warnOne = list.find((p) => p.priceCheck.level === "warn");
if (warnOne) {
  const r = await req(`/products/${warnOne.id}`, { method: "PATCH", token, body: { price: "1180–1350 元/㎡" } });
  console.log("\nEDIT   %s 改成 1180–1350 → 校验=%s %s", warnOne.name, r.data.priceCheck.level, r.data.priceCheck.note || "");
}

/* 消费端 1：llms.txt 是否包含产品段落 */
console.log("\n=== llms.txt 消费 ===");
const assets = (await req(`/site/assets?brandId=${brand.id}`, { token })).data;
const hasSection = (assets.llmsTxt || "").includes("## 服务与产品");
console.log("  含「## 服务与产品」= %s", hasSection);
if (hasSection) {
  const seg = assets.llmsTxt.split("## 服务与产品")[1].split("\n## ")[0].trim();
  console.log("  段落内容：");
  console.log(seg.split("\n").map((l) => "    " + l).join("\n"));
}

/* 消费端 2：JSON-LD 是否含 OfferCatalog */
console.log("\n=== JSON-LD 消费 ===");
try {
  const b = JSON.parse(assets.jsonLdBusiness);
  const cat = b.hasOfferCatalog;
  console.log("  hasOfferCatalog = %s，条目 %s 个", Boolean(cat), cat ? cat.itemListElement.length : 0);
  if (cat) {
    for (const it of cat.itemListElement) {
      console.log("    - %s ｜ %s", it.itemOffered.name, it.priceSpecification?.description || "(无价格)");
    }
  }
} catch (e) {
  console.log("  解析失败：%s", e.message);
}

/* 权限：只读用户不能写 */
const viewer = await req("/auth/login", { method: "POST", body: { phone: "13911110002", password: "pass1234" } });
if (viewer.data?.token) {
  const r = await req("/products", { method: "POST", token: viewer.data.token, body: { brandId: brand.id, name: "越权测试" } });
  console.log("\nPERM   viewer 新增产品 → http=%s (期望 403)", r.status);
} else {
  console.log("\nPERM   viewer 账号不存在，跳过");
}
