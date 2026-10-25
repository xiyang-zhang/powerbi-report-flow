import type {
  ColumnSpec,
  ColumnType,
  DataProfile,
  MeasureSpec,
  ModelSpec,
  RelationshipSpec,
  TableSpec,
} from "../core/types";
import { sanitizeIdentifier, uniqueName } from "../core/schemas";

const INTEGER = /^-?\d+$/;
const NUMBER = /^-?\d+(\.\d+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

function isDateString(value: string): boolean {
  return ISO_DATE.test(value) && !Number.isNaN(Date.parse(value));
}

function isDateTimeString(value: string): boolean {
  return ISO_DATETIME.test(value) && !Number.isNaN(Date.parse(value));
}

export function inferColumnType(values: unknown[]): ColumnType {
  const present = values.filter((value) => value !== null && value !== undefined && value !== "");
  if (present.length === 0) return "string";

  if (present.every((value) => value instanceof Date)) return "dateTime";

  const strings = present.map((value) => String(value).trim());

  if (strings.every((value) => /^(true|false)$/i.test(value))) return "boolean";
  if (strings.every((value) => isDateTimeString(value))) return "dateTime";
  if (strings.every((value) => isDateString(value))) return "date";

  if (
    strings.every((value) => NUMBER.test(value)) &&
    !strings.some((value) => /^-?0\d/.test(value))
  ) {
    const allIntegers = strings.every((value) => INTEGER.test(value));
    return allIntegers ? "int64" : "double";
  }

  return "string";
}

export function profileColumns(
  rows: Array<Record<string, unknown>>,
  sourceColumns?: string[],
): ColumnSpec[] {
  const columns = sourceColumns ?? (rows.length > 0 ? Object.keys(rows[0] ?? {}) : []);
  const used = new Set<string>();
  return columns.map((sourceName) => {
    const values = rows.map((row) => row[sourceName]);
    const type = inferColumnType(values);
    const present = values.filter((value) => value !== null && value !== undefined && value !== "");
    const distinct = new Set(present.map((value) => String(value))).size;
    const rawName = sanitizeIdentifier(sourceName);
    const name = uniqueName(rawName, used);
    return {
      name,
      sourceName,
      type,
      isHidden: false,
      summarizeBy: type === "string" || type === "boolean" || type === "date" || type === "dateTime" ? "none" : "sum",
      formatString:
        type === "int64"
          ? "#,0"
          : type === "double" || type === "decimal"
            ? "#,0.00"
            : type === "date"
              ? "Short Date"
              : undefined,
    };
  });
}

function tableRef(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

function columnRef(column: string): string {
  return `[${column.replace(/]/g, "]]")}]`;
}

export function buildBasicMeasures(table: TableSpec): MeasureSpec[] {
  const measures: MeasureSpec[] = [];
  const used = new Set<string>();
  const rowCount = uniqueName(`Row Count`, used);
  measures.push({
    table: table.name,
    name: rowCount,
    expression: `COUNTROWS(${tableRef(table.name)})`,
    formatString: "#,0",
    description: `Number of rows in ${table.name}.`,
  });
  for (const column of table.columns) {
    if (column.isHidden) continue;
    if (!["int64", "double", "decimal"].includes(column.type)) continue;
    const name = uniqueName(`Total ${column.name}`, used);
    measures.push({
      table: table.name,
      name,
      expression: `SUM(${tableRef(table.name)}${columnRef(column.name)})`,
      formatString: column.formatString ?? "#,0.00",
      description: `Sum of ${column.name}.`,
    });
  }
  return measures;
}

export function inferRelationships(tables: TableSpec[]): RelationshipSpec[] {
  const relationships: RelationshipSpec[] = [];
  const byName = new Map(tables.map((table) => [table.name.toLowerCase(), table]));
  for (const table of tables) {
    for (const column of table.columns) {
      if (!column.name.toLowerCase().endsWith("id")) continue;
      const prefix = column.name.slice(0, -2).replace(/_+$/, "");
      if (!prefix) continue;
      const candidates = [prefix, `${prefix}s`, prefix.replace(/y$/, "ies")];
      const target = candidates.map((candidate) => byName.get(candidate.toLowerCase())).find(Boolean);
      if (!target || target.name === table.name) continue;
      const targetColumn =
        target.columns.find((candidate) => candidate.isKey) ??
        target.columns.find((candidate) => /(^id$|key|code|name)/i.test(candidate.name)) ??
        target.columns[0];
      if (!targetColumn) continue;
      relationships.push({
        fromTable: table.name,
        fromColumn: column.name,
        toTable: target.name,
        toColumn: targetColumn.name,
        cardinality: "manyToOne",
        crossFilteringBehavior: "oneDirection",
      });
    }
  }
  return relationships;
}

export function makeTableSpec(
  name: string,
  rows: Array<Record<string, unknown>>,
  sourceName?: string,
  partition?: TableSpec["partition"],
): TableSpec {
  const columns = profileColumns(rows);
  const table: TableSpec = {
    name,
    sourceName: sourceName ?? name,
    columns,
    measures: [],
    rows: rows.length,
    partition: partition ?? { kind: "csv", path: "" },
  };
  if (partition?.kind === "csv" && partition.path === "") {
    table.partition = { kind: "csv", path: "" };
  }
  table.measures = buildBasicMeasures(table);
  return table;
}

export function finalizeDataProfile(input: {
  sourceMode: DataProfile["sourceMode"];
  sourceLabel: string;
  tables: TableSpec[];
  relationships?: RelationshipSpec[];
  parameters?: DataProfile["parameters"];
  warnings?: string[];
}): DataProfile {
  const relationships = input.relationships ?? inferRelationships(input.tables);
  return {
    sourceMode: input.sourceMode,
    sourceLabel: input.sourceLabel,
    tables: input.tables,
    relationships,
    parameters: input.parameters ?? [],
    warnings: input.warnings ?? [],
  };
}

export function toModelSpec(profile: DataProfile, name: string): ModelSpec {
  return {
    name,
    tables: profile.tables,
    relationships: profile.relationships,
    parameters: profile.parameters,
  };
}
