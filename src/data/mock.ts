import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { DataProfile, MockColumnSchema, MockSchema, TableSpec } from "../core/types";
import { ensureDir, toCsv } from "../core/util";
import { sanitizeIdentifier, uniqueName } from "../core/schemas";
import { finalizeDataProfile, makeTableSpec } from "./infer";
import { mockKeyWarnings, primaryMockKey } from "./mockKeys";

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBetween(random: () => number, min: number, max: number): number {
  return min + random() * (max - min);
}

function dateRange(start: string | undefined, end: string | undefined): [number, number] {
  const startMs = start ? Date.parse(start) : Date.parse("2022-01-01");
  const endMs = end ? Date.parse(end) : Date.parse("2025-12-31");
  return [Number.isNaN(startMs) ? Date.parse("2022-01-01") : startMs, Number.isNaN(endMs) ? Date.parse("2025-12-31") : endMs];
}

function generateValue(
  column: MockColumnSchema,
  random: () => number,
  index: number,
  used: Set<string>,
): unknown {
  if (column.nullRate && random() < column.nullRate) return "";
  let value: unknown;
  switch (column.type) {
    case "int64":
      value = Math.round(randomBetween(random, column.min ?? 1, column.max ?? 1000));
      break;
    case "double":
    case "decimal":
      value = Number(randomBetween(random, column.min ?? 0, column.max ?? 1000).toFixed(2));
      break;
    case "boolean":
      value = random() > 0.5;
      break;
    case "date":
    case "dateTime": {
      const [start, end] = dateRange(column.start, column.end);
      const date = new Date(randomBetween(random, start, end));
      value = column.type === "date" ? date.toISOString().slice(0, 10) : date.toISOString();
      break;
    }
    case "string":
    default:
      if (column.values && column.values.length > 0) {
        value = column.values[Math.floor(random() * column.values.length)];
      } else {
        value = `${sanitizeIdentifier(column.name, "Value")}_${index + 1}`;
      }
      break;
  }
  if (column.unique) {
    let text = String(value);
    let suffix = 1;
    while (used.has(text)) {
      text = `${String(value)}_${suffix}`;
      suffix += 1;
    }
    used.add(text);
    value = text;
  }
  return value;
}

export async function generateMockData(
  schema: MockSchema,
  projectDataDir: string,
  maxRows = 50_000,
): Promise<DataProfile> {
  const random = mulberry32(schema.seed ?? 42);
  const tables: TableSpec[] = [];
  const stagedFiles: string[] = [];
  await ensureDir(projectDataDir);

  for (const mockTable of schema.tables) {
    if (mockTable.rows > maxRows) {
      throw new Error(`Table ${mockTable.name} requests ${mockTable.rows} rows; the configured maximum is ${maxRows}.`);
    }
    const usedColumns = new Set<string>();
    const key = primaryMockKey(mockTable);
    const columns = mockTable.columns.map((column) => ({
      ...column,
      safeName: uniqueName(sanitizeIdentifier(column.name, "Column"), usedColumns),
    }));
    const seen = new Map<string, Set<string>>();
    for (const column of columns) {
      if (mockTable.keys?.includes(column.name) || column.unique) seen.set(column.name, new Set());
    }
    const rows: Array<Record<string, unknown>> = [];
    for (let index = 0; index < mockTable.rows; index += 1) {
      const row: Record<string, unknown> = {};
      for (const column of columns) {
        const used = seen.get(column.name) ?? new Set<string>();
        row[column.name] = generateValue(column, random, index, used);
      }
      rows.push(row);
    }
    const tableName = sanitizeIdentifier(mockTable.name, "Table");
    const table = makeTableSpec(tableName, rows, mockTable.name);
    table.columns = table.columns.map((column) => ({
      ...column,
      isKey: key !== undefined && column.sourceName === key,
    }));
    table.partition = { kind: "csv", path: path.join(projectDataDir, `${table.name}.csv`) };
    table.rows = rows.length;
    table.measures = table.measures;
    await writeFile(table.partition.path, toCsv(rows, mockTable.columns.map((column) => column.name)), "utf8");
    stagedFiles.push(table.partition.path);
    tables.push(table);
  }

  return finalizeDataProfile({
    sourceMode: "mock",
    sourceLabel: `Mock schema (seed ${schema.seed ?? 42})`,
    tables,
    relationships: schema.relationships,
    warnings: mockKeyWarnings(schema),
  });
}
