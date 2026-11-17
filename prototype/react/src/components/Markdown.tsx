/* 轻量 Markdown 渲染（零依赖）：标题 / 加粗 / 列表 / 分隔线 / 段落
   只覆盖模型实际会输出的子集，够用即可，不引入完整解析器 */
import type { ReactNode } from "react";

function inline(text: string, keyBase: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((seg, i) => {
    if (/^\*\*[^*]+\*\*$/.test(seg)) {
      return (
        <b key={`${keyBase}-b${i}`} className="font-semibold text-ink">
          {seg.slice(2, -2)}
        </b>
      );
    }
    if (/^\*[^*]+\*$/.test(seg)) {
      return (
        <em key={`${keyBase}-i${i}`} className="text-ink3 not-italic">
          {seg.slice(1, -1)}
        </em>
      );
    }
    return <span key={`${keyBase}-t${i}`}>{seg}</span>;
  });
}

/**
 * 按空行分块，并把连续的表格行单独切成一块。
 * 即便上游忘了写空行，表格也不会把整篇文章吞掉。
 */
function splitBlocks(text: string): string[] {
  const blocks: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) {
      blocks.push(buf.join("\n"));
      buf = [];
    }
  };
  for (const line of String(text || "").split("\n")) {
    if (line.trim() === "") {
      flush();
      continue;
    }
    const isTable = /^\s*\|/.test(line);
    if (buf.length && /^\s*\|/.test(buf[buf.length - 1]) !== isTable) flush();
    buf.push(line);
  }
  flush();
  return blocks;
}

export default function Markdown({ text, className = "" }: { text: string; className?: string }) {
  const blocks = splitBlocks(text);

  return (
    <div className={`text-[12.5px] leading-[1.85] text-[#2b2b2e] ${className}`}>
      {blocks.map((raw, bi) => {
        const block = raw.trim();
        if (!block) return null;

        if (/^---+$/.test(block)) return <hr key={bi} className="my-3 border-hair" />;

        // 图片：![alt](url)
        const img = block.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
        if (img) {
          return (
            <figure key={bi} className="my-3">
              <img
                src={img[2]}
                alt={img[1]}
                loading="lazy"
                className="w-full rounded-xl border border-hair bg-white"
              />
              {img[1] && (
                <figcaption className="mt-1.5 text-center text-[11px] leading-relaxed text-ink3">{img[1]}</figcaption>
              )}
            </figure>
          );
        }

        // 表格：首行 | 表头 |，次行 | --- |，其余为数据行
        const blockLines = block.split("\n");
        const tableRows = blockLines.filter((l) => l.trim().startsWith("|"));
        if (
          tableRows.length >= 2 &&
          tableRows.length === blockLines.length &&
          /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(tableRows[1])
        ) {
          const cells = (row: string) =>
            row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((s) => s.trim());
          const head = cells(tableRows[0]);
          const body = tableRows.slice(2).map(cells);
          return (
            <div key={bi} className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr>
                    {head.map((h, i) => (
                      <th key={i} className="border border-hair bg-[#fafafb] px-2.5 py-1.5 text-left font-semibold">
                        {inline(h, `th${bi}-${i}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((c, ci) => (
                        <td key={ci} className="border border-hair px-2.5 py-1.5">
                          {inline(c, `td${bi}-${ri}-${ci}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        const h = block.match(/^(#{1,6})\s+(.*)$/);
        if (h) {
          const level = h[1].length;
          const size = level === 1 ? "text-[16px] mt-1" : level === 2 ? "text-[14px] mt-3" : "text-[13px] mt-2.5";
          return (
            <div key={bi} className={`${size} mb-1.5 font-semibold tracking-[-0.01em] text-ink`}>
              {inline(h[2], `h${bi}`)}
            </div>
          );
        }

        const lines = block.split("\n");
        if (lines.every((l) => /^\s*([-*]|\d+[.、])\s+/.test(l))) {
          const ordered = /^\s*\d+[.、]\s+/.test(lines[0]);
          const items = lines.map((l) => l.replace(/^\s*([-*]|\d+[.、])\s+/, ""));
          const Tag = ordered ? "ol" : "ul";
          return (
            <Tag key={bi} className={`my-1.5 pl-4 ${ordered ? "list-decimal" : "list-disc"} space-y-1`}>
              {items.map((it, i) => (
                <li key={i}>{inline(it, `l${bi}-${i}`)}</li>
              ))}
            </Tag>
          );
        }

        return (
          <p key={bi} className="my-1.5">
            {block.split("\n").map((line, i) => (
              <span key={i}>
                {inline(line, `p${bi}-${i}`)}
                {i < block.split("\n").length - 1 && <br />}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
