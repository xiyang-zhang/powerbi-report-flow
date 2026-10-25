import type { DataProfile, FlowConfig, ModelSpec } from "../core/types";
import { NATIVE_VISUAL_KINDS } from "../report/visualCatalog";
import type { LlmMessage } from "./provider";

export const SYSTEM_PROMPT = `You are the Power BI Report Flow design engine.
You follow the Power BI report skill's rules: one analytical question per visual, accessible contrast,
clear hierarchy, no deprecated visuals, and a page plan that can be implemented as PBIR.
Return only valid JSON. Do not wrap JSON in markdown fences. Do not invent fields that are not in the model profile.
The canonical design contract uses: generated_by, contract_version, design_identity, color_map, pages[].layout_contract.regions,
pages[].layout_contract.placements, pages[].background, accessibility, and theme.
Every requested page must be present in pages[]; use layout_contract.placements with absolute pixel or grid regions.
When images are attached to the request, use them as visual reference for layout, hierarchy, color, and chart intent.
Native visual kinds you may use: ${NATIVE_VISUAL_KINDS.join(", ")}.
Backgrounds may be a solid color string, or an object: { "color": "#F7F9FC", "image": "relative/or/absolute/path.png", "scaling": "Fit|Fill|Tile|Normal", "transparency": 0-100 }.`;

function systemWithSkill(skillContext?: string): string {
  if (!skillContext || skillContext.trim().length === 0) return SYSTEM_PROMPT;
  const excerpt = skillContext.trim().slice(0, 12_000);
  return `${SYSTEM_PROMPT}\n\nOfficial Power BI report skill guidance (authoritative when it conflicts with general habits):\n${excerpt}`;
}

function contextBlock(contextText?: string): string {
  if (!contextText || contextText.trim().length === 0) return "";
  return `\nAttached document context (use it to understand pages, KPI definitions, and visual intent):\n${contextText.trim().slice(0, 30_000)}\n`;
}

const SPEC_SHAPE = `{
  "generated_by": "powerbi-report-cli",
  "contract_version": 1,
  "mode": "greenfield",
  "design_identity": { "tone": "clean executive", "signature": "KPI strip plus analysis panels" },
  "color_map": { "<measure name>": "#2E86AB" },
  "pages": [{
    "name": "overview",
    "display_name": "Overview",
    "role": "overview",
    "canvas": { "width": 1280, "height": 720 },
    "background": { "color": "#F7F9FC" },
    "layout_contract": {
      "regions": { "header": [1,1,12,2], "kpis": [1,3,12,5], "chart": [1,6,8,12], "detail": [9,6,12,12] },
      "placements": [{
        "id": "title", "region": "header", "kind": "textbox", "text": "Sales Overview", "field_bindings": []
      }, {
        "id": "kpis", "region": "kpis", "kind": "card",
        "field_bindings": ["Sales[Total Revenue] (measure)"]
      }]
    }
  }, {
    "name": "breakdown",
    "display_name": "Breakdown",
    "role": "breakdown",
    "canvas": { "width": 1280, "height": 720 },
    "background": { "color": "#F7F9FC" },
    "layout_contract": {
      "regions": { "header": [1,1,12,2], "chart": [1,3,12,8], "detail": [1,9,12,12] },
      "placements": [{
        "id": "breakdown", "region": "chart", "kind": "donutChart",
        "field_bindings": ["Sales[Region] (column)", "Sales[Revenue] (measure)"]
      }]
    }
  }],
  "accessibility": { "alt_text_strategy": "headline plus trend", "contrast_notes": "dark text on light canvas" },
  "theme": { "base": "CY24SU06" }
}`;

export function profileSummary(profile: DataProfile): string {
  const tables = profile.tables.map((table) => ({
    name: table.name,
    columns: table.columns.map((column) => ({ name: column.name, type: column.type, isKey: column.isKey ?? false })),
    measures: table.measures.map((measure) => ({ name: measure.name, expression: measure.expression })),
    rows: table.rows,
  }));
  return JSON.stringify(
    {
      source: profile.sourceLabel,
      sourceMode: profile.sourceMode,
      relationships: profile.relationships,
      tables,
      warnings: profile.warnings,
    },
    null,
    2,
  );
}

