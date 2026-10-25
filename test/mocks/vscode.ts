import path from "node:path";

export class Disposable {
  constructor(private readonly fn?: () => void) {}
  dispose(): void {
    this.fn?.();
  }
}

export const version = "1.143.1";
export const configValues: Record<string, unknown> = {};
export const workspaceFolders: Array<{ uri: { fsPath: string; scheme: string } }> = [];

export function setConfigValues(values: Record<string, unknown>): void {
  for (const key of Object.keys(configValues)) delete configValues[key];
  Object.assign(configValues, values);
}

export function setWorkspaceFolder(folder: string): void {
  workspaceFolders.length = 0;
  workspaceFolders.push({ uri: { fsPath: folder, scheme: "file" } });
}

export const Uri = {
  file: (fsPath: string) => ({ fsPath, scheme: "file" }),
  joinPath: (base: { fsPath: string; scheme: string }, ...rest: string[]) => ({
    fsPath: path.join(base.fsPath, ...rest),
    scheme: "file",
  }),
};

export const window = {
  createOutputChannel: () => ({ appendLine() {}, append() {}, dispose() {} }),
  registerWebviewViewProvider: () => new Disposable(),
  showOpenDialog: async () => undefined,
  showInputBox: async () => undefined,
  showInformationMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  withProgress: async (_options: unknown, task: (progress: unknown, token: unknown) => Promise<unknown>) =>
    task({ report() {} }, { isCancellationRequested: false }),
};

export const commands = {
  registerCommand: () => new Disposable(),
  executeCommand: async () => undefined,
};

export const workspace = {
  getConfiguration: () => ({
    get(key: string, fallback?: unknown) {
      return key in configValues ? configValues[key] : fallback;
    },
    async update() {
      return undefined;
    },
  }),
  workspaceFolders,
  onDidChangeConfiguration: () => new Disposable(),
  onDidChangeWorkspaceFolders: () => new Disposable(),
};

export const env = {
  openExternal: async () => true,
};

export const lm = {
  selectChatModels: async () => [] as unknown[],
};

export class LanguageModelChatMessage {
  static User(content: unknown) {
    return { content };
  }
}
