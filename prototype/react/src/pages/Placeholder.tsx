import { Link } from "react-router-dom";
import { Badge, Card, CardHead, Note } from "../components/ui";

const SITE_MAP = [
  { group: "Agent", items: [["Agent 工作台", "/agent"]] },
  { group: "① 诊断", items: [["AI 全景诊断", "/diagnosis"], ["提问矩阵", "/prompts"], ["C 端取证", "/evidence"]] },
  { group: "② 企业资产", items: [["知识库", "/knowledge"], ["文档与检索", "/kb"], ["产品库", "/products"], ["官网建站", "/site"]] },
  { group: "③ 内容", items: [["内容创作", "/content"], ["数字人与视频", "/avatar"]] },
  { group: "④ 分发", items: [["媒体分发", "/media"], ["发布排期", "/plan"], ["链接资产", "/links"]] },
  { group: "⑤ 复盘", items: [["监测与复盘", "/monitor"], ["SEO 曝光率", "/seo"]] },
  { group: "其他", items: [["设置与成员", "/settings"], ["运营工作台", "/ops"], ["客户与白标", "/agency"]] },
];

export default function NotFound() {
  return (
    <div className="enter flex flex-col gap-3.5">
      <Card>
        <CardHead
          title="页面不存在"
          sub="React 版工作台已覆盖 22 条路由，请从下方或左侧导航进入"
          right={<Badge tone="warn">404</Badge>}
        />
        <div className="mt-3.5 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {SITE_MAP.map((g) => (
            <div key={g.group} className="rounded-xl border border-hair2 bg-[#fafafb] p-3.5">
              <div className="text-[10.5px] font-semibold tracking-[0.06em] text-ink3 uppercase">{g.group}</div>
              <div className="mt-2 flex flex-col gap-1.5">
                {g.items.map(([label, to]) => (
                  <Link key={to} to={to} className="flex items-center gap-1.5 text-[12px] text-[#3a3a3c] hover:text-accent">
                    <i className="h-1 w-1 rounded-full bg-accent" />
                    {label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Note tone="info" title="数据口径提示：">
        React 版已接入 Express + SQLite 后端，主链路数据真实落库；`/avatar`、`/agency` 仍为前端演示页，
        探测与搜索排名在未配置密钥时会明确标注「模拟 / 未检测」。早期 HTML 原型保留在
        <a href="/index.html" className="ml-1 underline">
          开始界面
        </a>
        。
      </Note>
    </div>
  );
}
