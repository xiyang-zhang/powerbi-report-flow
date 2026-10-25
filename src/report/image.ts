import type { DataProfile, FieldBinding, PageSpec, PlacementSpec, ReportSpec, VisualKind } from "../core/types";
import { isRecord } from "../core/util";
import { defaultReportSpec, parseReportSpecText } from "./spec";

interface ImageElement {
  id?: string;
  type?: string;
  bbox?: { x?: number; y?: number; width?: number; height?: number };
  title?: string;
  suggestedField?: string;
}

export interface ImageLayout {
  canvas?: { width?: number; height?: number };
  elements?: ImageElement[];
  palette?: string[];
  design_contract?: unknown;
}

function asKind(type: string | undefined): VisualKind {
  switch ((type ?? "").toLowerCase()) {
    case "card":
    case "kpi":
      return "cardVisual";
    case "bar":
      return "clusteredBarChart";
    case "column":
      return "clusteredColumnChart";
    case "line":
      return "lineChart";
    case "table":
    case "matrix":
      return "tableEx";
    case "slicer":
      return "slicer";
    case "text":
    case "title":
      return "textbox";
    default:
      return "textbox";
  }
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
  if (kind === "cardVisual") {
    const measures = table.measures.filter((measure) => !/Row Count/.test(measure.name)).slice(0, 3);
    return measures.map((measure) => ({ table: table.name, field: measure.name, kind: "measure" as const }));
  }
  if (kind === "tableEx" || kind === "pivotTable") {
    return table.columns
      .filter((column) => !column.isHidden)
      .slice(0, 5)
      .map((column) => ({ table: table.name, field: column.name, kind: "column" as const }));
  }
  if (kind === "slicer") {
    const column = table.columns.find((candidate) => candidate.type === "string") ?? table.columns[0];
    return column ? [{ table: table.name, field: column.name, kind: "column" }] : [];
  }
  const category = table.columns.find((column) => column.type === "string" && !column.isKey) ?? table.columns[0];
  const measure = table.measures.find((candidate) => !/Row Count/.test(candidate.name));
  return [
    ...(category ? [{ table: table.name, field: category.name, kind: "column" as const }] : []),
    ...(measure ? [{ table: table.name, field: measure.name, kind: "measure" as const }] : []),
  ];
}

export function specFromImageLayout(
  layout: ImageLayout,
  profile: DataProfile,
  options: { title?: string; tone?: string; brief?: string } = {},
): ReportSpec {
  if (layout.design_contract) {
    try {
      return parseReportSpecText(JSON.stringify(layout.design_contract));
    } catch {
      // Fall back to bbox translation below.
    }
  }

  const base = defaultReportSpec(profile, { title: options.title, tone: options.tone });
  const canvas = {
    width: Math.max(320, Math.round(layout.canvas?.width ?? base.pages[0]?.canvas.width ?? 1280)),
    height: Math.max(240, Math.round(layout.canvas?.height ?? base.pages[0]?.canvas.height ?? 720)),
  };
  const palette = layout.palette?.filter((color) => typeof color === "string") ?? Object.values(base.colorMap);
  const placements: PlacementSpec[] = [];
  const regions: Record<string, [number, number, number, number]> = {};

  for (const [index, element] of (layout.elements ?? []).entries()) {
    const kind = asKind(element.type);
    const id = element.id?.replace(/[^A-Za-z0-9_]/g, "_") || `element_${index + 1}`;
    const bbox = element.bbox ?? {};
    const x = Math.round((bbox.x ?? 0.02) * canvas.width);
    const y = Math.round((bbox.y ?? 0.02) * canvas.height);
    const width = Math.round((bbox.width ?? 0.25) * canvas.width);
    const height = Math.round((bbox.height ?? 0.15) * canvas.height);
    let bindings: FieldBinding[] = [];
    if (kind === "cardVisual") {
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
      color: palette[index % Math.max(1, palette.length)],
      position: { x, y, width: Math.max(48, width), height: Math.max(32, height) },
    });
  }

  if (placements.length === 0) {
    return base;
  }

  const page: PageSpec = {
    name: "image",
    displayName: "Image layout",
    role: "overview",
    canvas,
    regions,
    placements,
    background: "#F7F9FC",
  };

  return {
    ...base,
    pages: [page],
    reportMode: "image",
    title: options.title ?? base.title,
    summary: options.brief
      ? `Reconstructed from an image. ${options.brief}`
      : "Reconstructed from an image layout. Field mappings are proposals and should be reviewed.",
    colorMap: Object.fromEntries(
      placements
        .flatMap((placement) => placement.fieldBindings)
        .filter((binding) => binding.kind === "measure")
        .map((binding, index) => [binding.field, palette[index % Math.max(1, palette.length)] ?? "#2E86AB"]),
    ),
  };
}

export function isImageLayout(value: unknown): value is ImageLayout {
  return isRecord(value) && (Array.isArray(value.elements) || isRecord(value.design_contract));
}
