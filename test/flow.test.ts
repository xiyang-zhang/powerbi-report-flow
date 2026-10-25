import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlowController } from "../src/flow/FlowController";
import { setConfigValues, setWorkspaceFolder } from "./mocks/vscode";

let workspace: string | undefined;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "pbi-flow-e2e-"));
  setWorkspaceFolder(workspace);
  setConfigValues({
    "outputDir": "out",
    "llm.provider": "copilot",
    "llm.model": "",
    "llm.baseUrl": "https://api.openai.com/v1",
    "preview.host": "none",
    "mcp.eulaAccepted": true,
    "mock.maxRows": 50000,
  });
});

afterEach(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true });
  workspace = undefined;
});

describe("FlowController end-to-end", () => {
  it("profiles mock data, generates an approved spec, builds, and validates", async () => {
    const extensionPath = path.resolve(".");
    const context = {
      extensionPath,
      globalStorageUri: { fsPath: path.join(workspace!, "storage") },
      secrets: {
        get: async () => undefined,
        store: async () => undefined,
      },
      subscriptions: [],
    };
    const controller = new FlowController(context as never, extensionPath);
    controller.updateConfig({
      projectName: "E2E",
      outputDir: "out",
      dataMode: "mock",
      reportMode: "text",
      pageCount: 1,
      textBrief: "Create a one-page sales overview with KPIs and a detail table.",
      mockSchema: {
        seed: 3,
        tables: [
          {
            name: "Sales",
            rows: 12,
            columns: [
              { name: "Region", type: "string", values: ["North", "South"] },
              { name: "Revenue", type: "double", min: 10, max: 100 },
            ],
          },
        ],
      },
    });

    const specState = await controller.generateSpec();
    expect(specState.phase).toBe("awaitingApproval");
    expect(specState.reportSpec?.pages.length).toBe(1);
    const brief = path.join(workspace!, "out", "E2E", "_brief");
    expect((await stat(path.join(brief, "report-spec.md"))).isFile()).toBe(true);
    expect((await stat(path.join(brief, "design-brief.yaml"))).isFile()).toBe(true);

    const built = await controller.approveAndBuild();
    expect(built.phase).toBe("done");
    const root = path.join(workspace!, "out", "E2E");
    expect((await stat(path.join(root, "E2E.pbip"))).isFile()).toBe(true);
    expect((await stat(path.join(root, "E2E.Report", "definition.pbir"))).isFile()).toBe(true);
    expect((await stat(path.join(root, "E2E.SemanticModel", "definition", "tables", "Sales.tmdl"))).isFile()).toBe(true);
    const validation = JSON.parse(await readFile(path.join(root, "validation", "validate-result.json"), "utf8")) as {
      result: string;
    };
    expect(validation.result).toBe("succeeded");
    expect(built.log.some((line) => line.includes("MCP loaded the model"))).toBe(true);
  }, 120_000);
});
