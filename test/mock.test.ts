import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateMockData } from "../src/data/mock";
import { mockProfileFromSchema } from "../src/data/mockProfile";
import type { MockSchema } from "../src/core/types";

const schema: MockSchema = {
  seed: 7,
  tables: [
    {
      name: "Sales",
      rows: 25,
      columns: [
        { name: "Region", type: "string", values: ["North", "South"] },
        { name: "Revenue", type: "double", min: 10, max: 100 },
      ],
      keys: ["Region"],
    },
  ],
};

let temp: string | undefined;
afterEach(async () => {
  if (temp) await rm(temp, { recursive: true, force: true });
  temp = undefined;
});

describe("mock data", () => {
  it("builds a schema profile without generating data", () => {
    const profile = mockProfileFromSchema(schema);
    expect(profile.tables[0]?.name).toBe("Sales");
    expect(profile.tables[0]?.rows).toBe(25);
    expect(profile.tables[0]?.columns.map((column) => column.name)).toEqual(["Region", "Revenue"]);
  });

  it("retains only the first declared key as internal metadata", async () => {
    const multiKey: MockSchema = {
      seed: 1,
      tables: [
        {
          name: "Sales",
          rows: 3,
          columns: [
            { name: "Region", type: "string", values: ["North", "South"] },
            { name: "Product", type: "string", values: ["A", "B"] },
            { name: "Revenue", type: "double", min: 1, max: 2 },
          ],
          keys: ["Region", "Product"],
        },
      ],
    };
    const profile = mockProfileFromSchema(multiKey);
    expect(profile.tables[0]?.columns.filter((column) => column.isKey).map((column) => column.name)).toEqual([
      "Region",
    ]);
    expect(profile.warnings.join("\n")).toContain('only "Region" is retained');

    temp = await mkdtemp(path.join(os.tmpdir(), "pbi-flow-mock-keys-"));
    const generated = await generateMockData(multiKey, temp);
    expect(generated.tables[0]?.columns.filter((column) => column.isKey).map((column) => column.name)).toEqual([
      "Region",
    ]);
  });

  it("generates deterministic CSV data", async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), "pbi-flow-mock-"));
    const first = await generateMockData(schema, temp);
    const firstCsv = await readFile(first.tables[0]!.partition.kind === "csv" ? first.tables[0]!.partition.path : "", "utf8");
    const second = await generateMockData(schema, temp);
    const secondCsv = await readFile(second.tables[0]!.partition.kind === "csv" ? second.tables[0]!.partition.path : "", "utf8");
    expect(firstCsv).toBe(secondCsv);
    expect(firstCsv.split("\r\n").filter(Boolean)).toHaveLength(26);
  });
});
