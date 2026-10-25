import { rm } from "node:fs/promises";
import path from "node:path";
import type { MockSchema } from "../src/core/types";
import { generateMockData } from "../src/data/mock";
import { toModelSpec } from "../src/data/infer";
import { buildModel } from "../src/model/tmdl";
import { addDimensionTables } from "../src/model/dimensions";
import { buildReport, createPbip } from "../src/report/pbir";
import { defaultReportSpec } from "../src/report/spec";

const root = process.env.SMOKE_OUTPUT ? path.resolve(process.env.SMOKE_OUTPUT) : path.resolve("tmp", "sample-project");
await rm(root, { recursive: true, force: true });
const schema: MockSchema = {
  seed: 42,
  tables: [
    {
      name: "Sales",
      rows: 120,
      columns: [
        { name: "OrderDate", type: "date", start: "2024-01-01", end: "2024-12-31" },
        { name: "Region", type: "string", values: ["North", "South", "East", "West"] },
        { name: "Product", type: "string", values: ["Alpha", "Beta", "Gamma"] },
        { name: "Revenue", type: "double", min: 100, max: 10000 },
        { name: "Units", type: "int64", min: 1, max: 100 },
      ],
    },
  ],
};
const profile = await generateMockData(schema, path.join(root, "data"));
const modelDir = path.join(root, "SalesOverview.SemanticModel");
const model = addDimensionTables(toModelSpec(profile, "SalesOverview")).model;
await buildModel(modelDir, model);
const spec = defaultReportSpec(profile, { title: "Sales Overview" });
const report = await buildReport(root, "SalesOverview", spec, model.tables);
await createPbip(root, "SalesOverview");
console.log(JSON.stringify({ root, modelDir, report }, null, 2));
