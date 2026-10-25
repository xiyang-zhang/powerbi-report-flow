import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { DataProfile } from "../core/types";
import { ensureDir, toCsv } from "../core/util";
import { makeTableSpec, finalizeDataProfile } from "./infer";
import { sanitizeIdentifier } from "../core/schemas";

export interface LocalFileResult {
  profile: DataProfile;
  stagedFiles: string[];
}

function normalizeCell(value: unknown): unknown {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

export function parseCsvText(text: string, delimiter = ","): Array<Record<string, unknown>> {
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    delimiter,
    transformHeader: (header) => header.trim(),
  });
  const fatal = parsed.errors.find((error) => error.type === "Delimiter" || error.type === "Quotes");
  if (fatal) throw new Error(`CSV parse failed: ${fatal.message}`);
  return (parsed.data ?? []).map((row) => {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) output[key] = normalizeCell(value);
    return output;
  });
}

export function rowsFromJson(text: string): Array<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(text);
  let rows: unknown;
  if (Array.isArray(parsed)) rows = parsed;
  else if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    rows =
      record.data ??
      record.rows ??
      record.items ??
      Object.values(record).find((value) => Array.isArray(value));
  }
  if (!Array.isArray(rows)) {
    throw new Error("JSON must be an array of objects, or an object containing a data/rows/items array.");
  }
  return rows.map((row) =>
    row && typeof row === "object" && !Array.isArray(row)
      ? Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) => [key, normalizeCell(value)]))
      : { value: normalizeCell(row) },
  );
}

function rowsFromWorkbook(buffer: Buffer): Array<Record<string, unknown>> {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Excel workbook has no worksheets.");
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error("Excel worksheet is unreadable.");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeCell(value)])),
  );
}

export async function readRows(file: string, maxRows: number): Promise<{ rows: Array<Record<string, unknown>>; truncated: boolean }> {
  const ext = path.extname(file).toLowerCase();
  let rows: Array<Record<string, unknown>>;
  if (ext === ".csv") {
    rows = parseCsvText(await readFile(file, "utf8"), ",");
  } else if (ext === ".tsv" || ext === ".tab") {
    rows = parseCsvText(await readFile(file, "utf8"), "\t");
  } else if (ext === ".json") {
    rows = rowsFromJson(await readFile(file, "utf8"));
  } else if (ext === ".xlsx" || ext === ".xls") {
    rows = rowsFromWorkbook(await readFile(file));
  } else {
    throw new Error(`Unsupported local file type: ${ext || "(none)"}. Use CSV, TSV, XLSX, or JSON.`);
  }
  return { rows: rows.slice(0, maxRows), truncated: rows.length > maxRows };
}

export async function profileLocalFile(
  file: string,
  projectDataDir: string,
  maxRows = 50_000,
): Promise<LocalFileResult> {
  const { rows, truncated } = await readRows(file, maxRows);
  if (rows.length === 0) throw new Error("The selected file contains no rows.");
  const base = sanitizeIdentifier(path.basename(file, path.extname(file)), "Data");
  const table = makeTableSpec(base, rows, path.basename(file));
  table.partition = { kind: "csv", path: path.join(projectDataDir, `${table.name}.csv`) };
  table.rows = rows.length;
  await ensureDir(projectDataDir);
  const columns = table.columns.map((column) => column.sourceName);
  await writeFile(table.partition.path, toCsv(rows, columns), "utf8");

  const warnings = truncated ? [`Only the first ${maxRows.toLocaleString()} rows were profiled.`] : [];
  const profile = finalizeDataProfile({
    sourceMode: "local",
    sourceLabel: file,
    tables: [table],
    warnings,
  });
  return { profile, stagedFiles: [table.partition.path] };
}