export function buildSpecMessages(
  config: FlowConfig,
  profile: DataProfile,
  referenceProfile?: unknown,
  skillContext?: string,
  contextText?: string,
): LlmMessage[] {
  const pageCount = Math.max(1, Math.min(8, Math.round(config.pageCount ?? 1)));
  const brief =
    config.textBrief?.trim() ||
    `Create a ${pageCount}-page analytical report for a business audience. Include headline KPIs, comparisons, trends, and detail pages.`;
  const user = `Design a Power BI report with exactly ${pageCount} page(s).

User brief:
${brief}

Audience: ${config.audience ?? "business stakeholders"}
Tone/brand: ${config.tone ?? "clean, confident, high contrast"}
Requested pages: ${pageCount}
${contextBlock(contextText)}
Data model profile:
${profileSummary(profile)}

${referenceProfile ? `Reference report profile (use it as a style/layout template, but rebind to the new model):\n${JSON.stringify(referenceProfile, null, 2)}` : ""}

Return the canonical design contract as JSON. Use this shape:
${SPEC_SHAPE}

Rules:
- Every field binding must reference a table and field that exist in the model profile.
- Prefer measures for KPI cards and aggregation; use columns for categories and tables.
- Return exactly ${pageCount} page(s) in "pages". Do not collapse the request to one page.
- Each page may have up to 8 placements. Use a clear header, KPI zone, analysis zone, and detail zone.
- Use native visuals from the allowed list; pair category columns with measures, and use matrix/table for detail.
- Optional page background: set "background" to a color string or an object with color/image/scaling/transparency.
- Keep all text concise and ready for a business report.`;
  return [
    { role: "system", content: systemWithSkill(skillContext) },
    { role: "user", content: user },
  ];
}

export function buildImageMessages(
  config: FlowConfig,
  profile: DataProfile,
  imageCount = 1,
  skillContext?: string,
  contextText?: string,
): LlmMessage[] {
  const count = Math.max(1, imageCount);
  const user = `Analyze the ${count} attached Power BI report or dashboard image(s) and return a JSON object with this shape:
{
  "pages": [{
    "name": "image_1",
    "display_name": "Page 1",
    "canvas": { "width": 1280, "height": 720 },
    "background": { "color": "#F7F9FC" },
    "elements": [{
      "id": "kpi_1",
      "type": "card|bar|column|line|table|matrix|slicer|text|donut|pie|area|scatter|map|kpi|gauge|unknown",
      "bbox": { "x": 0.02, "y": 0.08, "width": 0.2, "height": 0.15 },
      "title": "Revenue",
      "suggestedField": "Total Revenue"
    }],
    "palette": ["#2E86AB"]
  }]
}

Use normalized coordinates from 0 to 1. ${count > 1 ? "Each attached image may represent a different page, or several images may be panels of one page; infer the structure from the images and the brief. Return one page per distinct dashboard page." : "Detect the page structure, visual types, titles, and approximate positions."}
Then include a "design_contract" property shaped like the canonical design contract. Its pages must match the analyzed pages.
Model profile:
${profileSummary(profile)}

User brief: ${config.textBrief ?? "Recreate the layout and intent of the attached image(s)."}
${contextBlock(contextText)}
Return only JSON.`;
  return [
    { role: "system", content: systemWithSkill(skillContext) },
    { role: "user", content: user },
  ];
}

export function buildReferenceMessages(
  config: FlowConfig,
  profile: DataProfile,
  referenceProfile: unknown,
  skillContext?: string,
  contextText?: string,
): LlmMessage[] {
  const pageCount = Math.max(1, Math.min(8, Math.round(config.pageCount ?? 1)));
  const user = `Adapt the reference report into a new report on the new model.
Return exactly ${pageCount} page(s), or preserve the reference page count when the brief does not specify one.

Reference profile:
${JSON.stringify(referenceProfile, null, 2)}

New model profile:
${profileSummary(profile)}

User brief: ${config.textBrief ?? "Reuse the reference layout and visual hierarchy, with the new model's fields."}
${contextBlock(contextText)}

Return the canonical design contract JSON. Include a field mapping rationale in "summary". Only bind fields that exist in the new model.
Use the reference's page size, typography, and visual placement patterns where practical.`;
  return [
    { role: "system", content: systemWithSkill(skillContext) },
    { role: "user", content: user },
  ];
}

export function buildMeasureMessages(model: ModelSpec, profile: DataProfile, skillContext?: string): LlmMessage[] {
  const user = `Generate useful DAX measures for this Power BI semantic model.
Return JSON: { "measures": [{ "table": "...", "name": "...", "expression": "...", "formatString": "..." }] }.
Only use tables and columns present in the model. Use single quotes around table names and brackets around column names.
Do not use time intelligence unless a date table is present. Keep names short and business-friendly.
Model:
${JSON.stringify(
    model.tables.map((table) => ({
      name: table.name,
      columns: table.columns.map((column) => ({ name: column.name, type: column.type })),
      existingMeasures: table.measures.map((measure) => measure.name),
    })),
    null,
    2,
  )}
Data source: ${profile.sourceLabel}`;
  return [
    { role: "system", content: systemWithSkill(skillContext) },
    { role: "user", content: user },
  ];
}

export function buildRepairMessages(errors: string[], specText: string, skillContext?: string): LlmMessage[] {
  const user = `The Power BI PBIR validator reported these errors:
${errors.map((error) => `- ${error}`).join("\n")}

Current design contract:
${specText}

Return a corrected canonical design contract JSON. Preserve the user's intent. Only change what is needed to fix the errors.`;
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }
    throw new Error("The model response did not contain a JSON object.");
  }
}
