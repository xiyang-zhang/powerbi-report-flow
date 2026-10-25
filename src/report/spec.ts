import yaml from "js-yaml";
import type {
  BackgroundScaling,
  DataProfile,
  FieldBinding,
  MeasureSpec,
  PageBackgroundSpec,
  PageSpec,
  PlacementSpec,
  ReportSpec,
  TableSpec,
} from "../core/types";
import { parseReportSpec } from "../core/schemas";
import { clamp, isRecord } from "../core/util";

const PALETTE = ["#2E86AB", "#E6553A", "#2A9D8F", "#E9C46A", "#8E6C88", "#F4A261"];

function primaryTable(profile: DataProfile): TableSpec {
  const table = profile.tables.find((candidate) => candidate.measures.some((measure) => !/Row Count/.test(measure.name)));
  return table ?? profile.tables[0]!;
}

function numericMeasures(table: TableSpec): MeasureSpec[] {
  return table.measures.filter((measure) => !/Row Count/.test(measure.name)).slice(0, 4);
}

function categoryColumn(table: TableSpec): TableSpec["columns"][number] | undefined {
  return (
    table.columns.find((column) => column.type === "string" && !column.isKey) ??
    table.columns.find((column) => column.type === "string") ??
    table.columns[0]
  );
}

function titleFor(profile: DataProfile, fallback?: string): string {
  if (fallback && fallback.trim()) return fallback.trim();
  return `${profile.tables[0]?.name ?? "Power BI"} Overview`;
}

