import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import type { ColumnSpec, MeasureSpec, ModelSpec, PartitionSpec, RelationshipSpec, TableSpec } from "../core/types";
import { ensureDir, escapeDaxString, escapeMString, uuid, writeJson, writeText } from "../core/util";

const T = "\t";

/**
 * Power BI Desktop does not expose a relational "primary key" concept in the
 * TMDL it can refresh. An `isKey` declaration on a table column makes Refresh
 * fail with a null-query assertion, so generated TMDL must never contain it.
 * This check is deliberately applied at the write boundary as a safety net for
 * any future column annotation that might reintroduce the property.
 */
export function stripIsKeyDeclarations(content: string): string {
  return content
    .split(/\r?\n/)
    .filter((line) => !/^\s*isKey\s*$/.test(line))
    .join("\n");
}

async function tmdlFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await tmdlFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".tmdl")) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Post-build check: removes any isKey declaration that bypassed the normal
 * writeTmdlText path. Returns model-relative paths that were rewritten.
 */
export async function enforceNoIsKey(modelDir: string): Promise<string[]> {
  const definitionDir = path.join(modelDir, "definition");
  const changed: string[] = [];
  let files: string[];
  try {
    files = await tmdlFiles(definitionDir);
  } catch {
    return changed;
  }
  for (const file of files) {
    const content = await readFile(file, "utf8");
    if (!/^\s*isKey\s*$/m.test(content)) continue;
    const sanitized = stripIsKeyDeclarations(content);
    await writeTmdlText(file, sanitized);
    changed.push(path.relative(modelDir, file));
  }
  return changed;
}

async function writeTmdlText(filePath: string, content: string): Promise<void> {
  // Power BI Desktop's TMDL reader rejects LF-only files by opening a blank
  // untitled window. CRLF is required for PBIP semantic model TMDL files.
  await writeText(
    filePath,
    stripIsKeyDeclarations(content).replace(/\r?\n/g, "\r\n"),
  );
}

