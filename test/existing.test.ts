import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractReferenceProfile } from "../src/report/existing";

let temp: string | undefined;
afterEach(async () => {
  if (temp) await rm(temp, { recursive: true, force: true });
  temp = undefined;
});

describe("reference report extraction", () => {
  it("reads pages, visual types, text, and the base theme", async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), "pbi-flow-ref-"));
    const report = path.join(temp, "Ref.Report");
    const page = "page1";
    await mkdir(path.join(report, "definition", "pages", page, "visuals", "v1"), { recursive: true });
    await writeFile(
      path.join(report, "definition", "report.json"),
      JSON.stringify({ themeCollection: { baseTheme: { name: "CY24SU06" } } }),
      "utf8",
    );
    await writeFile(
      path.join(report, "definition", "pages", "pages.json"),
      JSON.stringify({ pageOrder: [page], activePageName: page }),
      "utf8",
    );
    await writeFile(
      path.join(report, "definition", "pages", page, "page.json"),
      JSON.stringify({ name: page, displayName: "Overview", width: 1280, height: 720 }),
      "utf8",
    );
    await writeFile(
      path.join(report, "definition", "pages", page, "visuals", "v1", "visual.json"),
      JSON.stringify({
        name: "v1",
        position: { x: 10, y: 10, width: 300, height: 120 },
        visual: {
          visualType: "textbox",
          objects: {
            general: [{ properties: { paragraphs: [{ textRuns: [{ value: "Sales Overview" }] }] } }],
          },
        },
      }),
      "utf8",
    );

    const profile = await extractReferenceProfile(report);
    expect(profile.reportName).toBe("Ref");
    expect(profile.baseTheme).toBe("CY24SU06");
    expect(profile.pages).toHaveLength(1);
    expect(profile.pages[0]?.displayName).toBe("Overview");
    expect(profile.pages[0]?.visuals[0]?.type).toBe("textbox");
    expect(profile.pages[0]?.visuals[0]?.text).toBe("Sales Overview");
  });
});
