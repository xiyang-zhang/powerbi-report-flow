import { z } from "zod";
import type { MockSchema, ReportSpec } from "./types";

export const columnTypeSchema = z.enum(["string", "int64", "double", "decimal", "boolean", "date", "dateTime"]);

export const mockColumnSchema = z.object({
  name: z.string().min(1),
  type: columnTypeSchema,
  values: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  nullRate: z.number().min(0).max(1).optional(),
  unique: z.boolean().optional(),
});

export const mockTableSchema = z.object({
  name: z.string().min(1),
  rows: z.number().int().positive().max(1_000_000),
  columns: z.array(mockColumnSchema).min(1),
  keys: z.array(z.string()).optional(),
});

export const relationshipSchema = z.object({
  fromTable: z.string(),
  fromColumn: z.string(),
  toTable: z.string(),
  toColumn: z.string(),
  cardinality: z.enum(["oneToOne", "oneToMany", "manyToOne", "manyToMany"]).optional(),
  crossFilteringBehavior: z.enum(["oneDirection", "bothDirections"]).optional(),
});

export const mockSchemaSchema = z.object({
  seed: z.number().int().default(42),
  tables: z.array(mockTableSchema).min(1),
  relationships: z.array(relationshipSchema).optional(),
});

export const fieldBindingSchema = z.object({
  table: z.string(),
  field: z.string(),
  kind: z.enum(["column", "measure", "aggregation"]),
  aggregation: z.enum(["sum", "average", "count", "min", "max"]).optional(),
  role: z.string().optional(),
});

export const placementSchema = z.object({
  id: z.string(),
  region: z.string(),
  slot: z.number().int().positive().optional(),
  of: z.number().int().positive().optional(),
  kind: z.string().min(1),
  text: z.string().optional(),
  fieldBindings: z.array(fieldBindingSchema).default([]),
  color: z.string().optional(),
  position: z
    .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    .optional(),
  title: z.string().optional(),
});

export const pageBackgroundSchema = z.union([
  z.string(),
  z.object({
    color: z.string().optional(),
    image: z.string().optional(),
    scaling: z.enum(["Fit", "Fill", "Tile", "Normal"]).optional(),
    transparency: z.number().min(0).max(100).optional(),
  }),
]);

export const pageSchema = z.object({
  name: z.string().min(1).max(50),
  displayName: z.string(),
  role: z.string().default("overview"),
  canvas: z.object({ width: z.number().positive(), height: z.number().positive() }),
  regions: z.record(z.tuple([z.number(), z.number(), z.number(), z.number()])),
  placements: z.array(placementSchema),
  background: pageBackgroundSchema.optional(),
});

export const reportSpecSchema = z.object({
  generatedBy: z.literal("powerbi-report-cli"),
  contractVersion: z.literal(1),
  mode: z.enum(["greenfield", "brownfield"]).default("greenfield"),
  sourceMode: z.enum(["external", "local", "mock"]),
  reportMode: z.enum(["existing", "image", "text"]),
  designIdentity: z.object({ tone: z.string(), signature: z.string() }),
  colorMap: z.record(z.string()).default({}),
  pages: z.array(pageSchema).min(1),
  accessibility: z.object({ altTextStrategy: z.string(), contrastNotes: z.string() }),
  theme: z.object({ base: z.string(), overrides: z.record(z.unknown()).optional() }),
  title: z.string(),
  summary: z.string(),
});

export function parseMockSchema(input: unknown): MockSchema {
  return mockSchemaSchema.parse(input);
}

export function parseReportSpec(input: unknown): ReportSpec {
  return reportSpecSchema.parse(input) as ReportSpec;
}

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function sanitizeIdentifier(raw: string, fallback = "Column"): string {
  const ascii = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
  let value = ascii.length > 0 ? ascii : fallback;
  if (!/^[A-Za-z_]/.test(value)) value = `${fallback}_${value}`;
  if (!SAFE_IDENTIFIER.test(value)) value = fallback;
  return value;
}

export function uniqueName(base: string, used: Set<string>): string {
  let candidate = base;
  let index = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base}_${index}`;
    index += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export function isValidIdentifier(value: string): boolean {
  return SAFE_IDENTIFIER.test(value);
}

export function slugify(value: string): string {
  return sanitizeIdentifier(value, "Report").replace(/_/g, "-").toLowerCase();
}
