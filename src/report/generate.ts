import type { DataProfile, FlowConfig, ReportSpec } from "../core/types";
import type { LlmImage, LlmProvider } from "../llm/provider";
import { buildImageMessages, buildReferenceMessages, buildSpecMessages, extractJson } from "../llm/prompts";
import { clamp } from "../core/util";
import type { ReferenceProfile } from "./existing";
import { layoutsFromResponse, specFromImageLayouts } from "./image";
import { applyBackgroundDeclarations, defaultReportSpec, parseReportSpecText } from "./spec";

export interface SpecGenerationResult {
  spec: ReportSpec;
  warnings: string[];
  usedLlm: boolean;
}

function augment(
  spec: ReportSpec,
  config: FlowConfig,
  profile: DataProfile,
  warnings: string[],
  desiredPages: number,
): ReportSpec {
  const withBackground = applyBackgroundDeclarations(spec, config.backgroundYaml);
  warnings.push(...withBackground.warnings);
  const normalized: ReportSpec = {
    ...withBackground.spec,
    sourceMode: profile.sourceMode,
    reportMode: config.reportMode,
    title: withBackground.spec.title || `${profile.tables[0]?.name ?? "Power BI"} Overview`,
    pages: withBackground.spec.pages.map((page) => ({
      ...page,
      background: page.background ?? "#F7F9FC",
      placements: page.placements.map((placement) => ({
        ...placement,
        fieldBindings: placement.fieldBindings ?? [],
      })),
    })),
  };

  if (normalized.pages.length >= desiredPages || desiredPages <= 1) return normalized;
  const extra = defaultReportSpec(profile, {
    title: config.projectName,
    tone: config.tone,
    audience: config.audience,
    pageCount: desiredPages,
  }).pages.slice(normalized.pages.length);
  if (extra.length > 0) {
    warnings.push(
      `The design contract returned ${normalized.pages.length} page(s); added ${extra.length} deterministic page(s) to honor the requested ${desiredPages}.`,
    );
  }
  return { ...normalized, pages: [...normalized.pages, ...extra] };
}

export async function generateReportSpec(input: {
  config: FlowConfig;
  profile: DataProfile;
  llm?: LlmProvider;
  referenceProfile?: ReferenceProfile;
  image?: LlmImage;
  images?: LlmImage[];
  contextText?: string;
  skillContext?: string;
}): Promise<SpecGenerationResult> {
  const { config, profile, llm, referenceProfile, contextText, skillContext } = input;
  const images = input.images ?? (input.image ? [input.image] : []);
  const requestedPages = clamp(Math.round(config.pageCount ?? 1), 1, 8);
  const warnings: string[] = [];
  const desiredPages = config.reportMode === "image" ? Math.max(requestedPages, images.length) : requestedPages;
  const fallback = (reason: string): SpecGenerationResult => {
    warnings.push(reason);
    return {
      spec: augment(
        defaultReportSpec(profile, {
          title: config.projectName,
          tone: config.tone,
          audience: config.audience,
          pageCount: desiredPages,
        }),
        config,
        profile,
        warnings,
        desiredPages,
      ),
      warnings,
      usedLlm: false,
    };
  };

  if (!llm) return fallback("No LLM provider is available; generated a conservative default layout.");

  try {
    if (config.reportMode === "image") {
      if (images.length === 0) return fallback("Image report mode needs at least one image file.");
      const messages = buildImageMessages(config, profile, images.length, skillContext, contextText);
      const text = await llm.complete({ messages, images, json: true, model: undefined });
      const layouts = layoutsFromResponse(extractJson(text));
      if (layouts.length === 0) return fallback("The vision model did not return a recognized image layout.");
      const spec = specFromImageLayouts(layouts, profile, {
        title: config.projectName,
        tone: config.tone,
        brief: config.textBrief,
      });
      return { spec: augment(spec, config, profile, warnings, desiredPages), warnings, usedLlm: true };
    }

    if (config.reportMode === "existing") {
      if (!referenceProfile) return fallback("Reference report mode needs an extracted reference profile.");
      const messages = buildReferenceMessages(config, profile, referenceProfile, skillContext, contextText);
      const text = await llm.complete({ messages, images: images.length > 0 ? images : undefined, json: true });
      const spec = augment(parseReportSpecText(text), config, profile, warnings, desiredPages);
      return { spec, warnings, usedLlm: true };
    }

    const messages = buildSpecMessages(config, profile, undefined, skillContext, contextText);
    const text = await llm.complete({ messages, images: images.length > 0 ? images : undefined, json: true });
    const spec = augment(parseReportSpecText(text), config, profile, warnings, desiredPages);
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
