![GEO AI Agent 项目横幅](deliverables/geo-ai-agent/banner.png)

# GEO AI Agent

> 企业 AI 可见度增长系统 · 本地可运行的单机演示版（**不是已上线的 SaaS**）

帮企业在豆包、DeepSeek、元宝等生成式 AI 的回答里「被提到、说对、优先被推荐」，并把「发布 → 收录 → 被引用 → 曝光」串成一条可核验的链路。

核心闭环：**AI 全景诊断 → 知识资产建库 → 内容生产 → 分发与排期 → 监测复盘**。
核心指标：AVI（AI 可见度指数）、SoV、GEOS（内容可引用性）、AIW（信源权重，当前为种子值）、SEO 曝光率。

本项目最重要的一条口径是：**来源标注、不把模拟数据当成真实结果**。没配置 Key 的能力会明确显示「模拟 / 未检测」，不会编造排名或 AI 答案。

---

## 一眼看懂

**五步闭环与数据来源**：绿色是无需 Key 的真实执行，蓝色是人工录入（可核验），灰色是模拟或待 Key 的通道；复盘结果会回流去修正事实卡口径、重新生成内容并更新发布排期。

![GEO AI Agent 五步闭环与数据口径](deliverables/geo-ai-agent/pipeline.png)

> 图 1：五步闭环。当前 6 个模型 Key 与搜索 Key 均未配置，所以「诊断」与「关键词排名」两处仍标为模拟 / 未检测。

**系统框架**：输入与数据层 → 引擎与编排层 → 输出与产物层，三段式结构与代码里的模块一一对应。

![GEO AI Agent 系统框架](deliverables/geo-ai-agent/framework.png)

> 图 2：系统框架。左列是品牌 / 知识库 / 事实卡等输入，中间是诊断、内容、分发三条链路与共享运行时，右列是报告、文章、台账、看板等产物。

---

## 快速开始

### 前置

| 项 | 要求 |
| --- | --- |
| Node.js | ≥ 22（开发环境为 v25.7，使用内置 `node:sqlite`） |
| npm | ≥ 10 |
| 智能体写作（可选） | 本机已安装 `pi` CLI，并在 `~/.pi/agent/auth.json` 配好模型凭证 |
| 外部服务 | 不需要；首次启动自动建库并写入演示数据 |

### 启动

```bash
# 后端：Express + node:sqlite，默认 http://127.0.0.1:8002
cd server
npm install
npm start

# 前端：另开一个终端
cd prototype/react
npm install
npm run dev -- --port 3001
```

打开 `http://127.0.0.1:3001`。

> **端口说明**：`vite.config.ts` 的默认端口是 `3000` 且 `strictPort: true`。若 `3000` 已被其它服务占用，用 `-- --port 3001` 覆盖即可；`/api` 代理固定指向后端 `8002`，无需改配置。后端默认只监听 `127.0.0.1`，可用 `PORT` 覆盖。

### 登录

| 角色 | 账号 | 密码 |
| --- | --- | --- |
| 演示 / 负责人 | `13800000000` | `123456` |
| 运营（人工代投） | `13900000000` | `123456` |

`GET /api/health` 可确认后端状态：

```bash
curl http://127.0.0.1:8002/api/health
# {"ok":true,"mode":"mock", ...}
```

`mode=mock` 表示没有真实模型 Key，探测走确定性模拟——**这是预期的，不是启动失败**。

### 停止

结束两个终端进程即可；后台启动时可用 `Stop-Process -Id <后端PID>,<前端PID>`（Windows PowerShell）。

---

## 目录结构

