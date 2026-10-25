type VsCodeApi = { postMessage(message: unknown): void };
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

interface FlowStateLike {
  phase: string;
  message: string;
  log: string[];
  validation?: { result: string; errors: string[]; warnings: string[] };
  screenshots?: string[];
  specHash?: string;
  reportSpec?: { title: string; summary: string; pages: Array<{ displayName: string; placements: unknown[] }> };
  error?: string;
}

interface SettingsLike {
  provider: string;
  model: string;
  baseUrl: string;
  previewHost: string;
  eulaAccepted: boolean;
  apiKeyStored: boolean;
}

let state: FlowStateLike = { phase: "idle", message: "Ready", log: [] };
let config: Record<string, any> = {};
let settings: SettingsLike = {
  provider: "copilot",
  model: "",
  baseUrl: "https://api.openai.com/v1",
  previewHost: "auto",
  eulaAccepted: false,
  apiKeyStored: false,
};
let dependencies: any;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function activeMode(containerId: string, value: string): void {
  for (const button of Array.from($(containerId).querySelectorAll<HTMLButtonElement>("button"))) {
    button.classList.toggle("active", button.dataset.value === value);
  }
}

function showPanels(): void {
  for (const mode of ["local", "mock", "external"]) {
    $(`panel-${mode}`).classList.toggle("hidden", config.dataMode !== mode);
  }
  for (const mode of ["text", "existing", "image"]) {
    $(`panel-${mode}`).classList.toggle("hidden", config.reportMode !== mode);
  }
}

function renderConfig(): void {
  ($("projectName") as HTMLInputElement).value = config.projectName ?? "";
  ($("outputDir") as HTMLInputElement).value = config.outputDir ?? "powerbi-flow";
  ($("seed") as HTMLInputElement).value = String(config.seed ?? 42);
  ($("textBrief") as HTMLTextAreaElement).value = config.textBrief ?? "";
  ($("audience") as HTMLInputElement).value = config.audience ?? "";
  ($("tone") as HTMLInputElement).value = config.tone ?? "";
  ($("mockSchema") as HTMLTextAreaElement).value = config.mockSchema ? JSON.stringify(config.mockSchema, null, 2) : "";
  $("localFileLabel").textContent = config.localFile ?? "";
  $("imageLabel").textContent = config.imageFile ?? "";
  $("referenceLabel").textContent = config.referenceReport ?? "";
  activeMode("dataMode", config.dataMode ?? "mock");
  activeMode("reportMode", config.reportMode ?? "text");
  showPanels();

  const db = config.externalDb ?? {};
  ($("dbConnector") as HTMLSelectElement).value = db.connector ?? "sqlserver";
  ($("dbServer") as HTMLInputElement).value = db.server ?? "";
  ($("dbDatabase") as HTMLInputElement).value = db.database ?? "";
  ($("dbTable") as HTMLInputElement).value = db.table ?? "";
  ($("dbUser") as HTMLInputElement).value = db.user ?? "";
}

function renderSettings(): void {
  ($("provider") as HTMLSelectElement).value = settings.provider;
  ($("model") as HTMLInputElement).value = settings.model;
  ($("baseUrl") as HTMLInputElement).value = settings.baseUrl;
  ($("eulaAccepted") as HTMLInputElement).checked = settings.eulaAccepted;
}

function renderState(): void {
  $("phase").textContent = state.phase;
  $("phase").className = `badge phase-${state.phase}`;
  $("statusMessage").textContent = state.error ? `${state.message} — ${state.error}` : state.message;
  $("log").textContent = state.log.join("\n");
  $("log").scrollTop = $("log").scrollHeight;

  const validation = $("validation");
  validation.innerHTML = "";
  if (state.validation) {
    const heading = document.createElement("div");
    heading.className = "validation-heading";
    heading.textContent = `Validation: ${state.validation.result} (${state.validation.errors.length} errors, ${state.validation.warnings.length} warnings)`;
    validation.appendChild(heading);
    for (const error of [...state.validation.errors, ...state.validation.warnings].slice(0, 20)) {
      const line = document.createElement("div");
      line.className = "validation-line";
      line.textContent = error;
      validation.appendChild(line);
    }
  }

  const spec = $("specSummary");
  spec.innerHTML = "";
  if (state.reportSpec) {
    const title = document.createElement("div");
    title.className = "spec-title";
    title.textContent = state.reportSpec.title;
    spec.appendChild(title);
    const summary = document.createElement("div");
    summary.className = "hint";
    summary.textContent = state.reportSpec.summary;
    spec.appendChild(summary);
    for (const page of state.reportSpec.pages) {
      const line = document.createElement("div");
      line.className = "spec-page";
      line.textContent = `${page.displayName}: ${page.placements.length} visual(s)`;
      spec.appendChild(line);
    }
    if (state.specHash) {
      const hash = document.createElement("div");
      hash.className = "path";
      hash.textContent = `spec ${state.specHash.slice(0, 12)}`;
      spec.appendChild(hash);
    }
  }

  if (dependencies) {
    $("dependencies").textContent = [
      `Node ${dependencies.node}`,
      `CLI ${dependencies.reportCli?.version ?? (dependencies.reportCli?.found ? "found" : "missing")}`,
      `MCP ${dependencies.mcp?.found ? "found" : "missing"}`,
      `Desktop ${dependencies.desktop?.found ? "found" : "missing"}`,
      ...(dependencies.warnings ?? []),
    ].join(" · ");
  }
}

