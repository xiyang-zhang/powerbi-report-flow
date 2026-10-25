import { describe, expect, it } from "vitest";
import type { DataProfile, PageSpec, PlacementSpec } from "../src/core/types";
import { defaultReportSpec } from "../src/report/spec";
import { buildVisualJson } from "../src/report/visuals";

const profile: DataProfile = {
  sourceMode: "mock",
  sourceLabel: "test",
  warnings: [],
  relationships: [],
  parameters: [],
  tables: [
    {
      name: "Sales",
      columns: [
        { name: "Region", sourceName: "Region", type: "string" },
        { name: "Product", sourceName: "Product", type: "string" },
        { name: "Revenue", sourceName: "Revenue", type: "double" },
      ],
      measures: [{ table: "Sales", name: "Total Revenue", expression: "SUM(Sales[Revenue])" }],
      partition: { kind: "csv", path: "data/Sales.csv" },
    },
  ],
};

function visualFor(kind: string): Record<string, unknown> {
  const spec = defaultReportSpec(profile, { pageCount: 1 });
  const page: PageSpec = spec.pages[0]!;
  const placement: PlacementSpec = {
    id: "test-visual",
    region: "main",
    kind,
    title: "Test",
    fieldBindings: [
      { table: "Sales", field: "Region", kind: "column" },
      { table: "Sales", field: "Total Revenue", kind: "measure" },
    ],
    position: { x: 0, y: 0, width: 6, height: 4 },
  };
  return buildVisualJson(spec, page, placement, { x: 20, y: 20, width: 600, height: 400 }, profile.tables);
}

describe("native visual mapping", () => {
  it("keeps the PBIR card visual type and uses the Data role", () => {
    const visual = visualFor("card") as {
      visual: { visualType: string; query?: { queryState?: { Data?: unknown } } };
    };
    expect(visual.visual.visualType).toBe("cardVisual");
    expect(visual.visual.query?.queryState?.Data).toBeTruthy();
  });

  it("maps matrix bindings to Rows and Values", () => {
    const visual = visualFor("matrix") as {
      visual: { visualType: string; query?: { queryState?: { Rows?: unknown; Values?: unknown } } };
    };
    expect(visual.visual.visualType).toBe("matrix");
    expect(visual.visual.query?.queryState?.Rows).toBeTruthy();
    expect(visual.visual.query?.queryState?.Values).toBeTruthy();
  });

  it("keeps a previously unsupported visual type instead of converting it to textbox", () => {
    const visual = visualFor("radarChart") as { visual: { visualType: string } };
    expect(visual.visual.visualType).toBe("radarChart");
  });

  it("keeps queryless native visuals as their real type", () => {
    const visual = visualFor("qnaVisual") as { visual: { visualType: string; query?: unknown } };
    expect(visual.visual.visualType).toBe("qnaVisual");
    expect(visual.visual.query).toBeUndefined();
  });
});