export function defaultReportSpec(
  profile: DataProfile,
  options: { title?: string; audience?: string; tone?: string; pageCount?: number } = {},
): ReportSpec {
  const table = primaryTable(profile);
  const measures = numericMeasures(table);
  const category = categoryColumn(table);
  const categories = table.columns.filter((column) => column.type === "string" && !column.isKey);
  const dateColumn = table.columns.find((column) => column.type === "date" || column.type === "dateTime");
  const title = titleFor(profile, options.title);
  const cards = measures.length > 0 ? measures : table.measures.slice(0, 1);
  const colorMap = Object.fromEntries(cards.map((measure, index) => [measure.name, PALETTE[index % PALETTE.length]!]));
  const pageCount = clamp(Math.round(options.pageCount ?? 1), 1, 8);
  const detailBindings: FieldBinding[] = table.columns
    .filter((column) => !column.isHidden)
    .slice(0, 6)
    .map((column) => ({ table: table.name, field: column.name, kind: "column" as const }));

  const overviewPlacements: PlacementSpec[] = [
    {
      id: "title",
      region: "header",
      kind: "textbox",
      text: title,
      fieldBindings: [],
    },
    ...cards.map((measure, index): PlacementSpec => {
      const gap = 8;
      const width = (1280 - 48 - gap * (cards.length - 1)) / cards.length;
      return {
        id: `kpi_${index + 1}`,
        region: "kpis",
        kind: "card",
        title: measure.name,
        fieldBindings: [{ table: table.name, field: measure.name, kind: "measure" }],
        position: { x: Math.round(24 + index * (width + gap)), y: 96, width: Math.round(width), height: 88 },
      };
    }),
    ...(category && measures[0]
      ? [
          {
            id: "trend",
            region: "chart",
            kind: "clusteredBarChart",
            title: `${measures[0].name} by ${category.name}`,
            fieldBindings: [
              { table: table.name, field: category.name, kind: "column" as const },
              { table: table.name, field: measures[0].name, kind: "measure" as const },
            ],
          },
        ]
      : []),
    ...(detailBindings.length > 0
      ? [{ id: "detail", region: "detail", kind: "tableEx", title: "Detail", fieldBindings: detailBindings }]
      : []),
  ];

  const pages: PageSpec[] = [
    {
      name: "overview",
      displayName: "Overview",
      role: "overview",
      canvas: { width: 1280, height: 720 },
      regions: {
        header: [1, 1, 12, 2],
        kpis: [1, 3, 12, 5],
        chart: [1, 6, 8, 12],
        detail: [9, 6, 12, 12],
      },
      placements: overviewPlacements,
      background: "#F7F9FC",
    },
  ];

  if (pageCount > 1) {
    const breakdownPrimary = categories[0] ?? category;
    const breakdownSecondary = categories[1] ?? categories[0] ?? category;
    pages.push({
      name: "breakdown",
      displayName: "Breakdown",
      role: "breakdown",
      canvas: { width: 1280, height: 720 },
      regions: {
        header: [1, 1, 12, 2],
        primary: [1, 3, 6, 8],
        secondary: [7, 3, 12, 8],
        detail: [1, 9, 12, 12],
      },
      placements: [
        { id: "title", region: "header", kind: "textbox", text: "Breakdown", fieldBindings: [] },
        ...(breakdownPrimary && measures[0]
          ? [
              {
                id: "primary_breakdown",
                region: "primary",
                kind: "donutChart",
                title: `${measures[0].name} by ${breakdownPrimary.name}`,
                fieldBindings: [
                  { table: table.name, field: breakdownPrimary.name, kind: "column" as const },
                  { table: table.name, field: measures[0].name, kind: "measure" as const },
                ],
              },
            ]
          : []),
        ...(breakdownSecondary && measures[0]
          ? [
              {
                id: "secondary_breakdown",
                region: "secondary",
                kind: "clusteredColumnChart",
                title: `${measures[0].name} by ${breakdownSecondary.name}`,
                fieldBindings: [
                  { table: table.name, field: breakdownSecondary.name, kind: "column" as const },
                  { table: table.name, field: measures[0].name, kind: "measure" as const },
                ],
              },
            ]
          : []),
        ...(detailBindings.length > 0
          ? [{ id: "detail", region: "detail", kind: "tableEx", title: "Supporting detail", fieldBindings: detailBindings }]
          : []),
      ],
      background: "#F7F9FC",
    });
  }

  if (pageCount > 2) {
    const trendCategory = dateColumn ?? category;
    pages.push({
      name: "trend",
      displayName: "Trend",
      role: "trend",
      canvas: { width: 1280, height: 720 },
      regions: {
        header: [1, 1, 12, 2],
        trend: [1, 3, 12, 8],
        detail: [1, 9, 12, 12],
      },
      placements: [
        { id: "title", region: "header", kind: "textbox", text: "Trend", fieldBindings: [] },
        ...(trendCategory && measures[0]
          ? [
              {
                id: "trend_line",
                region: "trend",
                kind: "lineChart",
                title: `${measures[0].name} over ${trendCategory.name}`,
                fieldBindings: [
                  { table: table.name, field: trendCategory.name, kind: "column" as const },
                  ...(categories[0] && categories[0].name !== trendCategory.name
                    ? [{ table: table.name, field: categories[0].name, kind: "column" as const }]
                    : []),
                  { table: table.name, field: measures[0].name, kind: "measure" as const },
                ],
              },
            ]
          : []),
        ...(detailBindings.length > 0
          ? [{ id: "detail", region: "detail", kind: "tableEx", title: "Data", fieldBindings: detailBindings }]
          : []),
      ],
      background: "#F7F9FC",
    });
  }

  for (let index = pages.length; index < pageCount; index += 1) {
    pages.push({
      name: `detail_${index + 1}`,
      displayName: `Detail ${index + 1}`,
      role: "detail",
      canvas: { width: 1280, height: 720 },
      regions: { header: [1, 1, 12, 2], detail: [1, 3, 12, 12] },
      placements: [
        { id: "title", region: "header", kind: "textbox", text: `Detail ${index + 1}`, fieldBindings: [] },
        ...(detailBindings.length > 0
          ? [{ id: "detail", region: "detail", kind: "tableEx", title: "Detail", fieldBindings: detailBindings }]
          : []),
      ],
      background: "#F7F9FC",
    });
  }

  return {
    generatedBy: "powerbi-report-cli",
    contractVersion: 1,
    mode: "greenfield",
    sourceMode: profile.sourceMode,
    reportMode: "text",
    designIdentity: {
      tone: options.tone ?? "clean, executive, high-contrast",
      signature: "headline KPI strip, analysis panels, supporting detail tables",
    },
    colorMap,
    pages: pages.slice(0, pageCount),
    accessibility: {
      altTextStrategy: "headline + trend + structure",
      contrastNotes: "Dark text on light canvas; color pairs checked at authoring time.",
    },
    theme: { base: "CY24SU06" },
    title,
    summary: `A ${pageCount}-page report generated from ${profile.sourceLabel}. ${options.audience ? `Audience: ${options.audience}.` : ""}`.trim(),
  };
}

function normalizePageReference(value: string | number | undefined): string | number | undefined {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  const numbered = /^(?:第\s*)?(?:page\s*)?(\d+)\s*(?:页|page)?\b/i.exec(trimmed);
  if (numbered && /第|页|page/i.test(trimmed)) return Number(numbered[1]);
  return trimmed.replace(/\s*(?:背景图|背景|background(?:\s+image)?)\s*$/i, "").trim() || trimmed;
}

function normalizeBackground(value: unknown): PageBackgroundSpec | undefined {  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed.startsWith("#") || /^(rgb|hsl)a?\(/i.test(trimmed) ? { color: trimmed } : { image: trimmed };
  }
  if (!isRecord(value)) return undefined;
  const background: PageBackgroundSpec = {};
  if (typeof value.color === "string") background.color = value.color;
  if (typeof value.image === "string") background.image = value.image;
  const scaling = String(value.scaling ?? "");
  if (scaling === "Fit" || scaling === "Fill" || scaling === "Tile" || scaling === "Normal") {
    background.scaling = scaling as BackgroundScaling;
  }
  if (typeof value.transparency === "number" && Number.isFinite(value.transparency)) {
    background.transparency = clamp(value.transparency, 0, 100);
  }
  return Object.keys(background).length > 0 ? background : undefined;
}