function collectConfig(): Record<string, any> {
  const seed = Number(($("seed") as HTMLInputElement).value || 42);
  let mockSchemaText: string | undefined;
  try {
    const parsed = JSON.parse(($("mockSchema") as HTMLTextAreaElement).value || "{}");
    if (parsed && typeof parsed === "object") {
      parsed.seed = seed;
      mockSchemaText = JSON.stringify(parsed);
    }
  } catch {
    mockSchemaText = undefined;
  }
  const connector = ($("dbConnector") as HTMLSelectElement).value;
  return {
    projectName: ($("projectName") as HTMLInputElement).value,
    outputDir: ($("outputDir") as HTMLInputElement).value,
    dataMode: config.dataMode,
    reportMode: config.reportMode,
    localFile: config.localFile,
    imageFile: config.imageFile,
    referenceReport: config.referenceReport,
    textBrief: ($("textBrief") as HTMLTextAreaElement).value,
    audience: ($("audience") as HTMLInputElement).value,
    tone: ($("tone") as HTMLInputElement).value,
    seed,
    mockSchemaText,
    externalDb: {
      connector,
      server: ($("dbServer") as HTMLInputElement).value,
      database: ($("dbDatabase") as HTMLInputElement).value,
      table: ($("dbTable") as HTMLInputElement).value || undefined,
      user: ($("dbUser") as HTMLInputElement).value || undefined,
      password: ($("dbPassword") as HTMLInputElement).value || undefined,
    },
  };
}

function send(type: string, payload: Record<string, unknown> = {}): void {
  vscode.postMessage({ type, ...payload });
}

window.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "state") {
    state = message.state;
    config = message.config;
    settings = message.settings;
    dependencies = message.dependencies;
    renderConfig();
    renderSettings();
    renderState();
  } else if (message.type === "error") {
    $("statusMessage").textContent = message.message;
  }
});

for (const containerId of ["dataMode", "reportMode"]) {
  $(containerId).addEventListener("click", (event) => {
    const target = event.target as HTMLButtonElement;
    if (!target.dataset.value) return;
    if (containerId === "dataMode") config.dataMode = target.dataset.value;
    else config.reportMode = target.dataset.value;
    activeMode(containerId, target.dataset.value);
    showPanels();
    send("updateConfig", { config: collectConfig() });
  });
}

$("pickLocalFile").addEventListener("click", () => send("pickLocalFile"));
$("pickImage").addEventListener("click", () => send("pickImage"));
$("pickReference").addEventListener("click", () => send("pickReference"));
$("applyMock").addEventListener("click", () => send("updateConfig", { config: collectConfig() }));
$("generateSpec").addEventListener("click", () => {
  send("updateConfig", { config: collectConfig() });
  send("generateSpec");
});
$("approveBuild").addEventListener("click", () => {
  send("updateConfig", { config: collectConfig() });
  send("approveBuild");
});
$("validate").addEventListener("click", () => send("validate"));
$("preview").addEventListener("click", () => send("preview"));
$("checkDependencies").addEventListener("click", () => send("checkDependencies"));
$("openProject").addEventListener("click", () => send("openProject"));
$("openSpec").addEventListener("click", () => send("openSpec"));
$("cancel").addEventListener("click", () => send("cancel"));
$("setApiKey").addEventListener("click", () => send("setApiKey"));
$("provider").addEventListener("change", () => {
  const provider = ($("provider") as HTMLSelectElement).value;
  vscode.postMessage({ type: "updateSettings", settings: { provider } });
});
$("eulaAccepted").addEventListener("change", () => {
  vscode.postMessage({ type: "updateSettings", settings: { eulaAccepted: ($("eulaAccepted") as HTMLInputElement).checked } });
});
$("model").addEventListener("change", () => {
  vscode.postMessage({ type: "updateSettings", settings: { model: ($("model") as HTMLInputElement).value } });
});
$("baseUrl").addEventListener("change", () => {
  vscode.postMessage({ type: "updateSettings", settings: { baseUrl: ($("baseUrl") as HTMLInputElement).value } });
});

send("ready");