function quoteName(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

function objectName(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : quoteName(name);
}

function propertyString(value: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? value : `"${value.replace(/"/g, '""')}"`;
}

function mType(type: ColumnSpec["type"]): string {
  switch (type) {
    case "int64":
      return "Int64.Type";
    case "double":
    case "decimal":
      return "type number";
    case "boolean":
      return "type logical";
    case "date":
      return "type date";
    case "dateTime":
      return "type datetime";
    default:
      return "type text";
  }
}

function tmdlDataType(type: ColumnSpec["type"]): string {
  switch (type) {
    case "int64":
      return "int64";
    case "double":
      return "double";
    case "decimal":
      return "decimal";
    case "boolean":
      return "boolean";
    case "date":
      return "dateTime";
    case "dateTime":
      return "dateTime";
    default:
      return "string";
  }
}

function summarizeBy(column: ColumnSpec): string {
  if (column.summarizeBy) return column.summarizeBy;
  if (["int64", "double", "decimal"].includes(column.type)) return "sum";
  return "none";
}

function mExpression(table: TableSpec): string {
  const partition = table.partition;
  if (partition.kind === "csv") {
    // M string literals do not use backslash escapes; double backslashes would
    // make File.Contents look for a literal path with doubled separators.
    const pathValue = escapeMString(partition.path);
    const changes = table.columns
      .map((column) => `{"${escapeMString(column.sourceName)}", ${mType(column.type)}}`)
      .join(", ");
    return [
      "let",
      `    Source = Csv.Document(File.Contents("${pathValue}"), [Delimiter="${partition.delimiter ?? ","}", Encoding=65001, QuoteStyle=QuoteStyle.Csv]),`,
      "    #\"Promoted Headers\" = Table.PromoteHeaders(Source, [PromoteAllScalars=true]),",
      changes.length > 0
        ? `    #"Changed Type" = Table.TransformColumnTypes(#"Promoted Headers", {${changes}})`
        : "    #\"Changed Type\" = #\"Promoted Headers\"",
      "in",
      "    #\"Changed Type\"",
    ].join("\n");
  }

  if (partition.kind === "sql") {
    const server = escapeMString(partition.server);
    const database = escapeMString(partition.database);
    const source =
      partition.connector === "sqlserver"
        ? `Sql.Database("${server}", "${database}")`
        : partition.connector === "postgresql"
          ? `PostgreSQL.Database("${server}", "${database}")`
          : `MySQL.Database("${server}", "${database}")`;
    const tableName = escapeMString(partition.table);
    const schema = partition.schema ? `Schema="${escapeMString(partition.schema)}", ` : "";
    return [
      "let",
      `    Source = ${source},`,
      `    Item = Source{[${schema}Item="${tableName}"]}[Data]`,
      "in",
      "    Item",
    ].join("\n");
  }

  if (partition.kind === "m") {
    return partition.expression;
  }

  return [
    "let",
    `    Source = AnalysisServices.Database("${escapeMString(partition.connectionString)}", null)`,
    "in",
    "    Source",
  ].join("\n");
}

function tmdlColumn(column: ColumnSpec): string {
  const lines = [
    `${T}column ${objectName(column.name)}`,
    `${T}${T}dataType: ${tmdlDataType(column.type)}`,
    `${T}${T}lineageTag: ${uuid()}`,
    `${T}${T}summarizeBy: ${summarizeBy(column)}`,
    `${T}${T}sourceColumn: ${propertyString(column.sourceName || column.name)}`,
  ];
  if (column.isHidden) lines.push(`${T}${T}isHidden`);
  if (column.formatString) lines.push(`${T}${T}formatString: ${column.formatString}`);
  lines.push("");
  lines.push(`${T}${T}annotation SummarizationSetBy = Automatic`);
  return lines.join("\n");
}

function tmdlMeasure(measure: MeasureSpec): string {
  const lines = [
    `${T}measure ${objectName(measure.name)} = ${measure.expression}`,
    `${T}${T}lineageTag: ${uuid()}`,
  ];
  if (measure.formatString) lines.push(`${T}${T}formatString: ${measure.formatString}`);
  return lines.join("\n");
}

function tmdlPartition(table: TableSpec): string {
  const expression = mExpression(table);
  const sourceLines = expression
    .split("\n")
    .map((line) => `${T}${T}${T}${T}${line}`)
    .join("\n");
  return [
    `${T}partition ${quoteName(`${table.name}-Partition`)} = m`,
    `${T}${T}mode: import`,
    `${T}${T}source =`,
    sourceLines,
  ].join("\n");
}

export function tmdlTable(table: TableSpec): string {
  const lines = [`table ${objectName(table.name)}`, `${T}lineageTag: ${uuid()}`, ""];
  for (const column of table.columns) {
    lines.push(tmdlColumn(column), "");
  }
  for (const measure of table.measures) lines.push(tmdlMeasure(measure), "");
  lines.push(tmdlPartition(table), "");
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}`;
}

function tmdlRelationship(relationship: RelationshipSpec): string {
  const from = `${objectName(relationship.fromTable)}.${objectName(relationship.fromColumn)}`;
  const to = `${objectName(relationship.toTable)}.${objectName(relationship.toColumn)}`;
  const lines = [`relationship ${uuid()}`, `${T}fromColumn: ${from}`, `${T}toColumn: ${to}`];
  if (relationship.crossFilteringBehavior === "bothDirections") {
    lines.push(`${T}crossFilteringBehavior: bothDirections`);
  }
  return lines.join("\n");
}

export async function createModelSkeleton(modelDir: string, modelName: string): Promise<void> {
  await ensureDir(path.join(modelDir, "definition", "tables"));
  await writeJson(path.join(modelDir, ".platform"), {
    $schema: "https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json",
    metadata: { type: "SemanticModel", displayName: modelName },
    config: { version: "2.0", logicalId: uuid() },
  });
  await writeJson(path.join(modelDir, "definition.pbism"), {
    $schema: "https://developer.microsoft.com/json-schemas/fabric/item/semanticModel/definitionProperties/1.0.0/schema.json",
    version: "4.0",
    settings: {},
  });
  await writeTmdlText(
    path.join(modelDir, "definition", "database.tmdl"),
    `database ${objectName(modelName)}\n${T}compatibilityLevel: 1567\n`,
  );
  await writeTmdlText(
    path.join(modelDir, "definition", "model.tmdl"),
    [
      `model ${objectName(modelName)}`,
      `${T}culture: en-US`,
      `${T}defaultPowerBIDataSourceVersion: powerBI_V3`,
      "",
    ].join("\n"),
  );
  await writeTmdlText(path.join(modelDir, "definition", "relationships.tmdl"), "");
  await writeTmdlText(path.join(modelDir, "definition", "expressions.tmdl"), "");
}

export async function buildModel(modelDir: string, model: ModelSpec): Promise<string[]> {
  await createModelSkeleton(modelDir, model.name);
  for (const table of model.tables) {
    await writeTmdlText(path.join(modelDir, "definition", "tables", `${table.name}.tmdl`), tmdlTable(table));
  }
  const relationships = model.relationships.map(tmdlRelationship).join("\n\n");
  await writeTmdlText(path.join(modelDir, "definition", "relationships.tmdl"), relationships ? `${relationships}\n` : "");
  const parameters = model.parameters
    .map(
      (parameter) =>
        `expression ${objectName(parameter.name)} = ${JSON.stringify(parameter.value)} meta [IsParameterQuery=true, Type="${parameter.type === "number" ? "Number" : "Text"}", IsParameterQueryRequired=true]`,
    )
    .join("\n\n");
  await writeTmdlText(path.join(modelDir, "definition", "expressions.tmdl"), parameters ? `${parameters}\n` : "");
  return enforceNoIsKey(modelDir);
}

export function extractMeasures(model: ModelSpec): MeasureSpec[] {
  return model.tables.flatMap((table) => table.measures);
}

export function daxQuote(value: string): string {
  return `"${escapeDaxString(value)}"`;
}
