import type { DataProfile, FlowConfig, ReportSpec } from "../core/types";
import type { LlmProvider } from "../llm/provider";
import { buildImageMessages, buildReferenceMessages, buildSpecMessages, extractJson } from "../llm/prompts";
import type { ReferenceProfile } from "./existing";
import { isImageLayout, specFromImageLayout, type ImageLayout } from "./image";
import { defaultReportSpec, parseReportSpecText } from "./spec";

export interface SpecGenerationResult {
  spec: ReportSpec;
  warnings: string[];
  usedLlm: boolean;
}

function augment(spec: ReportSpec, config: FlowConfig, profile: DataProfile): ReportSpec {
  return {
    ...spec,
    sourceMode: profile.sourceMode,
    reportMode: config.reportMode,
    title: spec.title || `${profile.tables[0]?.name ?? "Power BI"} Overview`,
    pages: spec.pages.map((page) => ({
      ...page,
      background: page.background ?? "#F7F9FC",
      placements: page.placements.map((placement) => ({
        ...placement,
        fieldBindings: placement.fieldBindings ?? [],
      })),
    })),
  };
}

export async function generateReportSpec(input: {
  config: FlowConfig;
  profile: DataProfile;
  llm?: LlmProvider;
  referenceProfile?: ReferenceProfile;
  image?: { data: Uint8Array; mimeType: "image/png" | "image/jpeg" | "image/webp" };
  skillContext?: string;
}): Promise<SpecGenerationResult> {
  const { config, profile, llm, referenceProfile, image, skillContext } = input;
  const warnings: string[] = [];
  const fallback = (reason: string): SpecGenerationResult => {
    warnings.push(reason);
    return { spec: augment(defaultReportSpec(profile, { title: config.projectName, tone: config.tone, audience: config.audience }), config, profile), warnings, usedLlm: false };
  };

  if (!llm) return fallback("No LLM provider is available; generated a conservative default layout.");

  try {
    if (config.reportMode === "image") {
      if (!image) return fallback("Image report mode needs an image file.");
      const messages = buildImageMessages(config, profile, skillContext);
      const text = await llm.complete({ messages, image, json: true, model: undefined });
      const layout = extractJson(text);
      if (!isImageLayout(layout)) return fallback("The vision model did not return a recognized image layout.");
      const spec = augment(specFromImageLayout(layout as ImageLayout, profile, { title: config.projectName, tone: config.tone, brief: config.textBrief }), config, profile);
      return { spec, warnings, usedLlm: true };
    }

    if (config.reportMode === "existing") {
      if (!referenceProfile) return fallback("Reference report mode needs an extracted reference profile.");
      const messages = buildReferenceMessages(config, profile, referenceProfile, skillContext);
      const text = await llm.complete({ messages, json: true });
      const spec = augment(parseReportSpecText(text), config, profile);
      return { spec, warnings, usedLlm: true };
    }

    const messages = buildSpecMessages(config, profile, undefined, skillContext);
    const text = await llm.complete({ messages, json: true });
    const spec = augment(parseReportSpecText(text), config, profile);
    return { spec, warnings, usedLlm: true };
  } catch (error) {
    return fallback(
      `LLM design generation failed (${error instanceof Error ? error.message : String(error)}); generated a conservative default layout instead.`,
    );
  }
}

export async function generateMeasures(
  llm: LlmProvider | undefined,
  profile: DataProfile,
  modelTables: DataProfile["tables"],
  skillContext?: string,
): Promise<{ measures: Array<{ table: string; name: string; expression: string; formatString?: string }>; warning?: string }> {
  if (!llm) return { measures: [] };
  const { buildMeasureMessages } = await import("../llm/prompts");
  try {
    const text = await llm.complete({
      messages: buildMeasureMessages({ name: "Model", tables: modelTables, relationships: profile.relationships, parameters: [] }, profile, skillContext),
      json: true,
    });
    const parsed = extractJson(text) as { measures?: unknown };
    if (!Array.isArray(parsed.measures)) return { measures: [], warning: "The LLM did not return a measures array." };
    return {
      measures: parsed.measures
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((item) => ({
          table: String(item.table ?? ""),
          name: String(item.name ?? ""),
          expression: String(item.expression ?? ""),
          formatString: item.formatString ? String(item.formatString) : undefined,
        }))
        .filter((item) => item.table && item.name && item.expression),
    };
  } catch (error) {
    return { measures: [], warning: `Measure generation failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
