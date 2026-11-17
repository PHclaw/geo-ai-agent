/* 提问质量体检：node scripts/check-prompt-quality.mjs */
import { db } from "../db.js";

for (const b of db.prepare("SELECT id, name, city FROM brands ORDER BY created_at").all()) {
  const rows = db.prepare("SELECT text, intent, weight FROM prompts WHERE brand_id=? ORDER BY intent, weight DESC").all(b.id);
  console.log("\n========== %s（%s 条）==========", b.name, rows.length);

  const byIntent = {};
  for (const r of rows) (byIntent[r.intent] = byIntent[r.intent] || []).push(r.text);
  for (const [k, list] of Object.entries(byIntent)) {
    console.log("\n[%s] %s 条", k, list.length);
    list.forEach((t, i) => console.log("   %2s. %s", i + 1, t));
  }

  // 去掉地名与品牌名后，看还剩多少种"真实句式"
  const areas = ["河西", "江宁", "浦口", "鼓楼", "雨花台", "栖霞", "主城", "附近", "周边", "本地"];
  const skeleton = new Set();
  for (const r of rows) {
    let s = r.text;
    s = s.replace(new RegExp(areas.join("|"), "g"), "");
    s = s.replace(new RegExp(b.name, "g"), "");
    s = s.replace(/[？?。，,、\s]/g, "");
    skeleton.add(s);
  }
  console.log("\n>>> 去掉地名/品牌名后，剩余不同句式：%s / %s 条（重复率 %s%%）",
    skeleton.size, rows.length, Math.round((1 - skeleton.size / rows.length) * 100));

  // 含品牌名的比例（用户不会这么问）
  const withBrand = rows.filter((r) => r.text.includes(b.name)).length;
  console.log(">>> 问题里直接出现品牌名：%s 条（%s%%）", withBrand, Math.round((withBrand / rows.length) * 100));
}
