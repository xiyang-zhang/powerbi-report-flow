import type { DataProfile, FieldBinding, PageBackgroundSpec, PageSpec, PlacementSpec, ReportSpec, VisualKind } from "../core/types";
import { isRecord } from "../core/util";
import { defaultReportSpec, parseReportSpecText } from "./spec";
import { NATIVE_VISUAL_KINDS, visualFamily } from "./visualCatalog";

interface ImageElement {
  id?: string;
  type?: string;
  bbox?: { x?: number; y?: number; width?: number; height?: number };
  title?: string;
  suggestedField?: string;
}

export interface ImageLayout {
  name?: string;
  display_name?: string;
  canvas?: { width?: number; height?: number };
  background?: string | PageBackgroundSpec;
  elements?: ImageElement[];
  pages?: ImageLayout[];
  palette?: string[];
  design_contract?: unknown;
}

const VISUAL_ALIASES: Record<string, string> = {
  card: "card",
  kpi: "kpi",
  gauge: "gauge",
  bar: "clusteredBarChart",
  column: "clusteredColumnChart",
  line: "lineChart",
  area: "areaChart",
  donut: "donutChart",
  pie: "pieChart",
  scatter: "scatterChart",
  funnel: "funnel",
  waterfall: "waterfallChart",
  ribbon: "ribbonChart",
  treemap: "treemap",
  map: "map",
  table: "tableEx",
  matrix: "matrix",
  pivot: "pivotTable",
  slicer: "slicer",
  text: "textbox",
  title: "textbox",
  shape: "shape",
  image: "image",
};

function asKind(type: string | undefined): VisualKind {
  const normalized = (type ?? "").trim();
  const mapped = VISUAL_ALIASES[normalized.toLowerCase()];
  if (mapped) return mapped;
  if ((NATIVE_VISUAL_KINDS as readonly string[]).includes(normalized)) return normalized;
  return "textbox";
}

function findBinding(profile: DataProfile, fieldName: string | undefined, kind: "column" | "measure"): FieldBinding | undefined {
  if (!fieldName) return undefined;
  const cleaned = fieldName.replace(/^[^.]*\./, "").replace(/[\[\]]/g, "");
  for (const table of profile.tables) {
    const measure = table.measures.find((candidate) => candidate.name.toLowerCase() === cleaned.toLowerCase());
    if (measure && kind === "measure") return { table: table.name, field: measure.name, kind: "measure" };
    const column = table.columns.find((candidate) => candidate.name.toLowerCase() === cleaned.toLowerCase());
    if (column && kind === "column") return { table: table.name, field: column.name, kind: "column" };
  }
  return undefined;
}

function defaultBindings(profile: DataProfile, kind: VisualKind): FieldBinding[] {
  const table = profile.tables[0];
  if (!table) return [];
  const family = visualFamily(kind);
  if (family === "none" || kind === "textbox" || kind === "text") return [];
  if (family === "card") {
    const measures = table.measures.filter((measure) => !/Row Count/.test(measure.name)).slice(0, 3);
    return measures.map((measure) => ({ table: table.name, field: measure.name, kind: "measure" as const }));
  }
  if (family === "table" || family === "matrix" || family === "slicer") {
    return table.columns
      .filter((column) => !column.isHidden)
      .slice(0, family === "slicer" ? 1 : 5)
      .map((column) => ({ table: table.name, field: column.name, kind: "column" as const }));
  }
  if (family === "kpi") {
    const measure = table.measures.find((candidate) => !/Row Count/.test(candidate.name));
    const date = table.columns.find((column) => column.type === "date" || column.type === "dateTime");
    return [
      ...(measure ? [{ table: table.name, field: measure.name, kind: "measure" as const }] : []),
      ...(date ? [{ table: table.name, field: date.name, kind: "column" as const }] : []),
    ];
  }
  const category = table.columns.find((column) => column.type === "string" && !column.isKey) ?? table.columns[0];
  const measure = table.measures.find((candidate) => !/Row Count/.test(candidate.name));
  return [
    ...(category ? [{ table: table.name, field: category.name, kind: "column" as const }] : []),
    ...(measure ? [{ table: table.name, field: measure.name, kind: "measure" as const }] : []),
  ];
}