export function applyBackgroundDeclarations(spec: ReportSpec, text: string | undefined): { spec: ReportSpec; warnings: string[] } {
  if (!text || text.trim().length === 0) return { spec, warnings: [] };
  let parsed: unknown;
  try {
    parsed = yaml.load(text);
  } catch (error) {
    return { spec, warnings: [`Background declarations could not be parsed: ${error instanceof Error ? error.message : String(error)}`] };
  }
  if (parsed === null || parsed === undefined) return { spec, warnings: [] };

  const warnings: string[] = [];
  const entries: Array<{ page?: string | number; background: PageBackgroundSpec }> = [];
  const addEntry = (key: string | number | undefined, value: unknown) => {
    if (typeof value === "string" || isRecord(value)) {
      const background = normalizeBackground(value);
      if (background) entries.push({ page: key, background });
    }
  };

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (!isRecord(item)) continue;
      addEntry(item.page as string | number | undefined, item.background ?? item);
    }
  } else if (isRecord(parsed)) {
    const container = parsed.backgrounds ?? parsed.pages;
    if (Array.isArray(container)) {
      for (const item of container) {
        if (isRecord(item)) addEntry(item.page as string | number | undefined, item.background ?? item);
      }
    } else if (isRecord(container)) {
      for (const [key, value] of Object.entries(container)) addEntry(key, value);
    } else {
      for (const [key, value] of Object.entries(parsed)) {
        if (key === "backgrounds" || key === "pages") continue;
        addEntry(key, value);
      }
    }
  }

  // The sidebar accepts free text as well as YAML. Support simple lines such as
  // "第 1 页背景图: assets/bg.png" or "overview background: #0B1F33".
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^[-*]\s*/, "");
    if (!line || line.startsWith("#")) continue;
    const numbered = /^(?:第\s*)?(?:page\s*)?(\d+)\s*(?:页|page)?\s*(?:背景图|背景|background(?:\s+image)?)\s*[:：=]?\s*(.+)$/i.exec(line);
    const named = numbered
      ? null
      : /^(.+?)\s*(?:页)?\s*(?:背景图|背景|background(?:\s+image)?)\s*[:：=]\s*(.+)$/i.exec(line);
    const match = numbered ?? named;
    if (!match) continue;
    const page = numbered ? Number(match[1]) : match[1]!.trim();
    const value = match[2]!.trim().replace(/^["']|["']$/g, "");
    if (!value) continue;
    const background = normalizeBackground(value);
    if (background) entries.push({ page, background });
  }

  if (entries.length === 0) {
    return { spec, warnings: ["Background declarations were parsed, but no page background entries were found."] };
  }

  const pages = spec.pages.map((page) => ({ ...page }));
  for (const entry of entries) {
    let index = -1;
    const pageRef = normalizePageReference(entry.page);
    if (typeof pageRef === "number") {
      index = pageRef - 1;
    } else if (pageRef) {
      const needle = String(pageRef).toLowerCase();
      index = pages.findIndex(
        (page) => page.name.toLowerCase() === needle || page.displayName.toLowerCase() === needle,
      );
    }
    if (index < 0 || index >= pages.length) {
      warnings.push(`Background declaration references unknown page "${String(entry.page ?? "")}".`);
      continue;
    }
    const page = pages[index]!;
    const existing = typeof page.background === "string" ? { color: page.background } : page.background;
    const merged = { ...(existing ?? {}), ...entry.background };
    // A declaration that supplies an image replaces the default canvas color unless it also names one.
    if (entry.background.image && !entry.background.color) delete merged.color;
    page.background = merged;
  }
  return { spec: { ...spec, pages }, warnings };
}

export function reportSpecToDesignBrief(spec: ReportSpec): string {
  return yaml.dump(
    {
      generated_by: spec.generatedBy,
      contract_version: spec.contractVersion,
      mode: spec.mode,
      source_mode: spec.sourceMode,
      report_mode: spec.reportMode,
      title: spec.title,
      summary: spec.summary,
      design_identity: {
        tone: spec.designIdentity.tone,
        signature: spec.designIdentity.signature,
      },
      color_map: spec.colorMap,
      pages: spec.pages.map((page) => ({
        name: page.name,
        display_name: page.displayName,
        role: page.role,
        canvas: page.canvas,
        layout_contract: {
          regions: page.regions,
          placements: page.placements.map((placement) => ({
            id: placement.id,
            region: placement.region,
            slot: placement.slot,
            of: placement.of,
            kind: placement.kind,
            title: placement.title,
            text: placement.text,
            field_bindings: placement.fieldBindings.map(
              (binding) => `${binding.table}[${binding.field}]${binding.kind === "measure" ? " (measure)" : ""}`,
            ),
            color: placement.color,
            position: placement.position,
          })),
        },
        background: page.background,
      })),
      accessibility: {
        alt_text_strategy: spec.accessibility.altTextStrategy,
        contrast_notes: spec.accessibility.contrastNotes,
      },
      theme: spec.theme,
    },
    { lineWidth: 100, noRefs: true },
  );
}

