import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MockSchema } from "../src/core/types";
import { generateMockData } from "../src/data/mock";
import { toModelSpec } from "../src/data/infer";
import { buildModel } from "../src/model/tmdl";
import { buildReport, createPbip } from "../src/report/pbir";
import { defaultReportSpec } from "../src/report/spec";

const schema: MockSchema = {
  seed: 11,
  tables: [
    {
      name: "Sales",
      rows: 40,
      columns: [
        { name: "OrderDate", type: "date", start: "2024-01-01", end: "2024-06-30" },
        { name: "Region", type: "string", values: ["North", "South", "East", "West"] },
        { name: "Revenue", type: "double", min: 100, max: 1000 },
      ],
    },
  ],
};

let temp: string | undefined;
afterEach(async () => {
  if (temp) await rm(temp, { recursive: true, force: true });
  temp = undefined;
});

describe("project generation", () => {
  it("writes a PBIP, semantic model, and report", async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), "pbi-flow-build-"));
    const profile = await generateMockData(schema, path.join(temp, "data"));
    const modelDir = path.join(temp, "SalesOverview.SemanticModel");
    await buildModel(modelDir, toModelSpec(profile, "SalesOverview"));
    const spec = defaultReportSpec(profile, { title: "Sales Overview" });
    const report = await buildReport(temp, "SalesOverview", spec, profile.tables);
    const pbip = await createPbip(temp, "SalesOverview");

    expect(report.visualCount).toBeGreaterThan(0);
    expect(await readFile(pbip, "utf8")).toContain("SalesOverview.Report");
    expect(await readFile(path.join(temp, "SalesOverview.Report", "definition.pbir"), "utf8")).toContain("byPath");
    expect(await readFile(path.join(modelDir, "definition", "tables", "Sales.tmdl"), "utf8")).toContain("partition");
    const tmdl = await readFile(path.join(modelDir, "definition", "tables", "Sales.tmdl"), "utf8");
    expect(tmdl).not.toContain("description:");
    expect(tmdl).toContain("measure 'Row Count'");
    const pages = JSON.parse(await readFile(path.join(temp, "SalesOverview.Report", "definition", "pages", "pages.json"), "utf8")) as { pageOrder: string[] };
    expect(pages.pageOrder).toEqual(["overview"]);
  });
});
