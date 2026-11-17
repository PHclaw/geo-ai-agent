/* ============================================================
   事实回比校验：生成后再用事实卡审一遍正文里的数字
   目的不是判对错，而是把"没有出处的数字"揪出来给人看
   ============================================================ */

const UNIT_RE =
  /(\d+(?:\.\d+)?)\s*(元\/㎡|元每平|元\/平方米|万元|元|㎡|平方米|家|天|年|人|公里|%|片区|小时|个月)/g;

function numsOf(value) {
  return (String(value || "").match(/\d+(?:\.\d+)?/g) || []).map(Number);
}

/** 合理的容差：年份、百分比基数等不计为可疑 */
function tolerated(num, unit) {
  if (unit === "年" && num >= 1990 && num <= 2035) return true;
  if (unit === "%" && (num === 100 || num === 0)) return true;
  if (unit === "个月" && num <= 36) return true;
  return false;
}

/**
 * @param text 正文
 * @param facts 事实卡（含 status）
 * @param storeCount 门店数
 * @returns { issues: [{value, unit, context}], checked, allowed }
 */
export function checkFacts(text, { facts = [], storeCount = 0 } = {}) {
  const allowed = new Set();
  facts.forEach((f) => {
    if (f.status !== "active") return;
    numsOf(f.value).forEach((n) => allowed.add(n));
  });
  if (storeCount) allowed.add(Number(storeCount));

  const body = String(text || "");
  const issues = [];
  const seen = new Set();
  let checked = 0;

  UNIT_RE.lastIndex = 0;
  let m;
  while ((m = UNIT_RE.exec(body))) {
    checked++;
    const num = Number(m[1]);
    const unit = m[2];
    const key = `${num}|${unit}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (allowed.has(num) || tolerated(num, unit)) continue;

    const from = Math.max(0, m.index - 26);
    const to = Math.min(body.length, m.index + m[0].length + 26);
    issues.push({
      value: num,
      unit,
      context: body
        .slice(from, to)
        .replace(/\*+/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    });
  }

  return { issues, checked, allowed: allowed.size };
}