export function reportSpecToMarkdown(spec: ReportSpec): string {
  const lines = [
    `# ${spec.title}`,
    "",
    spec.summary,
    "",
    "## Canonical design contract",
    "",
    "```yaml",
    reportSpecToDesignBrief(spec).trimEnd(),
    "```",
    "",
    "## Page plan",
    "",
  ];
  for (const page of spec.pages) {
    lines.push(`### ${page.displayName} (${page.name})`, "");
    lines.push(`Canvas: ${page.canvas.width}×${page.canvas.height}; role: ${page.role}`, "");
    lines.push("| Visual | Type | Region | Fields |", "|---|---|---|---|");
    for (const placement of page.placements) {
      lines.push(
        `| ${placement.title ?? placement.id} | ${placement.kind} | ${placement.region} | ${placement.fieldBindings
          .map((binding) => `${binding.table}[${binding.field}]`)
          .join(", ")} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

function normalizeFieldBinding(value: unknown): FieldBinding {
  if (isRecord(value)) {
    return {
      table: String(value.table ?? ""),
      field: String(value.field ?? ""),
      kind: value.kind === "measure" || value.kind === "aggregation" ? value.kind : "column",
      aggregation: value.aggregation as FieldBinding["aggregation"],
      role: value.role ? String(value.role) : undefined,
    };
  }
  const text = String(value ?? "");
  const match = /^([^\[]+)\[([^\]]+)\](?:\s*\((measure)\))?/.exec(text);
  if (match) {
    return { table: match[1]!, field: match[2]!, kind: match[3] ? "measure" : "column" };
  }
  return { table: "", field: text, kind: "column" };
}

export function parseReportSpecText(text: string): ReportSpec {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = yaml.load(text);
  }
  if (!isRecord(parsed)) throw new Error("The design contract must be a JSON/YAML object.");
  const record = parsed as Record<string, unknown>;
  const rawPages = (record.pages ?? []) as unknown[];
  const normalized = {
    generatedBy: record.generatedBy ?? record.generated_by ?? "powerbi-report-cli",
    contractVersion: Number(record.contractVersion ?? record.contract_version ?? 1),
    mode: record.mode ?? "greenfield",
    sourceMode: record.sourceMode ?? record.source_mode ?? "mock",
    reportMode: record.reportMode ?? record.report_mode ?? "text",
    designIdentity: record.designIdentity ?? record.design_identity ?? {
      tone: "clean, executive, high-contrast",
      signature: "KPI strip plus analysis panel",
    },
    colorMap: record.colorMap ?? record.color_map ?? {},
    pages: rawPages.map((pageValue) => {
      const page = pageValue as Record<string, unknown>;
      const contract = (page.layout_contract ?? page.layoutContract ?? {}) as Record<string, unknown>;
      const placements = (contract.placements ?? page.placements ?? []) as unknown[];
      return {
        name: page.name,
        displayName: page.displayName ?? page.display_name ?? page.name,
        role: page.role ?? "overview",
        canvas: page.canvas ?? { width: 1280, height: 720 },
        regions: contract.regions ?? page.regions ?? {},
        placements: placements.map((placementValue) => {
          const placement = placementValue as Record<string, unknown>;
          return {
            ...placement,
            fieldBindings: ((placement.fieldBindings ?? placement.field_bindings ?? []) as unknown[]).map(normalizeFieldBinding),
          };
        }),
        background: page.background,
      };
    }),
    accessibility: {
      altTextStrategy:
        (record.accessibility as Record<string, unknown> | undefined)?.altTextStrategy ??
        (record.accessibility as Record<string, unknown> | undefined)?.alt_text_strategy ??
        "headline + trend",
      contrastNotes:
        (record.accessibility as Record<string, unknown> | undefined)?.contrastNotes ??
        (record.accessibility as Record<string, unknown> | undefined)?.contrast_notes ??
        "Checked at authoring time.",
    },
    theme: record.theme ?? { base: "CY24SU06" },
    title: record.title ?? "Generated report",
    summary: record.summary ?? "Generated from a design contract.",
  };
  return parseReportSpec(normalized);
}
