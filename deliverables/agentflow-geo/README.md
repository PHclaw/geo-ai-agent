# AgentFlow 的 GEO 改造包

面向 `http://159.75.21.251:3000`（AgentFlow）的体检结论与可直接部署的资产。
体检得分：**22/100（2/9 项通过）**，核心问题是「AI 看到的是一张空白页」。

---

## 一、先说一个必须解决的前置问题：资料口径互相矛盾

我把 README、docs/FAQ.md、docs/COMPARISON.md、LICENSE 对照了一遍，有 5 处冲突。
**AI 会随机引用其中一个版本**，等于把矛盾喂给模型。

| 事实项 | README | docs/FAQ.md | docs/COMPARISON.md | LICENSE 文件 | 建议以谁为准 |
| --- | --- | --- | --- | --- | --- |
| 开源协议 | GPL-2.0 | **MIT** | **MIT** | **GPL-2.0** | **LICENSE（GPL-2.0）** |
| 数据存储 | SQLite 默认，PG 可选 | «存储在你自己的 PostgreSQL» | pgvector | — | README |
| pgvector | 路线图 `[ ]` 未验证 | «存入 pgvector» | ✅ 支持 | — | 待实测后再写 |
| 浏览器自动化 | 未提 | «内置 Browser-Use，Dify 没有» | ✅ 内置 | — | 代码里若确有才写 |
| 生态整合 | 未提 | «9 个 agent-* 生态库» | 同 | — | 同上 |
| 模板数量 | 客服/销售/HR/财务等 | «6 个行业模板» | — | — | README |

**为什么这条最要紧**：协议写错不只是不严谨——GPL-2.0 有传染性，若 AI 对外宣称 "MIT、可自由商用"，
有人照做会踩法律风险。所以本方案里的 llms.txt 与 JSON-LD **不写具体协议名**，
只写「以仓库 LICENSE 为准」并给出 URL。

建议动作（30 分钟）：把 FAQ.md 与 COMPARISON.md 里的 MIT 改成 GPL-2.0，
把「PostgreSQL」改成「默认 SQLite、可选 PostgreSQL」，pgvector 与 Browser-Use 两处按代码实况修正。

---

## 二、文件清单（复制到你仓库的位置）

| 本目录文件 | 目标位置 | 作用 |
| --- | --- | --- |
| `llms.txt` | `frontend/public/llms.txt` | 给 AI 的纯文本产品说明（品牌/能力/FAQ/引用说明） |
| `robots.txt` | `frontend/public/robots.txt` | 显式放行 GPTBot / ClaudeBot / PerplexityBot / Bytespider / QwenBot |
| `sitemap.xml` | `frontend/public/sitemap.xml` | 只收录真实存在的公开路由（已核对 Router.tsx） |
| `nginx-geo.conf` | 粘贴进 `frontend/nginx.conf` 的 `location /` 之前 | **关键**：阻止 404 回退成 index.html |
| `index-head.html` | 拆成两段贴进 `frontend/index.html` | JSON-LD（SoftwareApplication / Organization / FAQPage）+ noscript 兜底 |

`frontend/public/` 下的文件在 `npm run build` 时会原样复制到 `dist/` 根目录。

---

## 三、落地顺序（约 1.5 小时，不含预渲染）

### 第 1 步：nginx 白名单（10 分钟，先做这个）

不改这条，后面三个文件放了也白放。原因：现在 `location / { try_files $uri $uri/ /index.html; }`
会把 `/llms.txt` 的 404 回退成首页，AI 拿到 HTML 会解析失败。

按 `nginx-geo.conf` 插入三个 `location =`。验证：

```bash
curl -I http://159.75.21.251:3000/llms.txt     # 期望 200 + text/plain
curl -s http://159.75.21.251:3000/llms.txt | head -1   # 期望输出 "# AgentFlow"
```

### 第 2 步：放三个文件 + 改 index.html（20 分钟）

