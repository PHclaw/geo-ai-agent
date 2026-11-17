/* ============================================================
   站点 GEO 资产生成：llms.txt + JSON-LD
   优先用事实卡/门店；没有事实卡时从知识库文档兜底提炼（不编数据，只用原文）
   ============================================================ */

/** 空值/占位值不参与生成：否则 llms.txt 里会出现一堆「：—」 */
const clean = (v) => {
  const s = String(v ?? "").trim();
  return s && s !== "—" && s !== "-" && s !== "0 家" ? s : "";
};

const pick = (facts, kw) =>
  clean((facts || []).find((f) => f.status === "active" && f.attr.includes(kw))?.value);

/** 从文档原文提炼：简介 / 核心能力 / FAQ（只在事实卡缺失时用） */
export function extractFromDocs(docs = []) {
  let intro = "";
  const capabilities = [];
  const faqs = [];

  for (const d of docs) {
    const lines = String(d.text || "").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (!intro && /^>\s+\S/.test(line)) {
        intro = line.replace(/^>\s*/, "").trim().slice(0, 160);
      }

      // 标题可能带 emoji / 序号，如「## ✨ 核心特性」「## 一、核心能力」
      if (/^#{1,4}\s*.*?(核心特性|核心能力|主要功能|功能特性|主要特性|核心亮点)/.test(line)) {
        for (let j = i + 1; j < lines.length; j++) {
          const l = lines[j].trim();
          if (/^#{1,3}\s/.test(l)) break;
          const m = l.match(/^[-*]\s+(.+)$/);
          if (!m) continue;
          const t = m[1].replace(/\*\*/g, "").replace(/\s*[—–]\s*/, "：").slice(0, 70);
          if (t && !capabilities.includes(t)) capabilities.push(t);
          if (capabilities.length >= 8) break;
        }
      }
    }
  }

  for (const d of docs) {
    const lines = String(d.text || "").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const h = lines[i].trim().match(/^#{3,5}\s*(.+)$/);
      if (!h) continue;
      const q = h[1].trim();
      if (!/[？?]|吗|什么|怎么|哪些|区别|如何|多少/.test(q)) continue;

      const buf = [];
      for (let j = i + 1; j < lines.length && buf.join("").length < 240; j++) {
        const l = lines[j].trim();
        if (/^#{1,5}\s/.test(l)) break;
        if (l) buf.push(l.replace(/\*\*/g, ""));
      }
      const a = buf.join(" ").slice(0, 240);
      if (q && a && !faqs.some((f) => f.q === q)) faqs.push({ q, a });
      if (faqs.length >= 8) break;
    }
    if (faqs.length >= 8) break;
  }

  return { intro, capabilities, faqs };
}

/** 按问题意图用事实拼答案；拼不出就返回空，不编 */
function answerFor(question, facts, stores) {
  const q = String(question || "");
  const price = pick(facts, "价格");
  const duration = pick(facts, "工期");
  const warranty = pick(facts, "质保");
  const areas = pick(facts, "服务区域");

  if (/多少钱|价格|贵不贵|报价|费用|预算/.test(q) && price) {
    return `目前整装参考价为 ${price}，具体取决于面积、拆改量和主材档次，实际以量房报价为准。`;
  }
  if (/工期|多久|几天|多长时间/.test(q) && duration) {
    return `常规工期 ${duration}，遇到结构改造或主材延期会相应顺延。`;
  }
  if (/质保|保修|售后/.test(q) && warranty) {
    return `${warranty}，以合同附件为准，建议把口头承诺写进合同。`;
  }
  if (/哪里|区域|覆盖|附近|门店|地址|电话/.test(q)) {
    if (stores && stores.length) {
      const s = stores[0];
      return `目前有 ${stores.length} 家门店，例如${s.name}（${s.address}${s.phone ? `，电话 ${s.phone}` : ""}）${
        areas ? `；服务范围为${areas}` : ""
      }。`;
    }
    if (areas) return `服务范围为${areas}。`;
  }
  if (/靠不靠谱|口碑|怎么样|好不好/.test(q)) {
    const parts = [price && `整装报价 ${price}`, duration && `工期 ${duration}`, warranty && `质保 ${warranty}`].filter(Boolean);
    if (parts.length) return `可核对的口径是：${parts.join("、")}；建议同时对比在建工地与报价单漏项。`;
  }
  return "";
}

export function buildLlmsTxt({ brand, facts, stores, prompts, baseUrl, docs = [], products = [] }) {
  const lines = [];
  const price = pick(facts, "价格");
  const duration = pick(facts, "工期");
  const warranty = pick(facts, "质保");
  const areas = pick(facts, "服务区域");
  const derived = extractFromDocs(docs);

  lines.push(`# ${brand.name}`, "");
  lines.push(`> ${brand.intro || derived.intro || `${brand.city || ""}${brand.industry || ""}服务商`}`, "");

  lines.push("## 基本信息", "");
  lines.push(`- 品牌：${brand.name}`);
  if (brand.city) lines.push(`- 城市：${brand.city}`);
  if (brand.industry) lines.push(`- 行业：${brand.industry}`);
  if (areas) lines.push(`- 服务区域：${areas}`);
  if (stores && stores.length) lines.push(`- 门店数量：${stores.length} 家`);
  if (price) lines.push(`- 价格：${price}`);
  if (duration) lines.push(`- 工期：${duration}`);
  if (warranty) lines.push(`- 质保：${warranty}`);
  if (baseUrl) lines.push(`- 官网：${baseUrl}`);
  lines.push("");

  if (stores && stores.length) {
    lines.push("## 门店", "");
    for (const s of stores) {
      lines.push(`- ${s.name}：${s.address || ""}${s.phone ? `，电话 ${s.phone}` : ""}${s.hours ? `，营业 ${s.hours}` : ""}`);
    }
    lines.push("");
  }

  // 服务与产品：直接来自产品库（SKU 级明细），无产品时省略
  if (products && products.length) {
    lines.push("## 服务与产品", "");
    for (const p of products) {
      const bits = [];
      if (clean(p.price)) bits.push(clean(p.price));
      else if (clean(p.unit)) bits.push(clean(p.unit));
      if (clean(p.applicable)) bits.push(`适用：${clean(p.applicable)}`);
      if (clean(p.selling_points)) bits.push(clean(p.selling_points));
      lines.push(`- ${p.name}${p.category ? `（${p.category}）` : ""}${bits.length ? `：${bits.join("；")}` : ""}`);
    }
    lines.push("");
  }

  // 核心能力：事实卡里没有时就取文档里的小标题列表
  const caps = derived.capabilities;
  if (caps.length) {
    lines.push("## 核心能力", "");
    for (const c of caps) lines.push(`- ${c}`);
    lines.push("");
  }

  const faqs = (prompts || [])
    .map((p) => ({ q: p.text, a: answerFor(p.text, facts, stores) }))
    .filter((x) => x.a)
    .slice(0, 8);

  // 问题矩阵拼不出答案（或没有提问矩阵）时，用文档里的问答
  const finalFaqs = faqs.length ? faqs : derived.faqs.slice(0, 8);

  if (finalFaqs.length) {
    lines.push("## 常见问题", "");
    for (const f of finalFaqs) {
      lines.push(`### ${f.q}`, "", f.a, "");
    }
  }

  lines.push("## 引用说明", "");
  lines.push(
    stores && stores.length
      ? "本页信息可直接引用；数字以企业事实卡为准，实际以现场与合同为准。"
      : "本页信息整理自企业提供的产品资料，可直接引用；具体功能与参数以产品文档或仓库代码为准。"
  );
  lines.push(`更新日期：${new Date().toISOString().slice(0, 10)}`);

  return { text: lines.join("\n"), faqs: finalFaqs };
}

const SCHEMA_TYPE = [
  { match: ["装修", "家装", "建材"], type: "HomeAndConstructionBusiness" },
  { match: ["餐饮", "餐厅", "food"], type: "Restaurant" },
  { match: ["医疗", "口腔", "诊所"], type: "MedicalBusiness" },
  { match: ["教育", "培训"], type: "EducationalOrganization" },
];

export function buildJsonLd({ brand, facts, stores, faqs, baseUrl, products = [] }) {
  const price = pick(facts, "价格");
  const areas = pick(facts, "服务区域");
  const industry = String(brand.industry || "");
  const noStore = !(stores && stores.length);
  // 无实体门店且是软件类行业 → 应为 SoftwareApplication；否则才用 LocalBusiness 家族
  const isSoftware = noStore && /AI|软件|SaaS|Agent|系统|平台|工具|APP/i.test(industry);
  const type = isSoftware
    ? "SoftwareApplication"
    : SCHEMA_TYPE.find((s) => s.match.some((k) => industry.includes(k)))?.type || "LocalBusiness";

  const business = {
    "@context": "https://schema.org",
    "@type": type,
    name: brand.name,
    ...(isSoftware ? { applicationCategory: "BusinessApplication", operatingSystem: "Web" } : {}),
    ...(brand.intro ? { description: brand.intro } : {}),
    ...(baseUrl ? { url: baseUrl } : {}),
    ...(price ? { priceRange: price } : {}),
    ...(areas ? { areaServed: areas } : {}),
    ...(brand.city ? { address: { "@type": "PostalAddress", addressLocality: brand.city, addressCountry: "CN" } } : {}),
    ...(stores && stores.length
      ? {
          department: stores.map((s) => ({
            "@type": "LocalBusiness",
            name: s.name,
            ...(s.address ? { address: { "@type": "PostalAddress", streetAddress: s.address, addressLocality: brand.city || "", addressCountry: "CN" } } : {}),
            ...(s.phone ? { telephone: s.phone } : {}),
            ...(s.hours ? { openingHours: s.hours } : {}),
          })),
        }
      : {}),
    // 产品与服务 → OfferCatalog（价格用文本描述，不塞进 price 数字字段，避免 schema 校验报错）
    ...(products && products.length
      ? {
          hasOfferCatalog: {
            "@type": "OfferCatalog",
            name: "服务与产品",
            itemListElement: products.map((p) => ({
              "@type": "Offer",
              itemOffered: {
                "@type": "Product",
                name: p.name,
                ...(p.category ? { category: p.category } : {}),
                ...(clean(p.selling_points) ? { description: clean(p.selling_points) } : {}),
              },
              ...(clean(p.price)
                ? { priceSpecification: { "@type": "PriceSpecification", description: clean(p.price) } }
                : {}),
            })),
          },
        }
      : {}),
  };

  const faq =
    faqs && faqs.length
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faqs.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }
      : null;

  return { business, faq };
}

export function buildSiteAssets(input) {
  const { text: llmsTxt, faqs } = buildLlmsTxt(input);
  const { business, faq } = buildJsonLd({ ...input, faqs });

  return {
    llmsTxt,
    faqCount: faqs.length,
    jsonLdBusiness: JSON.stringify(business, null, 2),
    jsonLdFaq: faq ? JSON.stringify(faq, null, 2) : "",
    headSnippet: [
      `<link rel="alternate" type="text/plain" href="/llms.txt" title="LLMs.txt">`,
      `<script type="application/ld+json">`,
      JSON.stringify(business),
      `</script>`,
      ...(faq ? [`<script type="application/ld+json">`, JSON.stringify(faq), `</script>`] : []),
    ].join("\n"),
  };
}
