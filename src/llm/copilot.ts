import * as vscode from "vscode";
import type { LlmProvider, LlmRequest } from "./provider";

export class CopilotProvider implements LlmProvider {
  readonly id = "copilot";

  async complete(request: LlmRequest, token?: { isCancellationRequested: boolean }): Promise<string> {
    const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
    const available = models.filter((model) => (request.model ? model.id === request.model || model.family === request.model : true));
    const model = available[0] ?? models[0];
    if (!model) {
      throw new Error(
        "No Copilot language model is available. Install GitHub Copilot Chat and sign in, or set powerbiFlow.llm.provider to openai.",
      );
    }

    const messages: any[] = request.messages.map((message) => vscode.LanguageModelChatMessage.User(message.content));
    const images = request.images ?? (request.image ? [request.image] : []);
    if (images.length > 0) {
      const dataPartCtor = (vscode as any).LanguageModelDataPart;
      if (!dataPartCtor?.image) {
        throw new Error("This VS Code version does not expose image input through the Language Model API.");
      }
      const imageParts = images.map((image) => dataPartCtor.image(image.data, image.mimeType));
      messages[messages.length - 1] = vscode.LanguageModelChatMessage.User([
        request.messages[request.messages.length - 1]?.content ?? "Describe the attached image(s).",
        ...imageParts,
      ]);
    }

    const cancellation = new vscode.CancellationTokenSource();
    if (token) {
      const interval = setInterval(() => {
        if (token.isCancellationRequested) cancellation.cancel();
      }, 250);
      try {
        const response = await model.sendRequest(messages, {}, cancellation.token);
        let text = "";
        for await (const fragment of response.text) {
          text += fragment;
        }
        return text;
      } finally {
        clearInterval(interval);
        cancellation.dispose();
      }
    }

    const response = await model.sendRequest(messages, {}, cancellation.token);
    let text = "";
    for await (const fragment of response.text) {
      text += fragment;
    }
    cancellation.dispose();
    return text;
  }
}