function pageFromLayout(
  layout: ImageLayout,
  profile: DataProfile,
  index: number,
  options: { title?: string; tone?: string; brief?: string },
  base: ReportSpec,
): PageSpec {
  const canvas = {
    width: Math.max(320, Math.round(layout.canvas?.width ?? 1280)),
    height: Math.max(240, Math.round(layout.canvas?.height ?? 720)),
  };
  const palette = layout.palette?.filter((color) => typeof color === "string") ?? Object.values(base.colorMap);
  const placements: PlacementSpec[] = [];
  const regions: Record<string, [number, number, number, number]> = {};

  for (const [elementIndex, element] of (layout.elements ?? []).entries()) {
    const kind = asKind(element.type);
    const id = element.id?.replace(/[^A-Za-z0-9_]/g, "_") || `element_${elementIndex + 1}`;
    const bbox = element.bbox ?? {};
    const x = Math.round((bbox.x ?? 0.02) * canvas.width);
    const y = Math.round((bbox.y ?? 0.02) * canvas.height);
    const width = Math.round((bbox.width ?? 0.25) * canvas.width);
    const height = Math.round((bbox.height ?? 0.15) * canvas.height);
    let bindings: FieldBinding[] = [];
    if (kind === "card" || kind === "cardVisual") {
      bindings = [findBinding(profile, element.suggestedField, "measure") ?? defaultBindings(profile, kind)[0]].filter(
        (binding): binding is FieldBinding => Boolean(binding),
      );
    } else if (kind === "textbox") {
      bindings = [];
    } else {
      bindings = defaultBindings(profile, kind);
    }
    regions[id] = [1, 1, 1, 1];
    placements.push({
      id,
      region: id,
      kind,
      text: kind === "textbox" ? element.title ?? "" : undefined,
      title: element.title,
      fieldBindings: bindings,
      color: palette[elementIndex % Math.max(1, palette.length)],
      position: { x, y, width: Math.max(48, width), height: Math.max(32, height) },
    });
  }

  return {
    name: layout.name ?? `image_${index + 1}`,
    displayName: layout.display_name ?? `Page ${index + 1}`,
    role: index === 0 ? "overview" : "detail",
    canvas,
    regions,
    placements,
    background: layout.background ?? "#F7F9FC",
  };
}

function layoutPages(layout: ImageLayout, profile: DataProfile, options: { title?: string; tone?: string; brief?: string }, base: ReportSpec): PageSpec[] {
  if (Array.isArray(layout.pages)) {
    return (layout.pages as ImageLayout[]).map((page, index) => pageFromLayout(page, profile, index, options, base));
  }
  return [pageFromLayout(layout, profile, 0, options, base)];
}

export function specFromImageLayout(
  layout: ImageLayout,
  profile: DataProfile,
  options: { title?: string; tone?: string; brief?: string } = {},
): ReportSpec {
  return specFromImageLayouts([layout], profile, options);
}

export function specFromImageLayouts(
  layouts: ImageLayout[],
  profile: DataProfile,
  options: { title?: string; tone?: string; brief?: string } = {},
): ReportSpec {
  const usable = layouts.filter((layout) => layout && (Array.isArray(layout.elements) || Array.isArray(layout.pages) || isRecord(layout.design_contract)));
  for (const layout of usable) {
    if (layout.design_contract) {
      try {
        return parseReportSpecText(JSON.stringify(layout.design_contract));
      } catch {
        // Fall back to bbox translation below.
      }
    }
  }

  const base = defaultReportSpec(profile, { title: options.title, tone: options.tone, pageCount: Math.max(1, usable.length) });
  const pages = usable.flatMap((layout, index) => layoutPages(layout, profile, options, base));
  if (pages.length === 0) return base;

  const palette = pages.flatMap((page) => page.placements.map((placement) => placement.color).filter(Boolean)) as string[];
  return {
    ...base,
    pages,
    reportMode: "image",
    title: options.title ?? base.title,
    summary: options.brief
      ? `Reconstructed from ${pages.length} page image(s). ${options.brief}`
      : `Reconstructed from ${pages.length} page image(s). Field mappings are proposals and should be reviewed.`,
    colorMap: Object.fromEntries(
      pages
        .flatMap((page) => page.placements)
        .flatMap((placement) => placement.fieldBindings)
        .filter((binding) => binding.kind === "measure")
        .map((binding, index) => [binding.field, palette[index % Math.max(1, palette.length)] ?? "#2E86AB"]),
    ),
  };
}

export function isImageLayout(value: unknown): value is ImageLayout {
  return isRecord(value) && (Array.isArray(value.elements) || Array.isArray(value.pages) || isRecord(value.design_contract));
}

export function isImageLayouts(value: unknown): value is { pages: ImageLayout[]; design_contract?: unknown } {
  if (!isRecord(value)) return false;
  if (Array.isArray(value.pages)) return true;
  return isImageLayout(value);
}

export function layoutsFromResponse(value: unknown): ImageLayout[] {
  if (Array.isArray(value)) return value.filter(isImageLayout);
  if (!isRecord(value)) return [];
  if (Array.isArray(value.pages)) return value.pages.filter(isImageLayout);
  return isImageLayout(value) ? [value] : [];
}