```text
GEO Aiagent/
├── README.md                 本文件
├── .gitignore                忽略 node_modules / .env / *.db / 上传样本 / 验收截图
├── docs/
│   └── GEO-AI-Agent-PRD.md   唯一需求与实现文档（19 章，第 19 章为实现进度自述）
├── server/                   后端
│   ├── index.js              Express 路由（约 87 个 API）与启动入口
│   ├── db.js                 30 张表、迁移与种子数据
│   ├── geo.js                AVI / SoV / GEOS 计算
│   ├── probe.js              6 平台探测适配器（超时 / 重试 / 错误分类）
│   ├── providers.js          模型 Key 与 live / mock 判定
│   ├── seo.js               站点可索引性抓取、SERP 适配、位次匹配
│   ├── links.js              链接台账：URL 规范化、真实巡检、引用统计
│   ├── content-template.js   模板文章渲染（纯函数，事实卡 + 知识库资料驱动）
│   ├── plan.js               发布排期规则（养号 + 知识/GEO 穿插）
│   ├── seo-import.js         GSC / 站长平台 CSV 解析与曝光率计算
│   ├── agent/                piagent（SSE 写作）、事实回比、合规、数据图、站点体检
│   ├── scripts/              手工冒烟脚本与 `e2e-agentflow.mjs` 全链路测试
│   ├── *.test.js             node:test 自动化测试（6 个文件 / 25 个用例）
│   ├── .env.example          可选配置模板（**只提交这个文件，不提交 .env**）
│   └── data/geo.db           运行后自动创建的 SQLite 库（WAL 模式）
├── prototype/
│   ├── react/                React 19 + Vite 7 + Tailwind 4 工作台
│   │   ├── src/pages/        21 个页面（含 404 导航页）
│   │   ├── src/api/          请求封装与 TypeScript 类型
│   │   ├── public/           静态资源（横幅 / 框架图 / 闭环图 HTML 源，可由 Vite 直接预览）
│   │   └── dist/             生产构建产物
│   └── app/*.html            早期静态原型（已被 React 版取代，保留备份）
└── deliverables/             交付物
    ├── agentflow-geo/        外部站点 GEO 体检交付包
    ├── e2e-agentflow/        全链路测试报告、结果 JSON 与页面截图
    ├── generated-samples/    内容生成样本（Markdown + 指标汇总）
    └── geo-ai-agent/         项目横幅、系统框架图与闭环图（HTML + PNG）
```

---

## 功能地图

| 阶段 | 页面 | 主要能力 |
| --- | --- | --- |
| 诊断 | `/`、`/diagnosis`、`/prompts`、`/evidence` | 工作台聚合、6 平台探测、AVI / SoV 双轨指标、四象限归因、提问矩阵、C 端人工取证 |
| 资产 | `/knowledge`、`/kb`、`/products`、`/site` | 事实卡冲突解决、文档上传抽取切片、BM25 检索、产品库、官网 9 项体检与 `llms.txt` / JSON-LD 生成 |
| 内容 | `/content`、`/avatar` | 模板生成与 `pi` 智能体 SSE 写作、事实回比、合规拦截、SVG 数据图、GEOS 评分、HTML 导出；数字人脚本/配置落库 |
| 分发 | `/media`、`/plan`、`/links`、`/ops` | 媒体库与订单、人工代投、发布排期（养号 + 穿插）、统一 URL 台账与真实 HTTP 存活巡检 |
| 复盘 | `/monitor`、`/seo` | 指标趋势、竞品与缺口清单、SEO 曝光率看板、关键词位次、人工位次录入与站长 CSV 导入 |
| 管理 | `/settings`、`/agency` | 4 角色 RBAC、成员邀请、审计日志、服务商客户与白标设置 |

发布排期遵循三条口径：**只生成计划、不代发**；**养号知识内容不计入 AI 曝光指标**；只有「GEO 文章 + 已回填真实链接」才计入效果。

### 页面效果

以下是真实运行时的页面截图（2026-11-12 全链路测试时截取，未做修饰）：

| 工作台 | 内容创作 |
| --- | --- |
| ![工作台：AVI 双轨指标](deliverables/e2e-agentflow/screenshots/dashboard.png) | ![内容创作：文章列表与 GEOS](deliverables/e2e-agentflow/screenshots/content.png) |
| AVI 双轨指标、四象限归因与待办 | 文章列表、GEOS 评分、模板与智能体写作 |

| 发布排期 | SEO 曝光率 |
| --- | --- |
| ![发布排期：养号与穿插](deliverables/e2e-agentflow/screenshots/plan.png) | ![SEO 曝光率看板](deliverables/e2e-agentflow/screenshots/seo.png) |
| 周视图、养号 / 穿插阶段标记、回填链接 | 曝光率、关键词位次、人工录入与 CSV 导入 |

另外两张（`/diagnosis` 诊断、`/links` 链接资产台账）在 `deliverables/e2e-agentflow/screenshots/`，共 6 张。

