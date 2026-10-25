import { describe, expect, it } from "vitest";
import {
  applyBackgroundDeclarations,
  defaultReportSpec,
  parseReportSpecText,
  reportSpecToDesignBrief,
} from "../src/report/spec";
import { specFromImageLayout, specFromImageLayouts } from "../src/report/image";
import { buildSpecMessages } from "../src/llm/prompts";
import type { DataProfile, FlowConfig } from "../src/core/types";

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
        { name: "Revenue", sourceName: "Revenue", type: "double" },
      ],
      measures: [{ table: "Sales", name: "Total Revenue", expression: "SUM(Sales[Revenue])" }],
      partition: { kind: "csv", path: "data/Sales.csv" },
    },
  ],
};

describe("defaultReportSpec", () => {
  it("produces a page with KPI, chart, and detail visuals", () => {
    const spec = defaultReportSpec(profile, { title: "Sales Overview" });
    expect(spec.pages).toHaveLength(1);
    expect(spec.pages[0]!.placements.some((placement) => placement.kind === "card")).toBe(true);
    expect(spec.pages[0]!.placements.some((placement) => placement.kind === "tableEx")).toBe(true);
    expect(spec.colorMap["Total Revenue"]).toMatch(/^#/);
  });

  it("creates the requested number of distinct pages", () => {
    const spec = defaultReportSpec(profile, { pageCount: 4 });
    expect(spec.pages).toHaveLength(4);
    expect(spec.pages.map((page) => page.name)).toEqual(["overview", "breakdown", "trend", "detail_4"]);
    expect(spec.pages[1]!.placements.some((placement) => placement.kind === "donutChart")).toBe(true);
    expect(spec.pages[2]!.placements.some((placement) => placement.kind === "lineChart")).toBe(true);
  });

  it("applies per-page background declarations from YAML", () => {
    const spec = defaultReportSpec(profile, { pageCount: 2 });
    const applied = applyBackgroundDeclarations(
      spec,
      "overview:\n  image: assets/overview.png\n  scaling: Fill\nbreakdown:\n  color: '#0B1F33'\n",
    );
    expect(applied.warnings).toEqual([]);
    expect(applied.spec.pages[0]?.background).toEqual({ image: "assets/overview.png", scaling: "Fill" });
    expect(applied.spec.pages[1]?.background).toEqual({ color: "#0B1F33" });
  });

  it("accepts page background declarations in an array", () => {
    const spec = defaultReportSpec(profile, { pageCount: 2 });
    const applied = applyBackgroundDeclarations(spec, "- page: 1\n  color: '#112233'\n- page: 2\n  image: bg.png\n");
    expect(applied.spec.pages[0]?.background).toEqual({ color: "#112233" });
    expect(applied.spec.pages[1]?.background).toEqual({ image: "bg.png" });
  });

  it("accepts plain-text background declarations", () => {
    const spec = defaultReportSpec(profile, { pageCount: 2 });
    const applied = applyBackgroundDeclarations(
      spec,
      "第 1 页背景图: assets/cn.png\nbreakdown background: #0B1F33\n",
    );
    expect(applied.warnings).toEqual([]);
    expect(applied.spec.pages[0]?.background).toEqual({ image: "assets/cn.png" });
    expect(applied.spec.pages[1]?.background).toEqual({ color: "#0B1F33" });
  });

  it("serializes a design brief that can be parsed back", () => {
    const spec = defaultReportSpec(profile);
    const yaml = reportSpecToDesignBrief(spec);
    const parsed = parseReportSpecText(yaml);
    expect(parsed.title).toBe(spec.title);
    expect(parsed.pages[0]?.name).toBe(spec.pages[0]?.name);
    expect(parsed.pages[0]?.placements.length).toBe(spec.pages[0]?.placements.length);
    expect(parsed.pages[0]?.placements[0]?.fieldBindings).toEqual(spec.pages[0]?.placements[0]?.fieldBindings);
  });
});

describe("image layout", () => {
  it("converts normalized bounding boxes into positioned visuals", () => {
    const spec = specFromImageLayout(
      {
        canvas: { width: 1280, height: 720 },
        palette: ["#2E86AB", "#E6553A"],
        elements: [
          { type: "card", bbox: { x: 0.02, y: 0.1, width: 0.25, height: 0.2 }, title: "Revenue", suggestedField: "Total Revenue" },
          { type: "bar", bbox: { x: 0.02, y: 0.4, width: 0.5, height: 0.5 }, title: "Revenue by Region" },
          { type: "text", bbox: { x: 0.02, y: 0.02, width: 0.6, height: 0.06 }, title: "Sales Overview" },
        ],
      },
      profile,
    );
    expect(spec.pages[0]?.placements).toHaveLength(3);
    expect(spec.pages[0]?.placements[0]?.kind).toBe("card");
    expect(spec.pages[0]?.placements[0]?.fieldBindings[0]?.field).toBe("Total Revenue");
    expect(spec.pages[0]?.placements[1]?.position?.x).toBeGreaterThan(0);
  });

  it("converts multiple image layouts into multiple pages", () => {
    const spec = specFromImageLayouts(
      [
        { name: "image_1", display_name: "Page 1", elements: [{ type: "card", bbox: { x: 0.1, y: 0.1 } }] },
        { name: "image_2", display_name: "Page 2", elements: [{ type: "bar", bbox: { x: 0.2, y: 0.2 } }] },
      ],
      profile,
    );
    expect(spec.pages).toHaveLength(2);
    expect(spec.pages[0]?.name).toBe("image_1");
    expect(spec.pages[1]?.displayName).toBe("Page 2");
    expect(spec.pages[1]?.placements[0]?.kind).toBe("clusteredBarChart");
  });
});

describe("skill context", () => {
  it("is appended to the system prompt when supplied", () => {
    const config: FlowConfig = {
      projectName: "Test",
      outputDir: "powerbi-flow",
      dataMode: "mock",
      reportMode: "text",
      seed: 1,
    };
    const messages = buildSpecMessages(config, profile, undefined, "OFFICIAL-SKILL-MARKER");
    expect(messages[0]?.content).toContain("OFFICIAL-SKILL-MARKER");
    expect(messages[0]?.content).toContain("Official Power BI report skill guidance");
  });
});
