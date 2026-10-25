import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readDocumentContext } from "../src/data/documents";

let temp: string | undefined;
afterEach(async () => {
  if (temp) await rm(temp, { recursive: true, force: true });
  temp = undefined;
});

describe("document context", () => {
  it("reads text and image attachments into one context", async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), "pbi-flow-docs-"));
    const brief = path.join(temp, "brief.md");
    const image = path.join(temp, "layout.png");
    await writeFile(brief, "# Dashboard brief\nUse a bar chart for revenue.");
    await writeFile(image, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const result = await readDocumentContext([brief, image, path.join(temp, "missing.pdf")]);
    expect(result.text).toContain("Use a bar chart for revenue.");
    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.mimeType).toBe("image/png");
    expect(result.warnings.some((warning) => warning.includes("Unsupported document type"))).toBe(true);
  });

  it("warns instead of failing on an unreadable document", async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), "pbi-flow-docs-"));
    const result = await readDocumentContext([path.join(temp, "missing.txt")]);
    expect(result.text).toBe("");
    expect(result.warnings[0]).toContain("could not be read");
  });
});
