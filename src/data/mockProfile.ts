import type { DataProfile, MockSchema, TableSpec } from "../core/types";
import { sanitizeIdentifier, uniqueName } from "../core/schemas";
import { buildBasicMeasures, finalizeDataProfile } from "./infer";
import { mockKeyWarnings, primaryMockKey } from "./mockKeys";

export function mockProfileFromSchema(schema: MockSchema): DataProfile {
  const tables: TableSpec[] = schema.tables.map((mockTable) => {
    const used = new Set<string>();
    const key = primaryMockKey(mockTable);
    const columns = mockTable.columns.map((column) => ({
      name: uniqueName(sanitizeIdentifier(column.name, "Column"), used),
      sourceName: column.name,
      type: column.type,
      isKey: key !== undefined && column.name === key,
      summarizeBy:
        column.type === "int64" || column.type === "double" || column.type === "decimal"
          ? ("sum" as const)
          : ("none" as const),
      formatString: column.type === "int64" ? "#,0" : column.type === "double" ? "#,0.00" : undefined,
    }));
    const table: TableSpec = {
      name: sanitizeIdentifier(mockTable.name, "Table"),
      sourceName: mockTable.name,
      columns,
      measures: [],
      rows: mockTable.rows,
      partition: { kind: "csv", path: "" },
    };
    table.measures = buildBasicMeasures(table);
    return table;
  });
  return finalizeDataProfile({
    sourceMode: "mock",
    sourceLabel: `Mock schema (seed ${schema.seed})`,
    tables,
    relationships: schema.relationships,
    warnings: mockKeyWarnings(schema),
  });
}
