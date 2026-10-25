import { describe, expect, it } from "vitest";
import { inferColumnType, profileColumns, buildBasicMeasures } from "../src/data/infer";
import type { TableSpec } from "../src/core/types";

describe("inferColumnType", () => {
  it("detects numbers, dates, booleans, and strings", () => {
    expect(inferColumnType([1, 2, 3])).toBe("int64");
    expect(inferColumnType([1.5, 2.25])).toBe("double");
    expect(inferColumnType(["2024-01-01", "2024-02-01"])).toBe("date");
    expect(inferColumnType(["2024-01-01T10:00:00Z"])).toBe("dateTime");
    expect(inferColumnType(["true", "false"])).toBe("boolean");
    expect(inferColumnType(["North", "South"])).toBe("string");
    expect(inferColumnType(["001", "002"])).toBe("string");
  });
});

describe("profileColumns", () => {
  it("sanitizes and de-duplicates column names", () => {
    const columns = profileColumns([
      { "Total Sales": "10", "Total Sales_2": "20" },
      { "Total Sales": "11", "Total Sales_2": "21" },
    ]);
    expect(columns.map((column) => column.name)).toEqual(["Total_Sales", "Total_Sales_2"]);
    expect(columns[0]?.sourceName).toBe("Total Sales");
  });
});

describe("buildBasicMeasures", () => {
  it("creates a row count and sums for numeric columns", () => {
    const table: TableSpec = {
      name: "Sales",
      columns: [
        { name: "Region", sourceName: "Region", type: "string" },
        { name: "Revenue", sourceName: "Revenue", type: "double" },
      ],
      measures: [],
      partition: { kind: "csv", path: "data/Sales.csv" },
    };
    const measures = buildBasicMeasures(table);
    expect(measures.some((measure) => measure.name === "Row Count")).toBe(true);
    expect(measures.some((measure) => measure.name === "Total Revenue")).toBe(true);
  });
});
