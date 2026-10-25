import yaml from "js-yaml";
import type { DataProfile, FieldBinding, MeasureSpec, PageSpec, PlacementSpec, ReportSpec, TableSpec } from "../core/types";
import { parseReportSpec } from "../core/schemas";
import { isRecord } from "../core/util";

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
  const title = titleFor(profile, options.title);
  const cards = measures.length > 0 ? measures : table.measures.slice(0, 1);
  const colorMap = Object.fromEntries(cards.map((measure, index) => [measure.name, PALETTE[index % PALETTE.length]!]));

  const placements: PlacementSpec[] = [
    {
      id: "title",
      region: "header",
      kind: "textbox",
      text: title,
      fieldBindings: [],
    },
    ...(cards.length > 0
      ? [
          {
            id: "kpis",
            region: "kpis",
            kind: "cardVisual" as const,
            title: "Key metrics",
            fieldBindings: cards.map(
              (measure): FieldBinding => ({ table: table.name, field: measure.name, kind: "measure" }),
            ),
          },
        ]
      : []),
    ...(category && measures[0]
      ? [
          {
            id: "trend",
            region: "chart",
            kind: "clusteredBarChart" as const,
            title: `${measures[0].name} by ${category.name}`,
            fieldBindings: [
              { table: table.name, field: category.name, kind: "column" as const },
              { table: table.name, field: measures[0].name, kind: "measure" as const },
            ],
          },
        ]
      : []),
    {
      id: "detail",
      region: "detail",
      kind: "tableEx",
      title: "Detail",
      fieldBindings: table.columns
        .filter((column) => !column.isHidden)
        .slice(0, 5)
        .map((column) => ({ table: table.name, field: column.name, kind: "column" as const })),
    },
  ];

  const page: PageSpec = {
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
    placements,
    background: "#F7F9FC",
  };

  return {
    generatedBy: "powerbi-report-cli",
    contractVersion: 1,
    mode: "greenfield",
    sourceMode: profile.sourceMode,
    reportMode: "text",
    designIdentity: {
      tone: options.tone ?? "clean, executive, high-contrast",
      signature: "large headline KPI strip, one analysis panel, one detail table",
    },
    colorMap,
    pages: [page],
    accessibility: {
      altTextStrategy: "headline + trend + structure",
      contrastNotes: "Dark text on light canvas; color pairs checked at authoring time.",
    },
    theme: { base: "CY24SU06" },
    title,
    summary: `A one-page overview generated from ${profile.sourceLabel}. ${options.audience ? `Audience: ${options.audience}.` : ""}`.trim(),
  };
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
