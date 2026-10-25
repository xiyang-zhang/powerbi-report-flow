import path from "node:path";
import * as vscode from "vscode";
import type { DependencyStatus, FlowConfig } from "../core/types";
import type { FlowController } from "../flow/FlowController";

type WebviewMessage =
  | { type: "ready" }
  | { type: "updateConfig"; config: Partial<FlowConfig> & { mockSchemaText?: string } }
  | { type: "pickLocalFile" }
  | { type: "pickImage" }
  | { type: "pickImages" }
  | { type: "pickDocuments" }
  | { type: "pickReference" }
  | { type: "generateSpec" }
  | { type: "approveBuild" }
  | { type: "validate" }
  | { type: "preview" }
  | { type: "checkDependencies" }
  | { type: "openProject" }
  | { type: "openSpec" }
  | { type: "setApiKey" }
  | { type: "updateSettings"; settings: Record<string, unknown> }
  | { type: "cancel" };

export class FlowViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private lastDependencies?: DependencyStatus;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly controller: FlowController,
    private readonly extensionUri: vscode.Uri,
  ) {
    this.disposables.push(
      controller.subscribe(() => {
        void this.postState();
      }),
    );
  }

  async runAction(action: Extract<WebviewMessage["type"], "generateSpec" | "approveBuild" | "validate" | "preview" | "checkDependencies">): Promise<void> {
    if (action === "generateSpec") await this.controller.generateSpec();
    if (action === "approveBuild") await this.controller.approveAndBuild();
    if (action === "validate") await this.controller.validateCurrent();
    if (action === "preview") await this.controller.previewCurrent();
    if (action === "checkDependencies") this.lastDependencies = await this.controller.checkDependencies();
    await this.postState();
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist"), vscode.Uri.joinPath(this.extensionUri, "resources")],
    };
    webviewView.webview.html = this.html(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        try {
          await this.handleMessage(message);
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          void vscode.window.showErrorMessage(`Power BI Report Flow: ${text}`);
          await webviewView.webview.postMessage({ type: "error", message: text });
        }
      },
      undefined,
      this.disposables,
    );
    webviewView.onDidDispose(() => {
      this.view = undefined;
    });
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        await this.postState();
        return;
      case "updateConfig":
        this.controller.updateConfig(message.config);
        await this.postState();
        return;
      case "pickLocalFile": {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: "Use data file",
          filters: { "Data files": ["csv", "tsv", "xlsx", "xls", "json"], "All files": ["*"] },
        });
        if (picked?.[0]) {
          this.controller.updateConfig({ localFile: picked[0].fsPath, dataMode: "local" });
          await this.postState();
        }
        return;
      }
      case "pickImage": {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: true,
          openLabel: "Use image(s)",
          filters: { Images: ["png", "jpg", "jpeg", "webp"] },
        });
        if (picked && picked.length > 0) {
          const imageFiles = picked.map((uri) => uri.fsPath);
          this.controller.updateConfig({ imageFiles, imageFile: imageFiles[0], reportMode: "image" });
          await this.postState();
        }
        return;
      }
      case "pickImages": {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: true,
          openLabel: "Use image(s)",
          filters: { Images: ["png", "jpg", "jpeg", "webp"] },
        });
        if (picked && picked.length > 0) {
          const imageFiles = picked.map((uri) => uri.fsPath);
          this.controller.updateConfig({ imageFiles, imageFile: imageFiles[0], reportMode: "image" });
          await this.postState();
        }
        return;
      }
      case "pickDocuments": {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: true,
          openLabel: "Attach documents",
          filters: {
            Documents: ["txt", "md", "markdown", "json", "yaml", "yml", "csv", "tsv", "xml", "html", "docx", "pdf"],
            Images: ["png", "jpg", "jpeg", "webp"],
            "All files": ["*"],
          },
        });
        if (picked && picked.length > 0) {
          this.controller.updateConfig({ contextDocuments: picked.map((uri) => uri.fsPath) });
          await this.postState();
        }
        return;
      }
      case "pickReference": {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          canSelectFolders: true,
          openLabel: "Use report folder",
        });
        if (picked?.[0]) {
          this.controller.updateConfig({ referenceReport: picked[0].fsPath, reportMode: "existing" });
          await this.postState();
        }
        return;
      }
      case "generateSpec":
        await this.controller.generateSpec();
        await this.postState();
        return;
      case "approveBuild":
        await this.controller.approveAndBuild();
        await this.postState();
        return;
      case "validate":
        await this.controller.validateCurrent();
        await this.postState();
        return;
      case "preview":
        await this.controller.previewCurrent();
        await this.postState();
        return;
      case "checkDependencies":
        this.lastDependencies = await this.controller.checkDependencies();
        await this.postState();
        return;
      case "openProject":
        await this.controller.openProject();
        return;
      case "openSpec": {
        const root = this.controller.getProjectRootPath();
        const file = vscode.Uri.file(path.join(root, "_brief", "report-spec.md"));
        await vscode.commands.executeCommand("vscode.open", file);
        return;
      }
      case "setApiKey": {
        const value = await vscode.window.showInputBox({
          title: "OpenAI-compatible API key",
          password: true,
          ignoreFocusOut: true,
          prompt: "Stored in VS Code SecretStorage; never written to the project.",
        });
        if (value) {
          await this.context.secrets.store("powerbiFlow.openai.apiKey", value);
          await vscode.window.showInformationMessage("API key stored.");
          await this.postState();
        }
        return;
      }
      case "updateSettings": {
        const configuration = vscode.workspace.getConfiguration("powerbiFlow");
        const mapping: Record<string, string> = {
          provider: "llm.provider",
          model: "llm.model",
          baseUrl: "llm.baseUrl",
          eulaAccepted: "mcp.eulaAccepted",
        };
        for (const [key, value] of Object.entries(message.settings)) {
          const settingKey = mapping[key];
          if (settingKey) {
            await configuration.update(settingKey, value, vscode.ConfigurationTarget.Global);
          }
        }
        this.lastDependencies = undefined;
        await this.postState();
        return;
      }
      case "cancel":
        this.controller.cancel();
        await this.postState();
        return;
    }
  }

  private async postState(): Promise<void> {
    if (!this.view) return;
    const settings = vscode.workspace.getConfiguration("powerbiFlow");
    const apiKeyStored = Boolean(await this.context.secrets.get("powerbiFlow.openai.apiKey"));
    await this.view.webview.postMessage({
      type: "state",
      state: this.controller.getState(),
      config: this.controller.getConfig(),
      settings: {
        provider: settings.get("llm.provider", "copilot"),
        model: settings.get("llm.model", ""),
        baseUrl: settings.get("llm.baseUrl", "https://api.openai.com/v1"),
        previewHost: settings.get("preview.host", "auto"),
        eulaAccepted: settings.get("mcp.eulaAccepted", false),
        apiKeyStored,
      },
      dependencies: this.lastDependencies,
    });
  }

  private html(webview: vscode.Webview): string {
    const nonce = String(Date.now()) + Math.random().toString(36).slice(2);
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "main.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "style.css"));
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<link rel="stylesheet" href="${styleUri}" />
<title>Power BI Report Flow</title>
</head>
<body>
<div id="app">
  <header class="hero">
    <div>
      <div class="eyebrow">POWER BI</div>
      <h1>Report Flow</h1>
      <p class="sub">Profile data, design a contract, build PBIR, and validate.</p>
    </div>
    <span id="phase" class="badge">idle</span>
  </header>

  <section class="card">
    <label class="field">
      <span>Project name</span>
      <input id="projectName" type="text" placeholder="SalesOverview" />
    </label>
    <label class="field">
      <span>Output directory</span>
      <input id="outputDir" type="text" placeholder="powerbi-flow" />
    </label>
  </section>

  <section class="card">
    <h2>1. Data mode</h2>
    <div class="segmented" id="dataMode">
      <button data-value="external">External</button>
      <button data-value="local">Local</button>
      <button data-value="mock">Mock</button>
    </div>

    <div id="panel-local" class="panel">
      <p class="hint">CSV, TSV, XLSX, or JSON. The file is copied into the project at build time.</p>
      <button class="secondary" id="pickLocalFile">Choose data file…</button>
      <div id="localFileLabel" class="path"></div>
    </div>

    <div id="panel-mock" class="panel">
      <p class="hint">Provide a schema. A seeded generator creates reproducible rows.</p>
      <textarea id="mockSchema" rows="10" spellcheck="false"></textarea>
      <div class="row">
        <label class="field compact"><span>Seed</span><input id="seed" type="number" /></label>
        <button class="secondary" id="applyMock">Apply schema</button>
      </div>
    </div>

    <div id="panel-external" class="panel">
      <p class="hint">SQL Server, PostgreSQL, or MySQL. Credentials are used for profiling and are never written to PBIP.</p>
      <div class="row">
        <label class="field compact"><span>Connector</span>
          <select id="dbConnector"><option value="sqlserver">SQL Server</option><option value="postgresql">PostgreSQL</option><option value="mysql">MySQL</option></select>
        </label>
        <label class="field compact"><span>Server</span><input id="dbServer" type="text" placeholder="localhost" /></label>
      </div>
      <div class="row">
        <label class="field compact"><span>Database</span><input id="dbDatabase" type="text" /></label>
        <label class="field compact"><span>Table</span><input id="dbTable" type="text" placeholder="optional" /></label>
      </div>
      <div class="row">
        <label class="field compact"><span>User</span><input id="dbUser" type="text" /></label>
        <label class="field compact"><span>Password</span><input id="dbPassword" type="password" /></label>
      </div>
      <p class="hint">Fabric live-model mode requires a workspace and model GUID; use MCP settings to enable the connection.</p>
    </div>
  </section>

  <section class="card">
    <h2>2. Report mode</h2>
    <div class="row">
      <label class="field compact"><span>Pages (1–8)</span><input id="pageCount" type="number" min="1" max="8" step="1" /></label>
    </div>
    <div class="segmented" id="reportMode">
      <button data-value="text">Text</button>
      <button data-value="existing">Existing</button>
      <button data-value="image">Image</button>
    </div>

    <div id="panel-text" class="panel">
      <label class="field"><span>Describe the report</span><textarea id="textBrief" rows="5"></textarea></label>
      <div class="row">
        <label class="field compact"><span>Audience</span><input id="audience" type="text" /></label>
        <label class="field compact"><span>Tone</span><input id="tone" type="text" /></label>
      </div>
      <p class="hint">Attach documents or reference images. Text, DOCX, and images are sent to the LLM as design context.</p>
      <button class="secondary" id="pickDocuments">Attach documents / images…</button>
      <div id="documentsLabel" class="path"></div>
    </div>

    <div id="panel-existing" class="panel">
      <p class="hint">Use an existing PBIR .Report folder or .pbip as a template. The original is not modified.</p>
      <button class="secondary" id="pickReference">Choose report…</button>
      <div id="referenceLabel" class="path"></div>
    </div>

    <div id="panel-image" class="panel">
      <p class="hint">PNG, JPEG, or WebP. Select one or more images; each distinct dashboard page becomes a report page.</p>
      <button class="secondary" id="pickImages">Choose image(s)…</button>
      <div id="imageLabel" class="path"></div>
    </div>

    <label class="field"><span>Page backgrounds (YAML or text)</span><textarea id="backgroundYaml" rows="5" spellcheck="false" placeholder="overview:&#10;  image: assets/overview-bg.png&#10;  scaling: Fill&#10;breakdown:&#10;  color: &quot;#0B1F33&quot;"></textarea></label>
    <p class="hint">Match pages by name, display name, or 1-based index. Use color, image, scaling (Fit/Fill/Tile/Normal), and transparency.</p>
  </section>

  <section class="card actions">
    <button id="generateSpec" class="primary">Generate spec</button>
    <button id="approveBuild">Approve &amp; build</button>
    <button id="validate">Validate</button>
    <button id="preview">Preview / screenshots</button>
    <div class="row">
      <button id="checkDependencies" class="secondary">Check dependencies</button>
      <button id="openProject" class="secondary">Open project</button>
      <button id="openSpec" class="secondary">Open spec</button>
      <button id="cancel" class="secondary danger">Cancel</button>
    </div>
  </section>

  <section class="card">
    <h2>Status</h2>
    <div id="statusMessage" class="status"></div>
    <div id="validation" class="validation"></div>
    <div id="specSummary" class="spec"></div>
  </section>

  <section class="card">
    <h2>Log</h2>
    <pre id="log" class="log"></pre>
  </section>

  <section class="card settings">
    <h2>LLM provider</h2>
    <label class="field compact"><span>Provider</span>
      <select id="provider"><option value="copilot">GitHub Copilot</option><option value="openai">OpenAI compatible</option></select>
    </label>
    <label class="field compact"><span>Model</span><input id="model" type="text" placeholder="optional model id" /></label>
    <label class="field compact"><span>Base URL</span><input id="baseUrl" type="text" /></label>
    <button class="secondary" id="setApiKey">Set API key…</button>
    <label class="field compact checkbox"><input id="eulaAccepted" type="checkbox" /><span>MCP EULA accepted</span></label>
    <p class="hint" id="dependencies"></p>
  </section>
</div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
  }
}
