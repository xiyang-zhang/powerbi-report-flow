import { describe, expect, it } from "vitest";
import type { DataProfile, FlowConfig } from "../src/core/types";
import type { LlmImage, LlmProvider, LlmRequest } from "../src/llm/provider";
import { generateReportSpec } from "../src/report/generate";

const profile: DataProfile = {
  sourceMode: "mock",
  sourceLabel: "test",
  parameters: [],
  warnings: [],
  relationships: [],
  tables: [
    {
      name: "Sales",
      columns: [
        { name: "Region", sourceName: "Region", type: "string" },
        { name: "Revenue", sourceName: "Revenue", type: "double" },
      ],
      measures: [{ table: "Sales", name: "Total Revenue", expression: "SUM(Sales[Revenue])" }],
      partition: { kind: "m", expression: "let Source = #table({}, {}) in Source" },
    },
  ],
};

const image: LlmImage = { data: new Uint8Array([1, 2, 3]), mimeType: "image/png" };

function config(mode: FlowConfig["reportMode"]): FlowConfig {
  return {
    projectName: "Test",
    outputDir: "out",
    dataMode: "mock",
    reportMode: mode,
    seed: 1,
    pageCount: 2,
    tone: "clean",
    audience: "test",
    textBrief: "Two page report",
  };
}

function fakeProvider(response: string, calls: LlmRequest[]): LlmProvider {
  return {
    id: "fake",
    async complete(request) {
      calls.push(request);
      return response;
    },
  };
}

describe("generateReportSpec multimodal context", () => {
  it("forwards document images in text mode", async () => {
    const calls: LlmRequest[] = [];
    const provider = fakeProvider(
      JSON.stringify({
        title: "Test",
        summary: "test",
        pages: [
          {
            name: "overview",
            displayName: "Overview",
            role: "overview",
            regions: {},
            placements: [
              { id: "title", region: "header", kind: "textbox", text: "Test", fieldBindings: [] },
            ],
          },
        ],
      }),
      calls,
    );

    const result = await generateReportSpec({
      config: config("text"),
      profile,
      llm: provider,
      images: [image],
      contextText: "Attached reference document",
    });

    expect(result.usedLlm).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.images).toHaveLength(1);
    expect(calls[0]?.images?.[0]).toBe(image);
    expect(calls[0]?.messages.some((message) => message.content.includes("Attached reference document"))).toBe(true);
  });

  it("sends every image and creates at least one page per image in image mode", async () => {
    const calls: LlmRequest[] = [];
    const provider = fakeProvider(
      JSON.stringify({
        pages: [
          {
            name: "one",
            display_name: "One",
            elements: [{ id: "kpi", type: "card", title: "KPI" }],
          },
          {
            name: "two",
            display_name: "Two",
            elements: [{ id: "chart", type: "bar", title: "Chart" }],
          },
        ],
      }),
      calls,
    );

    const result = await generateReportSpec({
      config: config("image"),
      profile,
      llm: provider,
      images: [image, image],
    });

    expect(result.usedLlm).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.images).toHaveLength(2);
    expect(result.spec.pages.length).toBeGreaterThanOrEqual(2);
  });
});
