import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelSpec } from "../src/core/types";
import { buildModel, enforceNoIsKey, stripIsKeyDeclarations } from "../src/model/tmdl";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("TMDL model builder", () => {
  it("writes a V3 model and keeps Windows paths single-escaped in M expressions", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "pbi-tmdl-"));
    directories.push(directory);
    const model: ModelSpec = {
      name: "SalesOverview",
      relationships: [],
      parameters: [],
      tables: [
        {
          name: "Sales",
          columns: [
            { name: "Region", sourceName: "Region", type: "string" },
            { name: "Revenue", sourceName: "Revenue", type: "double" },
          ],
          measures: [],
          partition: {
            kind: "csv",
            path: "C:\\data\\Sales.csv",
          },
        },
      ],
    };

    await buildModel(directory, model);

    const modelTmdl = await readFile(path.join(directory, "definition", "model.tmdl"), "utf8");
    expect(modelTmdl).toContain("defaultPowerBIDataSourceVersion: powerBI_V3");

    const tableTmdl = await readFile(path.join(directory, "definition", "tables", "Sales.tmdl"), "utf8");
    expect(tableTmdl).toContain('File.Contents("C:\\data\\Sales.csv")');
    expect(tableTmdl).not.toContain("C:\\\\Users");
    expect(tableTmdl).toContain("mode: import");
    expect(tableTmdl).toContain("\r\n");
    expect(tableTmdl.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("never writes isKey declarations and strips them at the write boundary", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "pbi-tmdl-dim-"));
    directories.push(directory);
    const model: ModelSpec = {
      name: "SalesOverview",
      relationships: [
        {
          fromTable: "Sales",
          fromColumn: "Region",
          toTable: "DimRegion",
          toColumn: "Region",
          cardinality: "manyToOne",
        },
      ],
      parameters: [],
      tables: [
        {
          name: "Sales",
          columns: [
            { name: "Region", sourceName: "Region", type: "string", isKey: true },
            { name: "Product", sourceName: "Product", type: "string", isKey: true },
            { name: "Revenue", sourceName: "Revenue", type: "double" },
          ],
          measures: [],
          partition: { kind: "csv", path: "C:\\data\\Sales.csv" },
        },
        {
          name: "DimRegion",
          columns: [{ name: "Region", sourceName: "Region", type: "string" }],
          measures: [],
          partition: {
            kind: "m",
            expression: 'let Source = Sales, Distinct = Table.Distinct(Source) in Distinct',
          },
        },
      ],
    };

    await buildModel(directory, model);

    const salesTmdl = await readFile(path.join(directory, "definition", "tables", "Sales.tmdl"), "utf8");
    expect(salesTmdl).not.toMatch(/^\s*isKey\s*$/m);
    expect(salesTmdl).toContain("sourceColumn: Region");

    const dimensionTmdl = await readFile(path.join(directory, "definition", "tables", "DimRegion.tmdl"), "utf8");
    expect(dimensionTmdl).not.toMatch(/^\s*isKey\s*$/m);
    expect(dimensionTmdl).toContain("partition 'DimRegion-Partition' = m");
    expect(dimensionTmdl).toContain("Table.Distinct");
    expect(dimensionTmdl).toContain("sourceColumn: Region");
  });

  it("removes any isKey line from TMDL content", () => {
    expect(stripIsKeyDeclarations("column Region\n\t\tisKey\n\t\tdataType: string\n")).toBe(
      "column Region\n\t\tdataType: string\n",
    );
  });

  it("post-build check rewrites any TMDL file that still contains isKey", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "pbi-tmdl-check-"));
    directories.push(directory);
    const model: ModelSpec = {
      name: "Check",
      relationships: [],
      parameters: [],
      tables: [
        {
          name: "Sales",
          columns: [{ name: "Region", sourceName: "Region", type: "string" }],
          measures: [],
          partition: { kind: "csv", path: "C:\\data\\Sales.csv" },
        },
      ],
    };
    await buildModel(directory, model);
    const file = path.join(directory, "definition", "tables", "Sales.tmdl");
    await writeFile(file, "table Sales\n\tcolumn Region\n\t\tisKey\n", "utf8");

    const changed = await enforceNoIsKey(directory);
    expect(changed).toEqual([path.join("definition", "tables", "Sales.tmdl")]);
    expect(await readFile(file, "utf8")).not.toMatch(/^\s*isKey\s*$/m);
  });
});
