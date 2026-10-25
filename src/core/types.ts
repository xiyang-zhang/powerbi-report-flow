export type ColumnType = "string" | "int64" | "double" | "decimal" | "boolean" | "date" | "dateTime";

export interface ColumnSpec {
  name: string;
  sourceName: string;
  type: ColumnType;
  isKey?: boolean;
  isHidden?: boolean;
  formatString?: string;
  summarizeBy?: "none" | "sum" | "average" | "count" | "min" | "max";
}

export interface MeasureSpec {
  name: string;
  expression: string;
  formatString?: string;
  description?: string;
  table: string;
}

export type PartitionSpec =
  | { kind: "csv"; path: string; delimiter?: string }
  | {
      kind: "sql";
      connector: "sqlserver" | "postgresql" | "mysql";
      server: string;
      database: string;
      schema?: string;
      table: string;
      query?: string;
    }
  | { kind: "fabric"; connectionString: string }
  | { kind: "m"; expression: string };

export interface TableSpec {
  name: string;
  sourceName?: string;
  columns: ColumnSpec[];
  measures: MeasureSpec[];
  partition: PartitionSpec;
  rows?: number;
}

export interface RelationshipSpec {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  cardinality?: "oneToOne" | "oneToMany" | "manyToOne" | "manyToMany";
  crossFilteringBehavior?: "oneDirection" | "bothDirections";
}

export interface ParameterSpec {
  name: string;
  type: "text" | "number";
  value: string;
}

export interface DataProfile {
  sourceMode: "external" | "local" | "mock";
  sourceLabel: string;
  tables: TableSpec[];
  relationships: RelationshipSpec[];
  parameters: ParameterSpec[];
  warnings: string[];
}

export interface ModelSpec {
  name: string;
  tables: TableSpec[];
  relationships: RelationshipSpec[];
  parameters: ParameterSpec[];
}

/**
 * PBIR stores the visual type as a string. Keeping this open lets the design
 * contract target any native visual that the installed Desktop build knows,
 * while `NATIVE_VISUAL_KINDS` in `report/visuals.ts` provides suggestions.
 */
export type VisualKind = string;

export type BackgroundScaling = "Fit" | "Fill" | "Tile" | "Normal";

export interface PageBackgroundSpec {
  color?: string;
  image?: string;
  scaling?: BackgroundScaling;
  transparency?: number;
}

export interface FieldBinding {
  table: string;
  field: string;
  kind: "column" | "measure" | "aggregation";
  aggregation?: "sum" | "average" | "count" | "min" | "max";
  role?: string;
}

export interface PlacementSpec {
  id: string;
  region: string;
  slot?: number;
  of?: number;
  kind: VisualKind;
  text?: string;
  fieldBindings: FieldBinding[];
  color?: string;
  position?: { x: number; y: number; width: number; height: number };
  title?: string;
}

export interface PageSpec {
  name: string;
  displayName: string;
  role: string;
  canvas: { width: number; height: number };
  regions: Record<string, [number, number, number, number]>;
  placements: PlacementSpec[];
  background?: string | PageBackgroundSpec;
}

export interface ReportSpec {
  generatedBy: "powerbi-report-cli";
  contractVersion: 1;
  mode: "greenfield" | "brownfield";
  sourceMode: "external" | "local" | "mock";
  reportMode: "existing" | "image" | "text";
  designIdentity: { tone: string; signature: string };
  colorMap: Record<string, string>;
  pages: PageSpec[];
  accessibility: { altTextStrategy: string; contrastNotes: string };
  theme: { base: string; overrides?: Record<string, unknown> };
  title: string;
  summary: string;
}

export interface MockColumnSchema {
  name: string;
  type: ColumnType;
  values?: string[];
  min?: number;
  max?: number;
  start?: string;
  end?: string;
  nullRate?: number;
  unique?: boolean;
}

export interface MockTableSchema {
  name: string;
  rows: number;
  columns: MockColumnSchema[];
  keys?: string[];
}

export interface MockSchema {
  seed: number;
  tables: MockTableSchema[];
  relationships?: RelationshipSpec[];
}

export type ExternalDbConfig =
  | { connector: "sqlserver"; server: string; database: string; user?: string; password?: string; schema?: string; table?: string }
  | { connector: "postgresql"; server: string; database: string; user?: string; password?: string; schema?: string; table?: string }
  | { connector: "mysql"; server: string; database: string; user?: string; password?: string; schema?: string; table?: string };

export interface ExternalSourceConfig {
  kind: "database";
  db: ExternalDbConfig;
}

export interface FabricSourceConfig {
  kind: "fabric";
  workspace: string;
  model: string;
  modelId: string;
}

export interface FlowConfig {
  projectName: string;
  outputDir: string;
  dataMode: "external" | "local" | "mock";
  reportMode: "existing" | "image" | "text";
  localFile?: string;
  /** Legacy single-image field; kept so old settings/payloads still work. */
  imageFile?: string;
  /** One or more reference images for image report mode. */
  imageFiles?: string[];
  referenceReport?: string;
  textBrief?: string;
  /** Text/YAML declarations for per-page backgrounds. */
  backgroundYaml?: string;
  /** Documents or images whose text and embedded images are sent to the LLM. */
  contextDocuments?: string[];
  audience?: string;
  tone?: string;
  pageCount?: number;
  mockSchema?: MockSchema;
  externalDb?: ExternalDbConfig;
  fabric?: FabricSourceConfig;
  seed: number;
}

export interface DependencyStatus {
  node: string;
  vscode: string;
  reportCli: { found: boolean; path?: string; version?: string };
  mcp: { found: boolean; path?: string };
  desktop: { found: boolean; path?: string };
  az: { found: boolean; path?: string };
  warnings: string[];
}

export interface BuildManifest {
  version: 1;
  generatedAt: string;
  projectName: string;
  sourceMode: string;
  reportMode: string;
  llmProvider: string;
  specHash: string;
  reportDir: string;
  modelDir: string;
  warnings: string[];
}

export interface FlowState {
  phase: "idle" | "profiling" | "spec" | "awaitingApproval" | "building" | "validating" | "previewing" | "done" | "blocked" | "error";
  message: string;
  log: string[];
  config?: Partial<FlowConfig>;
  dataProfile?: DataProfile;
  reportSpec?: ReportSpec;
  specHash?: string;
  validation?: { result: string; errors: string[]; warnings: string[] };
  screenshots?: string[];
  error?: string;
}
