import type { FieldBinding, PageSpec, PlacementSpec, ReportSpec, TableSpec } from "../core/types";
import { shortId } from "../core/util";
import { clampRect, type Rect } from "./layout";

const VISUAL_SCHEMA = "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.9.0/schema.json";

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
    const functionNumber = aggregation === "average" ? 1 : aggregation === "count" ? 2 : aggregation === "min" ? 3 : aggregation === "max" ? 4 : 0;
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

function queryState(bindings: FieldBinding[], table: TableSpec | undefined) {
  const projections = bindings.map((binding) => projection(binding, table));
  return projections;
}

function cardVisual(
  rect: Rect,
  bindings: FieldBinding[],
  table: TableSpec | undefined,
  color: string | undefined,
) {
  const fontSize = Math.max(16, Math.min(48, Math.round(rect.height * 0.3)));
  return {
    $schema: VISUAL_SCHEMA,
    name: shortId(),
    position: { x: rect.x, y: rect.y, z: 1000, height: rect.height, width: rect.width, tabOrder: 1000 },
    visual: {
      visualType: "cardVisual",
      query: { queryState: { Data: { projections: queryState(bindings, table) } } },
      objects: {
        value: [
          {
            properties: {
              fontSize: { expr: { Literal: { Value: `${fontSize}D` } } },
              ...(color
                ? { fontColor: { solid: { color: { expr: { Literal: { Value: `'${color}'` } } } } } }
                : {}),
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
    },
  };
}

function chartVisual(
  kind: PlacementSpec["kind"],
  rect: Rect,
  bindings: FieldBinding[],
  table: TableSpec | undefined,
  color: string | undefined,
) {
  const category = bindings.find((binding) => binding.kind === "column");
  const value = bindings.find((binding) => binding.kind !== "column");
  const state: Record<string, unknown> = {};
  if (category) state.Category = { projections: [projection(category, table)] };
  if (value) state.Y = { projections: [projection(value, table)] };
  return {
    $schema: VISUAL_SCHEMA,
    name: shortId(),
    position: { x: rect.x, y: rect.y, z: 1000, height: rect.height, width: rect.width, tabOrder: 1000 },
    visual: {
      visualType: kind,
      query: { queryState: state },
      ...(color
        ? {
            objects: {
              dataPoint: [
                {
                  properties: {
                    fill: { solid: { color: { expr: { Literal: { Value: `'${color}'` } } } } },
                  },
                  selector: { id: "default" },
                },
              ],
            },
          }
        : {}),
    },
  };
}

function tableVisual(rect: Rect, bindings: FieldBinding[], table: TableSpec | undefined) {
  return {
    $schema: VISUAL_SCHEMA,
    name: shortId(),
    position: { x: rect.x, y: rect.y, z: 1000, height: rect.height, width: rect.width, tabOrder: 1000 },
    visual: {
      visualType: "tableEx",
      query: { queryState: { Values: { projections: queryState(bindings, table) } } },
      objects: {
        columnHeaders: [
          {
            properties: {
              columnAdjustment: { expr: { Literal: { Value: "'growToFit'" } } },
              autoSizeColumnWidth: { expr: { Literal: { Value: "true" } } },
            },
          },
        ],
      },
    },
  };
}

function slicerVisual(rect: Rect, bindings: FieldBinding[], table: TableSpec | undefined) {
  return {
    $schema: VISUAL_SCHEMA,
    name: shortId(),
    position: { x: rect.x, y: rect.y, z: 1000, height: rect.height, width: rect.width, tabOrder: 1000 },
    visual: {
      visualType: "slicer",
      query: { queryState: { Values: { projections: queryState(bindings.slice(0, 1), table) } } },
    },
  };
}

function textboxVisual(rect: Rect, text: string, pageHeader: boolean) {
  const fontSize = pageHeader ? Math.max(20, Math.min(44, Math.round(rect.height * 0.5))) : 14;
  return {
    $schema: VISUAL_SCHEMA,
    name: shortId(),
    position: { x: rect.x, y: rect.y, z: 1000, height: rect.height, width: rect.width, tabOrder: 0 },
    visual: {
      visualType: "textbox",
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
                        color: pageHeader ? "#1F2937" : "#374151",
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
        background: [{ properties: { show: { expr: { Literal: { Value: "false" } } } } }],
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
    },
  };
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
  switch (placement.kind) {
    case "cardVisual":
      return cardVisual(safeRect, placement.fieldBindings, table, color);
    case "barChart":
    case "columnChart":
    case "clusteredBarChart":
    case "clusteredColumnChart":
    case "lineChart":
      return chartVisual(placement.kind, safeRect, placement.fieldBindings, table, color);
    case "tableEx":
    case "pivotTable":
      return tableVisual(safeRect, placement.fieldBindings, table);
    case "slicer":
      return slicerVisual(safeRect, placement.fieldBindings, table);
    case "textbox":
    case "shape":
    default:
      return textboxVisual(safeRect, placement.text ?? placement.title ?? "", placement.id === "title");
  }
}