`llms.txt` / `robots.txt` / `sitemap.xml` → `frontend/public/`
`index-head.html` 里的 ① 段贴到 `</head>` 前，② 段贴到 `<div id="root">` 之后。

### 第 3 步：构建部署（10 分钟）

```bash
cd frontend && npm run build
# Docker 部署：docker compose up -d --build frontend
```

### 验证

```bash
curl -s http://159.75.21.251:3000/sitemap.xml | head -3     # 期望 <?xml ... <urlset
curl -s http://159.75.21.251:3000/robots.txt | head -3      # 期望 User-agent: *
```

---

## 四、还差最后一跳：营销页预渲染（半天）

做完上面三步，站点大概能到 60 分左右，但**首页对 AI 仍然是空的**——
因为 React 还没执行。`noscript` 只能兜住一部分爬虫（Google 读，多数 LLM 爬虫不读）。

真正解决要预渲染。公开路由只有两个（`/` 与 `/templates`），用 Puppeteer 抓一遍就够：

```js
// scripts/prerender.mjs
import { chromium } from 'puppeteer'
import { preview } from 'vite'
import { writeFileSync, mkdirSync } from 'node:fs'

const routes = [{ path: '/', out: 'dist/index.html' }, { path: '/templates', out: 'dist/templates/index.html' }]
const server = await preview({ preview: { port: 4173 } })
const browser = await chromium.launch()
const page = await browser.newPage()

for (const r of routes) {
  await page.goto(`http://localhost:4173${r.path}`, { waitUntil: 'networkidle0' })
  await page.waitForTimeout(800)                 // 等首屏异步数据
  const html = await page.content()
  const dir = r.out.replace('/index.html', '')
  mkdirSync(dir, { recursive: true })
  writeFileSync(r.out, html)
  console.log('prerendered', r.path, '→', r.out)
}

await browser.close()
await server.close()
```

在 `npm run build` 之后执行，nginx 的 `try_files $uri $uri/` 会优先命中 `dist/templates/index.html`。

**注意**：只预渲染营销页。`/dashboard`、`/agents` 等登录后页面不要预渲染（没有意义，且可能被抓）。

---

## 五、两处顺手能修的问题

1. **`/pricing` 复用 LandingPage**（`Router.tsx` 里 `path="/pricing" element={<LandingPage />}`）
   → 与首页内容完全重复。要么做成独立定价页（有真实定价信息更好，AI 爱摘这类内容），
   要么给它加 `<link rel="canonical" href="/">` 避免重复收录。所以 sitemap 里我没有收录 `/pricing`。
2. **每路由需要独立 meta**：现在 title/description 写死在 `index.html`，`/templates` 与首页共用一份。
   建议引入 `react-helmet-async`，按路由设置 title / description / canonical。

---

## 六、验收标准

| 检查 | 方法 | 目标 |
| --- | --- | --- |
| 文件是真文件 | `curl -I .../llms.txt` | 200 + `text/plain` |
| sitemap 合法 | `curl .../sitemap.xml` | 含 `<urlset` 与 2 个 `<loc>` |
| robots 放行 | `curl .../robots.txt` | 含 `User-agent: GPTBot` |
| JSON-LD 有效 | 页面源码搜 `application/ld+json` | 3 段，`@type` 分别为 SoftwareApplication / Organization / FAQPage |
| 首页有正文 | 查看源码（不是 DevTools 渲染后） | 能看到 `<h1>` 与至少一段正文 |
| 体检得分 | 本系统「官网体检」重跑 | **≥ 75（9 项至少 7 项通过）** |

预期分数变化：22 → 约 60（做完第三节）→ 约 80（做完预渲染）。

---

## 七、一个可以顺手做的内容资产

这个站本身就是「AI Agent 部署平台」，而它自己的官网 AI 读不到——这个反差是很好的 GEO 素材。
改造完成后可以写一篇：《我们的官网在 AI 眼里是空白页：一次 22 分到 80 分的修复记录》，
附上前后体检截图。这类「自曝问题 + 给方法」的内容，比任何产品广告都更容易被 AI 引用。
