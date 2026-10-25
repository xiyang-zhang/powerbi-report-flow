import type { ModelSpec, PartitionSpec, RelationshipSpec, TableSpec } from "../core/types";
import { sanitizeIdentifier, uniqueName } from "../core/schemas";
import { escapeMString } from "../core/util";

const MAX_DIMENSIONS_PER_TABLE = 4;
const NUMERIC_TYPES = new Set(["int64", "double", "decimal"]);

export interface DimensionAugmentation {
  model: ModelSpec;
  addedTables: string[];
  warnings: string[];
}

function mString(value: string): string {
  return `"${escapeMString(value)}"`;
}

function looksLikeFactTable(table: TableSpec): boolean {
  return table.measures.length > 0 || table.columns.some((column) => NUMERIC_TYPES.has(column.type));
}

/** Build an M partition that returns the distinct values of one fact column. */
function dimensionMExpression(table: TableSpec, columnName: string): string | undefined {
  const partition: PartitionSpec = table.partition;

  if (partition.kind === "csv") {
    const delimiter = partition.delimiter ?? ",";
    return [
      "let",
      `    Source = Csv.Document(File.Contents(${mString(partition.path)}), [Delimiter=${mString(delimiter)}, Encoding=65001, QuoteStyle=QuoteStyle.Csv]),`,
      '    #"Promoted Headers" = Table.PromoteHeaders(Source, [PromoteAllScalars=true]),',
      `    Distinct = Table.Distinct(Table.SelectColumns(#"Promoted Headers", {${mString(columnName)}}))`,
      "in",
      "    Distinct",
    ].join("\n");
  }

  if (partition.kind === "sql") {
    const server = mString(partition.server);
    const database = mString(partition.database);
    const source =
      partition.connector === "sqlserver"
        ? `Sql.Database(${server}, ${database})`
        : partition.connector === "postgresql"
          ? `PostgreSQL.Database(${server}, ${database})`
          : `MySQL.Database(${server}, ${database})`;
    const schema = partition.schema ? `Schema=${mString(partition.schema)}, ` : "";
    return [
      "let",
      `    Source = ${source},`,
      `    Item = Source{[${schema}Item=${mString(partition.table)}]}[Data],`,
      `    Distinct = Table.Distinct(Table.SelectColumns(Item, {${mString(columnName)}}))`,
      "in",
      "    Distinct",
    ].join("\n");
  }

  // Fabric and arbitrary M partitions have no direct tabular source we can
  // safely select from without credentials/query semantics; skip auto dims.
  return undefined;
}

/**
 * Adds small dimension tables for categorical columns on fact tables:
 *
 *   table DimRegion
 *     column Region ...
 *     partition ... = m
 *       source = ...
 *         Table.Distinct(Table.SelectColumns(..., {"Region"}))
 *
 * and a many-to-one relationship from the fact column to the dimension key.
 * Columns already used by a relationship and obvious identifier columns are skipped.
 *
 * M partitions are used instead of DAX calculated tables: Power BI Desktop
 * 2.159 cannot reopen a PBIP whose relationship points at a calculated table.
 */
export function addDimensionTables(model: ModelSpec): DimensionAugmentation {
  const usedTableNames = new Set(model.tables.map((table) => table.name.toLowerCase()));
  const usedFactColumns = new Set(
    model.relationships.map((relationship) =>
      `${relationship.fromTable}.${relationship.fromColumn}`.toLowerCase(),
    ),
  );
  const tables = [...model.tables];
  const relationships = [...model.relationships];
  const addedTables: string[] = [];
  const warnings: string[] = [];

  for (const table of model.tables) {
    if (!looksLikeFactTable(table)) continue;
    const candidates = table.columns.filter(
      (column) =>
        column.type === "string" &&
        !column.isKey &&
        !/id$/i.test(column.name) &&
        !usedFactColumns.has(`${table.name}.${column.name}`.toLowerCase()),
    );

    if (candidates.length > MAX_DIMENSIONS_PER_TABLE) {
      warnings.push(
        `Table "${table.name}" has ${candidates.length} categorical columns; only the first ${MAX_DIMENSIONS_PER_TABLE} get dimension tables.`,
      );
    }

    for (const column of candidates.slice(0, MAX_DIMENSIONS_PER_TABLE)) {
      const baseName = `Dim${sanitizeIdentifier(column.name, "Dimension")}`;
      const existingDimension = tables.find(
        (candidate) =>
          candidate.name.toLowerCase() === baseName.toLowerCase() &&
          candidate.columns.some(
            (candidateColumn) => candidateColumn.name === column.name && candidateColumn.type === "string",
          ),
      );
      if (existingDimension) {
        relationships.push({
          fromTable: table.name,
          fromColumn: column.name,
          toTable: existingDimension.name,
          toColumn: column.name,
          cardinality: "manyToOne",
          crossFilteringBehavior: "oneDirection",
        });
        usedFactColumns.add(`${table.name}.${column.name}`.toLowerCase());
        continue;
      }

      const expression = dimensionMExpression(table, column.name);
      if (!expression) {
        warnings.push(
          `Table "${table.name}" uses a partition that cannot be read directly; no automatic dimension was added for "${column.name}".`,
        );
        continue;
      }

      const dimensionName = uniqueName(baseName, usedTableNames);
      const dimension: TableSpec = {
        name: dimensionName,
        sourceName: dimensionName,
        columns: [
          {
            name: column.name,
            sourceName: column.name,
            type: "string",
            summarizeBy: "none",
          },
        ],
        measures: [],
        partition: { kind: "m", expression },
      };
      const relationship: RelationshipSpec = {
        fromTable: table.name,
        fromColumn: column.name,
        toTable: dimensionName,
        toColumn: column.name,
        cardinality: "manyToOne",
        crossFilteringBehavior: "oneDirection",
      };

      tables.push(dimension);
      relationships.push(relationship);
      usedFactColumns.add(`${table.name}.${column.name}`.toLowerCase());
      addedTables.push(dimensionName);
    }
  }

  return {
    model: { ...model, tables, relationships },
    addedTables,
    warnings,
  };
}
