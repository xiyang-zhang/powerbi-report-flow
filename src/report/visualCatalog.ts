/**
 * A pragmatic catalog of native Power BI visuals that PBIR can target.
 * PBIR does not enforce this list: `visualType` is a string, and Desktop
 * resolves it against the built-in visual registry. Keeping the catalog here
 * gives the design contract and the LLM a useful, stable vocabulary.
 */
export const NATIVE_VISUAL_KINDS = [
  "card",
  "cardVisual",
  "multiRowCard",
  "kpi",
  "gauge",
  "slicer",
  "barChart",
  "clusteredBarChart",
  "columnChart",
  "clusteredColumnChart",
  "hundredPercentStackedBarChart",
  "hundredPercentStackedColumnChart",
  "stackedBarChart",
  "stackedColumnChart",
  "lineChart",
  "areaChart",
  "stackedAreaChart",
  "lineClusteredColumnComboChart",
  "lineStackedColumnComboChart",
  "comboChart",
  "ribbonChart",
  "waterfallChart",
  "funnel",
  "scatterChart",
  "pieChart",
  "donutChart",
  "treemap",
  "map",
  "filledMap",
  "shapeMap",
  "tableEx",
  "matrix",
  "pivotTable",
  "decompositionTreeVisual",
  "keyInfluencers",
  "qnaVisual",
  "smartNarrativeVisual",
  "textbox",
  "shape",
  "image",
  "actionButton",
  "pageNavigator",
  "bookmarkNavigator",
  "pythonVisual",
  "rVisual",
] as const;

export type VisualFamily =
  | "none"
  | "card"
  | "kpi"
  | "gauge"
  | "table"
  | "matrix"
  | "slicer"
  | "chart"
  | "scatter"
  | "map"
  | "tree"
  | "influencer";

const FAMILY_BY_KIND: Record<string, VisualFamily> = {
  card: "card",
  cardVisual: "card",
  multiRowCard: "card",
  kpi: "kpi",
  gauge: "gauge",
  slicer: "slicer",
  tableEx: "table",
  matrix: "matrix",
  pivotTable: "matrix",
  scatterChart: "scatter",
  map: "map",
  filledMap: "map",
  shapeMap: "map",
  decompositionTreeVisual: "tree",
  keyInfluencers: "influencer",
  textbox: "none",
  shape: "none",
  image: "none",
  actionButton: "none",
  pageNavigator: "none",
  bookmarkNavigator: "none",
  qnaVisual: "none",
  smartNarrativeVisual: "none",
  pythonVisual: "none",
  rVisual: "none",
};

export function visualFamily(kind: string): VisualFamily {
  return FAMILY_BY_KIND[kind] ?? "chart";
}

export function isKnownVisualKind(kind: string): boolean {
  return (NATIVE_VISUAL_KINDS as readonly string[]).includes(kind);
}

/** Text-only visuals with no query state. */
export function isQuerylessVisual(kind: string): boolean {
  return visualFamily(kind) === "none";
}

/** Compact list for prompts. */
export const VISUAL_KIND_HINT = NATIVE_VISUAL_KINDS.join(", ");
