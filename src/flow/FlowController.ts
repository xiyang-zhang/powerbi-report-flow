import { copyFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import * as vscode from "vscode";
import type {
  DataProfile,
  DependencyStatus,
  FlowConfig,
  FlowState,
  MockSchema,
  ReportSpec,
} from "../core/types";
import { parseMockSchema, sanitizeIdentifier } from "../core/schemas";
import { ensureDir, sha256, writeJson, writeText } from "../core/util";
import { ReportAuthorCli } from "../cli/reportAuthor";
import { PowerBiMcpBridge } from "../mcp/client";
import { localProfileForBuild, profileFlowData } from "./profile";
import { buildModel } from "../model/tmdl";
import { addDimensionTables } from "../model/dimensions";
import { toModelSpec } from "../data/infer";
import { createPbip, buildReport } from "../report/pbir";
import { reportSpecToDesignBrief, reportSpecToMarkdown } from "../report/spec";
import { generateReportSpec } from "../report/generate";
import { extractReferenceProfile, type ReferenceProfile } from "../report/existing";
import { validateReport, previewReport } from "../report/validate";
import { checkDependencies } from "./dependencies";
import { CopilotProvider } from "../llm/copilot";
import { OpenAiProvider } from "../llm/openai";
import type { LlmImage, LlmProvider } from "../llm/provider";
import { readDocumentContext } from "../data/documents";
import { loadSkillContext } from "../skills/loader";

type Listener = (state: FlowState) => void;

export class FlowController {
  private state: FlowState = { phase: "idle", message: "Ready", log: [] };
  private config: FlowConfig;
  private projectRoot?: string;
  private cancelled = false;
  private readonly listeners = new Set<Listener>();
  private readonly cli: ReportAuthorCli;
  private readonly mcp: PowerBiMcpBridge;
  private referenceProfile?: ReferenceProfile;
  private imageData?: LlmImage;
  private images: LlmImage[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly extensionPath: string,
  ) {
    this.cli = new ReportAuthorCli(extensionPath);
    this.mcp = new PowerBiMcpBridge(extensionPath, path.join(context.globalStorageUri.fsPath, "mcp-audit"));
    this.config = this.defaultConfig();
  }

  getState(): FlowState {
    return this.state;
  }

  getConfig(): FlowConfig {
    return this.config;
  }

  getCli(): ReportAuthorCli {
    return this.cli;
  }

  getProjectRoot(): string | undefined {
    return this.projectRoot;
  }

  subscribe(listener: Listener): vscode.Disposable {
    this.listeners.add(listener);
    listener(this.state);
    return new vscode.Disposable(() => this.listeners.delete(listener));
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }

  private log(message: string): void {
    this.state.log = [...this.state.log, `[${new Date().toISOString()}] ${message}`].slice(-500);
    this.emit();
  }

  private setPhase(phase: FlowState["phase"], message: string): void {
    this.state.phase = phase;
    this.state.message = message;
    this.emit();
  }

  private defaultConfig(): FlowConfig {
    const settings = vscode.workspace.getConfiguration("powerbiFlow");
    return {
      projectName: "SalesOverview",
      outputDir: settings.get<string>("outputDir", "powerbi-flow"),
      dataMode: "mock",
      reportMode: "text",
      seed: 42,
      pageCount: 3,
      tone: "clean, executive, high-contrast",
      audience: "business stakeholders",
      textBrief:
        "Create a multi-page analytical report with headline KPIs, a breakdown page, a trend page, and supporting detail.",
      mockSchema: {
        seed: 42,
        tables: [
          {
            name: "Sales",
            rows: 500,
            columns: [
              { name: "OrderDate", type: "date", start: "2023-01-01", end: "2025-12-31" },
              { name: "Region", type: "string", values: ["North", "South", "East", "West"] },
              { name: "Product", type: "string", values: ["Alpha", "Beta", "Gamma", "Delta"] },
              { name: "Revenue", type: "double", min: 100, max: 10000 },
              { name: "Units", type: "int64", min: 1, max: 100 },
            ],
            keys: ["Region", "Product"],
          },
        ],
      },
    };
  }

  updateConfig(input: Partial<FlowConfig> & { mockSchemaText?: string; localFile?: string }): void {
    const next: FlowConfig = { ...this.config, ...input };
    if (input.mockSchemaText) {
      try {
        next.mockSchema = parseMockSchema(JSON.parse(input.mockSchemaText)) as MockSchema;
      } catch (error) {
        this.log(`Mock schema is invalid: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (input.projectName) next.projectName = sanitizeIdentifier(input.projectName, "Report");
    this.config = next;
    this.state.config = next;
    this.emit();
  }

  getBriefDir(): string {
    const root = this.getProjectRoot();
    if (!root) throw new Error("Open a workspace folder before running the flow.");
    return path.join(root, "_brief");
  }

  getProjectRootPath(): string {
    if (this.projectRoot) return this.projectRoot;
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspace) throw new Error("Open a workspace folder before running the flow.");
    const name = sanitizeIdentifier(this.config.projectName, "Report");
    const output = path.isAbsolute(this.config.outputDir)
      ? this.config.outputDir
      : path.join(workspace, this.config.outputDir);
    this.projectRoot = path.join(output, name);
    return this.projectRoot;
  }

  private async ensureProject(): Promise<{ root: string; brief: string; reportName: string }> {
    const root = this.getProjectRootPath();
    const brief = path.join(root, "_brief");
    await ensureDir(brief);
    return { root, brief, reportName: sanitizeIdentifier(this.config.projectName, "Report") };
  }

  private async getLlmProvider(): Promise<LlmProvider | undefined> {
    const settings = vscode.workspace.getConfiguration("powerbiFlow");
    const provider = settings.get<string>("llm.provider", "copilot");
    if (provider === "openai") {
      const apiKey =
        (await this.context.secrets.get("powerbiFlow.openai.apiKey")) ?? process.env.OPENAI_API_KEY ?? "";
      if (!apiKey) {
        this.log("OpenAI-compatible provider selected, but no API key is stored. Generated a deterministic default layout.");
        return undefined;
      }
      return new OpenAiProvider(
        settings.get<string>("llm.baseUrl", "https://api.openai.com/v1"),
        apiKey,
        settings.get<string>("llm.model", ""),
      );
    }
    try {
      return new CopilotProvider();
    } catch (error) {
      this.log(`Copilot LM API unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  async profileData(): Promise<DataProfile> {
    const { brief } = await this.ensureProject();
    this.setPhase("profiling", "Profiling data…");
    const profile = await profileFlowData(this.config, brief);
    this.state.dataProfile = profile;
    await writeJson(path.join(brief, "data-profile.json"), profile);
    for (const warning of profile.warnings) this.log(warning);
    this.log(`Profiled ${profile.tables.length} table(s) from ${profile.sourceLabel}.`);
    return profile;
  }

  async generateSpec(): Promise<FlowState> {
    this.cancelled = false;
    try {
      const { root, brief } = await this.ensureProject();
      const profile = this.state.dataProfile ?? (await this.profileData());
      this.setPhase("spec", "Building the design contract…");
      this.referenceProfile = undefined;
      this.imageData = undefined;
      this.images = [];

      if (this.config.reportMode === "existing") {
        if (!this.config.referenceReport) throw new Error("Select an existing PBIR report folder for reference mode.");
        this.log(`Extracting reference profile from ${this.config.referenceReport}…`);
        this.referenceProfile = await extractReferenceProfile(this.config.referenceReport);
        for (const warning of this.referenceProfile.warnings) this.log(warning);
        await writeJson(path.join(brief, "reference-profile.json"), this.referenceProfile);
      }

      if (this.config.reportMode === "image") {
        const imagePaths = this.config.imageFiles?.length
          ? this.config.imageFiles
          : this.config.imageFile
            ? [this.config.imageFile]
            : [];
        if (imagePaths.length === 0) throw new Error("Select at least one PNG, JPEG, or WebP image for image report mode.");
        for (const imagePath of imagePaths) {
          const image = await readImage(imagePath);
          this.images.push(image);
          this.log(`Loaded image ${path.basename(imagePath)} (${image.mimeType}).`);
        }
      }

      let contextText: string | undefined;
      if (this.config.contextDocuments?.length) {
        const documents = await readDocumentContext(this.config.contextDocuments);
        contextText = documents.text || undefined;
        for (const warning of documents.warnings) this.log(warning);
        if (documents.text) this.log(`Loaded document context (${documents.text.length} characters).`);
        if (documents.images.length > 0) {
          this.images.push(...documents.images);
          this.log(`Loaded ${documents.images.length} image(s) from attached documents.`);
        }
      }

      const llm = await this.getLlmProvider();
      const skillContext = loadSkillContext(this.extensionPath);
      const generated = await generateReportSpec({
        config: this.config,
        profile,
        llm,
        referenceProfile: this.referenceProfile,
        image: this.images[0],
        images: this.images,
        contextText,
        skillContext,
      });
      const spec = generated.spec;
      this.state.reportSpec = spec;
      for (const warning of generated.warnings) this.log(warning);

      const designBrief = reportSpecToDesignBrief(spec);
      await writeText(path.join(brief, "report-spec.md"), reportSpecToMarkdown(spec));
      await writeText(path.join(brief, "design-brief.yaml"), designBrief);
      await writeJson(path.join(brief, "build-manifest.json"), {
        version: 1,
        generatedAt: new Date().toISOString(),
        projectName: this.config.projectName,
        sourceMode: this.config.dataMode,
        reportMode: this.config.reportMode,
        llmProvider: vscode.workspace.getConfiguration("powerbiFlow").get("llm.provider", "copilot"),
        specHash: sha256(designBrief),
        reportDir: path.join(root, `${sanitizeIdentifier(this.config.projectName, "Report")}.Report`),
        modelDir: path.join(root, `${sanitizeIdentifier(this.config.projectName, "Report")}.SemanticModel`),
        warnings: [...profile.warnings, ...generated.warnings],
      });
      this.state.specHash = sha256(designBrief);
      this.setPhase("awaitingApproval", "Review the spec, then approve and build.");
      this.log("Design contract written to _brief/report-spec.md and _brief/design-brief.yaml.");
      return this.state;
    } catch (error) {
      return this.fail(error);
    }
  }

  async approveAndBuild(): Promise<FlowState> {
    this.cancelled = false;
    try {
      const { root, brief, reportName } = await this.ensureProject();
      if (!this.state.reportSpec) throw new Error("Generate a design contract before building.");
      const designBrief = reportSpecToDesignBrief(this.state.reportSpec);
      const hash = sha256(designBrief);
      if (this.state.specHash && hash !== this.state.specHash) {
        this.log("The design contract changed after generation; re-approving the current content.");
      }
      await writeJson(path.join(brief, "approved.json"), {
        approvedAt: new Date().toISOString(),
        specHash: hash,
        projectName: reportName,
      });
      this.state.specHash = hash;
      return await this.build();
    } catch (error) {
      return this.fail(error);
    }
  }

  private async build(): Promise<FlowState> {
    const { root, brief, reportName } = await this.ensureProject();
    this.setPhase("building", "Building the PBIP project…");
    const warnings: string[] = [];
    const dataDir = path.join(root, "data");
    await ensureDir(dataDir);
    await rm(path.join(root, "data"), { recursive: true, force: true });
    await ensureDir(dataDir);

    let profile: DataProfile;
    if (this.config.dataMode === "mock") {
      if (!this.config.mockSchema) throw new Error("Mock schema is missing.");
      profile = await localProfileForBuild(this.config, dataDir);
    } else if (this.config.dataMode === "local") {
      profile = await localProfileForBuild(this.config, dataDir);
    } else {
      if (!this.state.dataProfile) throw new Error("Profile the external source before building.");
      profile = this.state.dataProfile;
    }
    this.state.dataProfile = profile;

    const scaffold = await this.cli.scaffold(root, reportName, `../${reportName}.SemanticModel`, root);
    if (scaffold.code === 0) {
      this.log("Created a PBIP baseline with powerbi-report-author scaffold.");
    } else {
      warnings.push(`Scaffold was unavailable (${scaffold.stderr.trim() || "CLI not found"}); the built-in PBIR writer was used.`);
      this.log(warnings[warnings.length - 1]!);
    }

    const modelDir = path.join(root, `${reportName}.SemanticModel`);
    let model = toModelSpec(profile, reportName);
    const autoDimensions = vscode.workspace
      .getConfiguration("powerbiFlow")
      .get<boolean>("model.autoDimensions", true);
    if (autoDimensions) {
      const dimensioned = addDimensionTables(model);
      model = dimensioned.model;
      warnings.push(...dimensioned.warnings);
      if (dimensioned.addedTables.length > 0) {
        this.log(`Added M-query dimension table(s): ${dimensioned.addedTables.join(", ")}.`);
      }
    }
    const sanitizedTmdl = await buildModel(modelDir, model);
    if (sanitizedTmdl.length > 0) {
      this.log(`Removed unsupported isKey declaration(s) from ${sanitizedTmdl.join(", ")}.`);
    }
    this.log(`Wrote semantic model with ${model.tables.length} table(s) and ${model.relationships.length} relationship(s).`);

    const reportBuild = await buildReport(root, reportName, this.state.reportSpec!, model.tables);
    warnings.push(...reportBuild.warnings);
    this.log(`Wrote report with ${reportBuild.visualCount} visual(s).`);
    await createPbip(root, reportName);

    await writeJson(path.join(brief, "build-manifest.json"), {
      version: 1,
      generatedAt: new Date().toISOString(),
      projectName: reportName,
      sourceMode: this.config.dataMode,
      reportMode: this.config.reportMode,
      llmProvider: vscode.workspace.getConfiguration("powerbiFlow").get("llm.provider", "copilot"),
      specHash: this.state.specHash,
      reportDir: reportBuild.reportDir,
      modelDir,
      warnings,
    });

    if (this.cancelled) return this.fail(new Error("Build cancelled."));

    this.setPhase("validating", "Validating PBIR…");
    const validation = await validateReport(this.cli, root, reportName);
    this.state.validation = {
      result: validation.result,
      errors: validation.errors,
      warnings: [...validation.warnings, ...warnings],
    };
    await writeJson(path.join(root, "validation", "validate-result.json"), validation);

    if (!this.cli.resolvePath()) {
      this.setPhase("blocked", "PBIR written, but validation is blocked because powerbi-report-author was not found.");
      return this.state;
    }
    if (validation.errors.length > 0) {
      this.setPhase("blocked", `PBIR written, but validation reported ${validation.errors.length} error(s).`);
      for (const error of validation.errors.slice(0, 20)) this.log(`Validation: ${error}`);
      return this.state;
    }

    this.log("PBIR validation succeeded.");
    const mcpEnabled = vscode.workspace.getConfiguration("powerbiFlow").get<boolean>("mcp.eulaAccepted", false);
    if (mcpEnabled) {
      this.log("Power BI Authoring MCP is enabled; loading the generated TMDL for verification…");
      const status = await this.mcp.start(true);
      if (status.available) {
        this.log(`MCP connected: ${status.toolCount} tools available.`);
        const verification = await this.mcp.verifyModel(modelDir);
        if (verification.ok) {
          this.log(
            `MCP loaded the model: ${verification.tablesLoaded ?? 0} table(s), ${verification.measuresLoaded ?? 0} measure(s), ${verification.relationshipsLoaded ?? 0} relationship(s).`,
          );
        } else {
          await this.mcp.stop();
          this.setPhase("blocked", `PBIR validated, but MCP could not load the semantic model: ${verification.message}`);
          this.log(`MCP model verification failed: ${verification.message}`);
          return this.state;
        }
      } else {
        this.log(`MCP unavailable: ${status.error ?? "unknown error"}`);
        warnings.push(`MCP unavailable: ${status.error ?? "unknown error"}`);
      }
      await this.mcp.stop();
    }

    this.setPhase("done", "Report built and validated. Open the PBIP in Power BI Desktop.");
    return this.state;
  }

  async validateCurrent(): Promise<FlowState> {
    try {
      const root = this.getProjectRootPath();
      const reportName = sanitizeIdentifier(this.config.projectName, "Report");
      this.setPhase("validating", "Validating PBIR…");
      const validation = await validateReport(this.cli, root, reportName);
      this.state.validation = {
        result: validation.result,
        errors: validation.errors,
        warnings: validation.warnings,
      };
      await writeJson(path.join(root, "validation", "validate-result.json"), validation);
      if (!this.cli.resolvePath()) {
        this.setPhase("blocked", "Validation is blocked because powerbi-report-author was not found.");
      } else if (validation.errors.length > 0) {
        this.setPhase("blocked", `Validation reported ${validation.errors.length} error(s).`);
      } else {
        this.setPhase("done", "Validation succeeded.");
      }
      return this.state;
    } catch (error) {
      return this.fail(error);
    }
  }

  async previewCurrent(): Promise<FlowState> {
    try {
      const root = this.getProjectRootPath();
      const reportName = sanitizeIdentifier(this.config.projectName, "Report");
      const screenshotsDir = path.join(root, "validation", "screenshots");
      const preference = vscode.workspace.getConfiguration("powerbiFlow").get<"auto" | "desktop" | "none">("preview.host", "auto");
      this.setPhase("previewing", "Checking preview hosts…");
      const preview = await previewReport(this.cli, root, reportName, screenshotsDir, preference);
      this.state.screenshots = preview.screenshots;
      for (const warning of preview.warnings) this.log(warning);
      for (const error of preview.errors) this.log(`Preview: ${error}`);
      if (preview.blockedReason) {
        this.setPhase("blocked", preview.blockedReason);
      } else {
        this.setPhase("done", "Preview screenshots captured. Review them before publishing.");
      }
      return this.state;
    } catch (error) {
      return this.fail(error);
    }
  }

  async checkDependencies(): Promise<DependencyStatus> {
    const acceptEula = vscode.workspace.getConfiguration("powerbiFlow").get<boolean>("mcp.eulaAccepted", false);
    const dependencies = await checkDependencies(
      this.cli,
      this.mcp,
      this.extensionPath,
      vscode.version,
      acceptEula,
    );
    for (const warning of dependencies.warnings) this.log(warning);
    this.state.message = dependencies.warnings.length > 0 ? "Dependency check completed with warnings." : "All dependencies are available.";
    this.emit();
    return dependencies;
  }

  async openProject(): Promise<void> {
    const root = this.getProjectRootPath();
    await vscode.env.openExternal(vscode.Uri.file(root));
  }

  cancel(): void {
    this.cancelled = true;
    this.log("Cancellation requested; the flow will stop at the next safe point.");
  }

  private fail(error: unknown): FlowState {
    const message = error instanceof Error ? error.message : String(error);
    this.state.error = message;
    this.setPhase("error", message);
    this.log(`Error: ${message}`);
    return this.state;
  }
}

async function readImage(file: string): Promise<{ data: Uint8Array; mimeType: "image/png" | "image/jpeg" | "image/webp" }> {
  const ext = path.extname(file).toLowerCase();
  const mimeType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : undefined;
  if (!mimeType) throw new Error("Image report mode supports PNG, JPEG, or WebP files.");
  return { data: new Uint8Array(await readFile(file)), mimeType };
}
