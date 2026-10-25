import { describe, expect, it } from "vitest";
import type { ModelSpec } from "../src/core/types";
import { addDimensionTables } from "../src/model/dimensions";

function model(): ModelSpec {
  return {
    name: "Sales",
    parameters: [],
    relationships: [
      {
        fromTable: "Sales",
        fromColumn: "CustomerId",
        toTable: "Customer",
        toColumn: "CustomerId",
        cardinality: "manyToOne",
      },
    ],
    tables: [
      {
        name: "Sales",
        columns: [
          { name: "Region", sourceName: "Region", type: "string" },
          { name: "Product", sourceName: "Product", type: "string" },
          { name: "CustomerId", sourceName: "CustomerId", type: "int64" },
          { name: "Revenue", sourceName: "Revenue", type: "double" },
        ],
        measures: [],
        partition: { kind: "csv", path: "C:\\data\\Sales.csv" },
      },
      {
        name: "Customer",
        columns: [{ name: "CustomerId", sourceName: "CustomerId", type: "int64", isKey: true }],
        measures: [],
        partition: { kind: "csv", path: "C:\\data\\Customer.csv" },
      },
    ],
  };
}

describe("addDimensionTables", () => {
  it("creates M-query dimensions and relationships by default", () => {
    const result = addDimensionTables(model());
    expect(result.addedTables).toEqual(["DimRegion", "DimProduct"]);
    const dimensions = result.model.tables.filter((table) => table.partition.kind === "m");
    expect(dimensions.map((table) => table.name)).toEqual(["DimRegion", "DimProduct"]);
    const expression = dimensions[0]?.partition.kind === "m" ? dimensions[0].partition.expression : "";
    expect(expression).toContain("Csv.Document");
    expect(expression).toContain("Table.SelectColumns");
    expect(expression).toContain('Table.Distinct(Table.SelectColumns(#"Promoted Headers", {"Region"}))');
    expect(dimensions[0]?.columns[0]?.isKey).toBeUndefined();
    expect(result.model.relationships).toHaveLength(3);
    expect(result.model.relationships).toContainEqual({
      fromTable: "Sales",
      fromColumn: "Region",
      toTable: "DimRegion",
      toColumn: "Region",
      cardinality: "manyToOne",
      crossFilteringBehavior: "oneDirection",
    });
  });

  it("reuses an existing M dimension with a matching key column", () => {
    const source = model();
    source.tables.push({
      name: "DimRegion",
      columns: [{ name: "Region", sourceName: "Region", type: "string" }],
      measures: [],
      partition: {
        kind: "m",
        expression: 'let Source = Sales, Distinct = Table.Distinct(Source) in Distinct',
      },
    });
    const result = addDimensionTables(source);
    expect(result.addedTables).toEqual(["DimProduct"]);
    expect(result.model.tables.filter((table) => table.name === "DimRegion")).toHaveLength(1);
  });

  it("reuses a matching dimension across fact tables", () => {
    const source = model();
    source.tables.push({
      name: "Returns",
      columns: [
        { name: "Region", sourceName: "Region", type: "string" },
        { name: "Amount", sourceName: "Amount", type: "double" },
      ],
      measures: [],
      partition: { kind: "csv", path: "C:\\data\\Returns.csv" },
    });
    const result = addDimensionTables(source);
    expect(result.addedTables).toEqual(["DimRegion", "DimProduct"]);
    expect(result.model.tables.filter((table) => table.name === "DimRegion")).toHaveLength(1);
    expect(result.model.relationships).toContainEqual({
      fromTable: "Returns",
      fromColumn: "Region",
      toTable: "DimRegion",
      toColumn: "Region",
      cardinality: "manyToOne",
      crossFilteringBehavior: "oneDirection",
    });
  });
});
