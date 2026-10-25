import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const FALLBACK = `Power BI report skill rules (summary):
- Plan audience, one analytical question per visual, and a page hierarchy before authoring.
- Use cardVisual for KPIs, bar/column/line for comparison and trend, tableEx for detail, slicer for filters.
- Keep 12-column grid layouts, consistent gutters, and accessible contrast; avoid deprecated visuals.
- Build PBIR only after the design contract is approved; validate with powerbi-report-author after every batch.
- Rendered output is not complete until the report is loaded, screenshots are captured, and reviewed.`;

export function loadSkillContext(extensionPath?: string): string {
  const candidates = [
    process.env.POWERBI_REPORT_SKILL_DIR,
    extensionPath ? path.join(extensionPath, "resources", "skills", "powerbi-report-cli") : undefined,
    path.join(process.cwd(), "resources", "skills", "powerbi-report-cli"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const directory of candidates) {
    const skillFile = path.join(directory, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    const text = readFileSync(skillFile, "utf8");
    if (text.trim().length > 0) return text;
  }
  return FALLBACK;
}