---

## 数据源与口径（重要）

| 通道 | 当前状态 | 如何变真实 |
| --- | --- | --- |
| AI 探测（AVI / 提及率 / SoV） | `mode=mock`，6 平台全部模拟 | 在 `server/.env` 至少填 1 个 `GEO_*_KEY` |
| 智能体写作 / 资料整理 | **真实执行**（本机 `pi` CLI） | 凭证在 `~/.pi/agent/auth.json`，**不读 `server/.env`** |
| 站点可索引性 / SEO 扫描 | **真实 HTTP 抓取**（9 项检查） | 无需 Key；目标站当前 41/100 |
| 关键词排名 / `site:` 收录 | 「未检测」 | 填 SerpAPI Key；或用 `/seo` 人工录入逐词位次 |
| 展现量 / 点击 / CTR / 收录 | 人工核查基线或 CSV 导入 | GSC / 百度站长导出后录 `/seo` |
| C 端 AI 答案取证 | 人工粘贴，A 级证据 | `/evidence`，比裸模型 API 更权威 |
| 链接存活 | **真实 HTTP 巡检** | `/links` 手动点「批量巡检」 |
| 发布链接 | 人工代投回填 | `/ops` → `/links` → 排期回填 |
| 媒体库 / 90 天指标基线 / 演示账号 | **种子 / 演示数据** | 上线前替换为真实业务数据 |

**零 Key 也能跑出真实数据**：人工查位次 → `/seo` 录入 → 曝光率与趋势；每周导 GSC CSV → 导入；AI 平台取证 → `/evidence`；发布回填 → `/links` 巡检。全自动只是把「每天几分钟」变成「0 分钟」，不是能否使用的前提。

所有人工数据标 `manual`，模拟样本单列 `citedMock` 不计入效果；口径切换时不计算涨跌，避免把数据源变化当成真实增长。

---

## 配置

复制模板后填写（仓库只保留 `.env.example`）：

```bash
cp server/.env.example server/.env
# Windows PowerShell：Copy-Item server\.env.example server\.env
```

| 变量组 | 作用 | 必需？ |
| --- | --- | --- |
| `GEO_DEEPSEEK_KEY` 等 6 个 `_KEY` / `_BASE` / `_MODEL` | 6 家大模型真实探测 | 至少 1 个才让 AVI 变真实 |
| `GEO_SEO_SEARCH_KEY` + `GEO_SEO_SEARCH_BASE` + `GEO_SEO_SEARCH_ENGINE` | 搜索结果 API（推荐 SerpAPI） | SEO 排名变真实必需 |
| `GEO_SEO_SCAN_INTERVAL_MIN` | 定时扫描间隔（分钟），`0` = 关闭 | 可选 |
| `GEO_TOKEN_SECRET` | 登录 Token 签名 | **上线前必须改成随机长串**（模板里是默认值） |
| `PORT` / `GEO_DB_PATH` | 监听端口 / 数据库路径 | 可选，默认 `8002` / `./data/geo.db` |

最小可验证集：1 个 DeepSeek Key + 1 个 SerpAPI Key，重启后验收：

```text
GET  /api/health            → mode=live / mixed，providers.live > 0
POST /api/providers/test    → ok=true
GET  /api/seo/overview      → sources.serp.live=true
POST /api/seo/scan          → mode=live，关键词表出现真实位次
```

> 注意：**Bing Web Search v7 已于 2025-08-11 退役**，不要再申请该订阅密钥。豆包的 `_MODEL` 要填推理接入点 ID（`ep-xxx`）；腾讯元宝用混元近似，C 端无公开 API。
>
> 安全：不要把 Key 贴进聊天、前端或提交记录；`.env` 已在 `.gitignore` 中。

---

## 开发命令

| 目录 | 命令 | 说明 |
| --- | --- | --- |
| `server` | `npm start` / `npm run dev` | 启动 / 热重载启动 |
| `server` | `npm test` | `node --test`，当前 25 个用例全通过 |
| `server` | `node scripts/e2e-agentflow.mjs` | 全链路端到端测试（需前后端已启动），结果写入 `deliverables/e2e-agentflow/` |
| `prototype/react` | `npm run dev -- --port 3001` | 开发服务器 |
| `prototype/react` | `npx tsc --noEmit` | TypeScript 严格类型检查 |
| `prototype/react` | `npm run build` | 构建到 `dist/` |

