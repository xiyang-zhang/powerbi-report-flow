import type { DataProfile, FlowConfig, ModelSpec } from "../core/types";
import type { LlmMessage } from "./provider";

export const SYSTEM_PROMPT = `You are the Power BI Report Flow design engine.
You follow the Power BI report skill's rules: one analytical question per visual, accessible contrast,
clear hierarchy, no deprecated visuals (use cardVisual, bar/column/line, tableEx, pivotTable, slicer, textbox),
and a page plan that can be implemented as PBIR.
Return only valid JSON. Do not wrap JSON in markdown fences. Do not invent fields that are not in the model profile.
The canonical design contract uses: generated_by, contract_version, design_identity, color_map, pages[].layout_contract.regions,
pages[].layout_contract.placements, accessibility, and theme.`;

function systemWithSkill(skillContext?: string): string {
  if (!skillContext || skillContext.trim().length === 0) return SYSTEM_PROMPT;
  const excerpt = skillContext.trim().slice(0, 12_000);
  return `${SYSTEM_PROMPT}\n\nOfficial Power BI report skill guidance (authoritative when it conflicts with general habits):\n${excerpt}`;
}

const SPEC_SHAPE = `{
  "generated_by": "powerbi-report-cli",
  "contract_version": 1,
  "mode": "greenfield",
  "design_identity": { "tone": "clean executive", "signature": "KPI strip plus one analysis panel" },
  "color_map": { "<measure name>": "#2E86AB" },
  "pages": [{
    "name": "overview",
    "display_name": "Overview",
    "role": "overview",
    "canvas": { "width": 1280, "height": 720 },
    "layout_contract": {
      "regions": { "header": [1,1,12,2], "kpis": [1,3,12,5], "chart": [1,6,8,12], "detail": [9,6,12,12] },
      "placements": [{
        "id": "title", "region": "header", "kind": "textbox", "text": "Sales Overview", "field_bindings": []
      }, {
        "id": "kpis", "region": "kpis", "kind": "cardVisual",
        "field_bindings": ["Sales[Total Revenue] (measure)"]
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
): LlmMessage[] {
  const brief =
    config.textBrief?.trim() ||
    "Create a clear one-page overview for a business audience. Include headline KPIs, one comparison or trend, and a detail table.";
  const user = `Design a Power BI report.

User brief:
${brief}

Audience: ${config.audience ?? "business stakeholders"}
Tone/brand: ${config.tone ?? "clean, confident, high contrast"}
Requested pages: ${config.pageCount ?? 1}

Data model profile:
${profileSummary(profile)}

${referenceProfile ? `Reference report profile (use it as a style/layout template, but rebind to the new model):\n${JSON.stringify(referenceProfile, null, 2)}` : ""}

Return the canonical design contract as JSON. Use this shape:
${SPEC_SHAPE}

Rules:
- Every field binding must reference a table and field that exist in the model profile.
- Prefer measures for KPI cards and aggregation; use columns for categories and tables.
- Use no more than 6 placements per page.
- For a single-page overview, use the regions header/kpis/chart/detail unless the brief requires another structure.
- Keep all text concise and ready for a business report.`;
  return [
    { role: "system", content: systemWithSkill(skillContext) },
    { role: "user", content: user },
  ];
}

export function buildImageMessages(config: FlowConfig, profile: DataProfile, skillContext?: string): LlmMessage[] {
  const user = `Analyze the attached Power BI report or dashboard image and return a JSON object with this shape:
{
  "canvas": { "width": 1280, "height": 720 },
  "elements": [{
    "id": "kpi_1",
    "type": "card|bar|column|line|table|slicer|text|unknown",
    "bbox": { "x": 0.02, "y": 0.08, "width": 0.2, "height": 0.15 },
    "title": "Revenue",
    "suggestedField": "Total Revenue"
  }],
  "palette": ["#2E86AB"]
}

Use normalized coordinates from 0 to 1. Detect the page structure, visual types, titles, and approximate positions.
Then, in the same JSON object, include a "design_contract" property shaped like the canonical design contract.
Model profile:
${profileSummary(profile)}

User brief: ${config.textBrief ?? "Recreate the layout and intent of the image."}
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
): LlmMessage[] {
  const user = `Adapt the reference report into a new report on the new model.

Reference profile:
${JSON.stringify(referenceProfile, null, 2)}

New model profile:
${profileSummary(profile)}

User brief: ${config.textBrief ?? "Reuse the reference layout and visual hierarchy, with the new model's fields."}

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
