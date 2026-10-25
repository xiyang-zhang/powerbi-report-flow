import * as vscode from "vscode";
import { FlowController } from "./flow/FlowController";
import { FlowViewProvider } from "./ui/FlowViewProvider";

let controller: FlowController | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Power BI Report Flow");
  controller = new FlowController(context, context.extensionPath);
  const provider = new FlowViewProvider(context, controller, context.extensionUri);

  context.subscriptions.push(
    output,
    vscode.window.registerWebviewViewProvider("powerbiReportFlow.main", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("powerbiReportFlow.open", async () => {
      await vscode.commands.executeCommand("powerbiReportFlow.main.focus");
    }),
    vscode.commands.registerCommand("powerbiReportFlow.generateSpec", async () => {
      await provider.runAction("generateSpec");
    }),
    vscode.commands.registerCommand("powerbiReportFlow.approveAndBuild", async () => {
      await provider.runAction("approveBuild");
    }),
    vscode.commands.registerCommand("powerbiReportFlow.validate", async () => {
      await provider.runAction("validate");
    }),
    vscode.commands.registerCommand("powerbiReportFlow.preview", async () => {
      await provider.runAction("preview");
    }),
    vscode.commands.registerCommand("powerbiReportFlow.openProject", async () => {
      await controller?.openProject();
    }),
    vscode.commands.registerCommand("powerbiReportFlow.cancel", () => {
      controller?.cancel();
    }),
    vscode.commands.registerCommand("powerbiReportFlow.checkDependencies", async () => {
      await provider.runAction("checkDependencies");
    }),
    vscode.commands.registerCommand("powerbiReportFlow.setApiKey", async () => {
      const value = await vscode.window.showInputBox({
        title: "Power BI Report Flow: OpenAI-compatible API key",
        password: true,
        ignoreFocusOut: true,
        prompt: "Stored in VS Code SecretStorage; never written to the project.",
      });
      if (value) {
        await context.secrets.store("powerbiFlow.openai.apiKey", value);
        void vscode.window.showInformationMessage("API key stored in VS Code SecretStorage.");
      }
    }),
  );
}

export function deactivate(): void {
  controller = undefined;
}