数据库在首次启动时自动建表、迁移并写入种子数据；**删除 `server/data/geo.db*` 后重启会重建，但会清空所有本地数据**，请先自行备份。删除品牌时后端会自动整包导出到 `server/data/backups/`（JSON + 上传文件），但当前**没有独立的恢复接口**。

API 分组与 30 张表清单见 `docs/GEO-AI-Agent-PRD.md` 的 **19.2 / 19.3**；框架图见 `deliverables/geo-ai-agent/framework.png`（源文件 `framework.html`，也可在 `http://127.0.0.1:3001/geo-framework.html` 打开）。

---

## 当前边界（如实标注）

**功能已跑通，但仍是本地演示态**：

- 未配模型 Key 与搜索 Key，AVI 与关键词排名还是模拟 / 未检测；目标站点 `159.75.21.251:3000` 是裸 IP + SPA 空白页，`robots/sitemap` 假 200，可索引性只有 41/100——**站点不修好，配齐 Key 也只是把「0 命中」测得更准**
- 后端只监听 `127.0.0.1`，不托管前端 `dist`，需要两个进程；无 HTTPS、限流、CI / Docker、对象存储与备份策略
- `GEO_TOKEN_SECRET` 仍是默认值，演示账号固定；CORS 回显任意 Origin
- 视频播放器、语音克隆、活体校验、外部视频生成服务、报告生成、批量复测、跨租户切换、UTM / 线索归因、告警、直连媒体 API 均未接入（相关按钮会标注「未接入」或只登记 `pending` 任务）
- PRD 17.2 的 10 项上线验收清单尚未勾选
- 根目录留有历史验收截图 `.tmp-*.png`，已被 `.gitignore` 忽略，可自行清理

---

## 文档索引

| 位置 | 内容 |
| --- | --- |
| `docs/GEO-AI-Agent-PRD.md` 1–18 章 | 产品定位、指标字典、功能需求、路线图、视觉规范 |
| 19.1 / 19.2 / 19.3 | 运行方式、30 张表、完整 API 清单 |
| 19.4 – 19.6 | 探测引擎、智能体、边界与后续 |
| 19.7 | SEO 曝光率模块（三路数据源、口径） |
| 19.8 | 链接资产台账（发布 / 收录 / 引用归因） |
| 19.9 | 半自动数据通道（人工位次 + 站长 CSV） |
| 19.10 | 静态页面改造（数字人 / 服务商落库） |
| 19.11 | 内容生成文章质量优化与评分口径 |
| 19.12 | 发布排期（养号与知识 / GEO 穿插） |
| `deliverables/e2e-agentflow/REPORT.md` | 最近一次全链路端到端测试结果与页面截图 |

## 图片清单与重新生成

README 内所有图片都是本项目实际运行截图或自绘示意图，无外部素材：

| 图片 | HTML 源文件 | 重新生成方式 |
| --- | --- | --- |
| `deliverables/geo-ai-agent/banner.png` | `banner.html` | 项目横幅（1600×460）；编辑 HTML 后截取 `.banner` 元素；Vite 运行时可访问 `/geo-banner.html` |
| `deliverables/geo-ai-agent/pipeline.png` | `pipeline.html` | 编辑 HTML 后浏览器截图；Vite 运行时可访问 `/geo-pipeline.html` |
| `deliverables/geo-ai-agent/framework.png` | `framework.html` | 同上；Vite 运行时可访问 `/geo-framework.html` |
| `deliverables/e2e-agentflow/screenshots/*.png` | — | 跑 `node scripts/e2e-agentflow.mjs` 后由无头浏览器重新截取 6 个页面 |

三张自绘图（`banner.html` / `pipeline.html` / `framework.html`）在 `prototype/react/public/` 下各有一份同源副本，方便通过前端服务直接预览；交付目录里的是最终 PNG 与 HTML。若修改了模块结构，请同步更新 `pipeline.html` / `framework.html` 再重新截图，避免图与代码漂移。

---

本项目为内部研发 / 演示工程，未声明开源协议。
