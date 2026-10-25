import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { profileLocalFile } from "../src/data/localFiles";

let temp: string | undefined;
afterEach(async () => {
  if (temp) await rm(temp, { recursive: true, force: true });
  temp = undefined;
});

describe("local file profiling", () => {
  it("profiles a CSV and stages a canonical copy", async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), "pbi-flow-local-"));
    const source = path.join(temp, "sales.csv");
    await writeFile(
      source,
      "OrderDate,Region,Revenue\n2024-01-01,North,10.5\n2024-01-02,South,20\n2024-01-03,North,30\n",
      "utf8",
    );
    const result = await profileLocalFile(source, path.join(temp, "data"));
    const table = result.profile.tables[0]!;
    expect(table.name).toBe("sales");
    expect(table.rows).toBe(3);
    expect(table.columns.map((column) => column.type)).toEqual(["date", "string", "double"]);
    expect(table.partition.kind).toBe("csv");
    if (table.partition.kind === "csv") {
      expect(await readFile(table.partition.path, "utf8")).toContain("North");
    }
  });

  it("rejects unsupported file types", async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), "pbi-flow-local-"));
    const source = path.join(temp, "notes.txt");
    await writeFile(source, "hello", "utf8");
    await expect(profileLocalFile(source, path.join(temp, "data"))).rejects.toThrow(/Unsupported local file type/);
  });
});
