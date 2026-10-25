import { createHash } from "node:crypto";
import type { FieldBinding, PageSpec, PlacementSpec, ReportSpec, TableSpec } from "../core/types";
import { clampRect, type Rect } from "./layout";
import { isQuerylessVisual, visualFamily } from "./visualCatalog";

const VISUAL_SCHEMA = "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.9.0/schema.json";

function visualName(kind: string, placementId: string): string {
  const digest = createHash("sha1").update(`${kind}:${placementId}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 16);
  return `v${digest}`;
}

function sourceRef(table: string): { SourceRef: { Entity: string } } {
  return { SourceRef: { Entity: table } };
}

function projection(binding: FieldBinding, table: TableSpec | undefined) {
  const column = table?.columns.find((candidate) => candidate.name === binding.field);
  const measure = table?.measures.find((candidate) => candidate.name === binding.field);
  if (binding.kind === "measure" || measure) {
    return {
      field: { Measure: { Expression: sourceRef(binding.table), Property: binding.field } },
      queryRef: `${binding.table}.${binding.field}`,
      nativeQueryRef: binding.field,
    };
  }
  if (binding.kind === "aggregation" || (!column && binding.aggregation)) {
    const aggregation = binding.aggregation ?? "sum";
    const functionNumber =
      aggregation === "average" ? 1 : aggregation === "count" ? 2 : aggregation === "min" ? 3 : aggregation === "max" ? 4 : 0;
    return {
      field: {
        Aggregation: {
          Expression: { Column: { Expression: sourceRef(binding.table), Property: binding.field } },
          Function: functionNumber,
        },
      },
      queryRef: `${aggregation}(${binding.table}.${binding.field})`,
      nativeQueryRef: `${aggregation} of ${binding.field}`,
    };
  }
  return {
    field: { Column: { Expression: sourceRef(binding.table), Property: binding.field } },
    queryRef: `${binding.table}.${binding.field}`,
    nativeQueryRef: binding.field,
  };
}

function projections(bindings: FieldBinding[], table: TableSpec | undefined) {
  return bindings.map((binding) => projection(binding, table));
}

function columnBindings(bindings: FieldBinding[]): FieldBinding[] {
  return bindings.filter((binding) => binding.kind === "column");
}

function valueBindings(bindings: FieldBinding[]): FieldBinding[] {
  return bindings.filter((binding) => binding.kind !== "column");
}

/** Roles used by native visuals; this is the part that decides whether a visual renders or is blank. */
function queryState(kind: string, bindings: FieldBinding[], table: TableSpec | undefined): Record<string, unknown> {
  const family = visualFamily(kind);
  const columns = columnBindings(bindings);
  const values = valueBindings(bindings);
  const explicitRoles = bindings.filter((binding) => Boolean(binding.role));
  const state: Record<string, unknown> = {};

  if (explicitRoles.length > 0) {
    for (const binding of explicitRoles) {
      const role = binding.role!;
      state[role] = { projections: [...((state[role] as { projections: unknown[] } | undefined)?.projections ?? []), projection(binding, table)] };
    }
    return state;
  }

  const set = (role: string, bound: FieldBinding[]) => {
    if (bound.length > 0) state[role] = { projections: projections(bound, table) };
  };

  switch (family) {
    case "none":
      return {};
    case "card":
      if (kind === "multiRowCard") set("Values", bindings);
      else set("Data", bindings.slice(0, 1));
      return state;
    case "kpi":
      set("Indicator", values.slice(0, 1));
      set("Trend", columns.slice(0, 1));
      set("Goal", values.slice(1, 2));
      return state;
    case "gauge":
      set("Y", values.slice(0, 1));
      set("Target", values.slice(1, 2));
      if (values.length === 0) set("Y", bindings.slice(0, 1));
      return state;
    case "table":
      set("Values", bindings);
      return state;
    case "matrix":
      set("Rows", columns);
      set("Values", values.length > 0 ? values : columns);
      return state;
    case "slicer":
      set("Values", bindings.slice(0, 1));
      return state;
    case "scatter":
      set("Category", columns.slice(0, 1));
      set("X", values.slice(0, 1));
      set("Y", values.slice(1, 2));
      set("Size", values.slice(2, 3));
      return state;
    case "map":
      set("Category", columns.slice(0, 1));
      set("Size", values.slice(0, 1));
      set("Latitude", columns.slice(1, 2));
      set("Longitude", columns.slice(2, 3));
      return state;
    case "tree":
      set("Group", columns.slice(0, 2));
      set("Values", values.slice(0, 1));
      return state;
    case "influencer":
      set("Analyze", values.slice(0, 1));
      set("ExplainBy", columns);
      return state;
    case "chart":
    default: {
      if (["pieChart", "donutChart", "funnel", "waterfallChart"].includes(kind)) {
        set("Category", columns.slice(0, 1));
        set("Y", values.slice(0, 1));
        return state;
      }
      if (kind === "treemap") {
        set("Group", columns.slice(0, 2));
        set("Values", values.slice(0, 1));
        return state;
      }
      if (kind === "comboChart" || kind === "lineClusteredColumnComboChart" || kind === "lineStackedColumnComboChart") {
        set("Category", columns.slice(0, 1));
        set("Y", values.slice(0, 1));
        set("Y2", values.slice(1));
        return state;
      }
      if (kind === "ribbonChart") {
        set("Category", columns.slice(0, 1));
        set("Series", columns.slice(1, 2));
        set("Y", values.slice(0, 1));
        return state;
      }
      set("Category", columns.slice(0, 1));
      set("Series", columns.slice(1, 2));
      set("Y", values.length > 0 ? values : columns.slice(1, 2));
      return state;
    }
  }
}

function container(rect: Rect, kind: string, placementId: string, visual: Record<string, unknown>) {
  const visualType = kind === "card" ? "cardVisual" : kind;
  return {
    $schema: VISUAL_SCHEMA,
    name: visualName(kind, placementId),
    position: { x: rect.x, y: rect.y, z: 1000, height: rect.height, width: rect.width, tabOrder: 1000 },
    visual: {
      visualType,
      ...visual,
    },
  };
}

function cardVisual(rect: Rect, kind: string, bindings: FieldBinding[], table: TableSpec | undefined, color: string | undefined, placementId: string) {
  const fontSize = Math.max(16, Math.min(48, Math.round(rect.height * 0.3)));
  return container(rect, kind, placementId, {
    query: { queryState: queryState(kind, bindings, table) },
    objects: {
      value: [
        {
          properties: {
            fontSize: { expr: { Literal: { Value: `${fontSize}D` } } },
            ...(color ? { fontColor: { solid: { color: { expr: { Literal: { Value: `'${color}'` } } } } } } : {}),
          },
          selector: { id: "default" },
        },
      ],
      label: [
        {
          properties: { fontSize: { expr: { Literal: { Value: "12D" } } } },
          selector: { id: "default" },
        },
      ],
    },
  });
}

function chartVisual(rect: Rect, kind: string, bindings: FieldBinding[], table: TableSpec | undefined, color: string | undefined, placementId: string) {
  return container(rect, kind, placementId, {
    query: { queryState: queryState(kind, bindings, table) },
    ...(color
      ? {
          objects: {
            dataPoint: [
              {
                properties: { fill: { solid: { color: { expr: { Literal: { Value: `'${color}'` } } } } } },
                selector: { id: "default" },
              },
            ],
          },
        }
      : {}),
  });
}

function tableVisual(rect: Rect, kind: string, bindings: FieldBinding[], table: TableSpec | undefined, placementId: string) {
  const visual = container(rect, kind, placementId, {
    query: { queryState: queryState(kind, bindings, table) },
  });
  if (kind === "tableEx") {
    (visual.visual as Record<string, unknown>).objects = {
      columnHeaders: [
        {
          properties: {
            columnAdjustment: { expr: { Literal: { Value: "'growToFit'" } } },
            autoSizeColumnWidth: { expr: { Literal: { Value: "true" } } },
          },
        },
      ],
    };
  }
  return visual;
}

function textboxVisual(rect: Rect, text: string, pageHeader: boolean, placementId: string, onImageBackground = false) {
  const fontSize = pageHeader ? Math.max(20, Math.min(44, Math.round(rect.height * 0.5))) : 14;
  const textColor = pageHeader && onImageBackground ? "#FFFFFF" : pageHeader ? "#1F2937" : "#374151";
  return container(rect, "textbox", placementId, {
    objects: {
      general: [
        {
          properties: {
            paragraphs: [
              {
                textRuns: [
                  {
                    value: text,
                    textStyle: {
                      fontFamily: "Segoe UI Semibold",
                      fontSize: `${fontSize}px`,
                      color: textColor,
                    },
                  },
                ],
                horizontalTextAlignment: "left",
              },
            ],
          },
        },
      ],
    },
    visualContainerObjects: {
      background: [
        {
          properties: {
            show: { expr: { Literal: { Value: onImageBackground ? "true" : "false" } } },
            ...(onImageBackground
              ? {
                  color: { solid: { color: { expr: { Literal: { Value: "'#0B1F33'" } } } } },
                  transparency: { expr: { Literal: { Value: "35D" } } },
                }
              : {}),
          },
        },
      ],
      border: [{ properties: { show: { expr: { Literal: { Value: "false" } } } } }],
      padding: [
        {
          properties: {
            top: { expr: { Literal: { Value: "0D" } } },
            bottom: { expr: { Literal: { Value: "0D" } } },
            left: { expr: { Literal: { Value: "0D" } } },
            right: { expr: { Literal: { Value: "0D" } } },
          },
        },
      ],
    },
  });
}

/** Queryless native visuals keep their real visualType; PBIR accepts a container without a query. */
function decorativeVisual(rect: Rect, kind: string, text: string, color: string | undefined, placementId: string) {
  const visual = container(rect, kind, placementId, {}) as Record<string, unknown> & { visual: Record<string, unknown> };
  if (kind === "textbox") {
    visual.visual.visualType = "textbox";
    visual.visual.objects = {
      general: [
        {
          properties: {
            paragraphs: [
              {
                textRuns: [
                  {
                    value: text,
                    textStyle: { fontFamily: "Segoe UI Semibold", fontSize: "14px", color: color ?? "#374151" },
                  },
                ],
              },
            ],
          },
        },
      ],
    };
  }
  return visual;
}

export function buildVisualJson(
  spec: ReportSpec,
  page: PageSpec,
  placement: PlacementSpec,
  rect: Rect,
  modelTables: TableSpec[],
): Record<string, unknown> {
  const table = modelTables.find((candidate) => candidate.name === placement.fieldBindings[0]?.table) ?? modelTables[0];
  const safeRect = clampRect(rect, page.canvas);
  const color = placement.color ?? Object.values(spec.colorMap)[0];
  const kind = placement.kind;
  const family = visualFamily(kind);
  const onImageBackground = typeof page.background === "object";

  if (isQuerylessVisual(kind)) {
    if (kind === "textbox" || kind === "text") {
      return textboxVisual(safeRect, placement.text ?? placement.title ?? "", placement.id === "title", placement.id, onImageBackground);
    }
    return decorativeVisual(safeRect, kind, placement.text ?? placement.title ?? "", color, placement.id);
  }
  if (family === "card") return cardVisual(safeRect, kind, placement.fieldBindings, table, color, placement.id);
  if (family === "table" || family === "matrix") return tableVisual(safeRect, kind, placement.fieldBindings, table, placement.id);
  if (family === "slicer") return chartVisual(safeRect, kind, placement.fieldBindings, table, undefined, placement.id);
  if (family === "chart" || family === "scatter" || family === "map" || family === "tree" || family === "influencer" || family === "kpi" || family === "gauge") {
    return chartVisual(safeRect, kind, placement.fieldBindings, table, color, placement.id);
  }
  return chartVisual(safeRect, kind, placement.fieldBindings, table, color, placement.id);
}
