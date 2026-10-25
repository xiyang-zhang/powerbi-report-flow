import type { LlmMessage, LlmProvider, LlmRequest } from "./provider";

export class OpenAiProvider implements LlmProvider {
  readonly id = "openai";

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly defaultModel: string,
  ) {}

  async complete(request: LlmRequest, token?: { isCancellationRequested: boolean }): Promise<string> {
    const model = request.model || this.defaultModel;
    if (!model) throw new Error("powerbiFlow.llm.model is not configured.");
    if (!this.apiKey) throw new Error("No API key is stored for the OpenAI-compatible provider.");

    const messages: unknown[] = request.messages.map((message) => ({ role: message.role, content: message.content }));
    const images = request.images ?? (request.image ? [request.image] : []);
    if (images.length > 0) {
      const last = messages[messages.length - 1] as { role: string; content: unknown } | undefined;
      const text = last?.content ?? "Describe the attached image(s).";
      if (last) {
        last.content = [
          { type: "text", text },
          ...images.map((image) => ({
            type: "image_url",
            image_url: { url: `data:${image.mimeType};base64,${Buffer.from(image.data).toString("base64")}` },
          })),
        ];
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);
    const interval = token
      ? setInterval(() => {
          if (token.isCancellationRequested) controller.abort();
        }, 250)
      : undefined;
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2,
          max_tokens: request.maxTokens ?? 4096,
          ...(request.json ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`LLM request failed (${response.status}): ${body.slice(0, 500)}`);
      }
      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
      };
      const content = json.choices?.[0]?.message?.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) return content.map((part) => part.text ?? "").join("");
      throw new Error("LLM returned an empty response.");
    } finally {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    }
  }
}

export function messages(system: string, user: string): LlmMessage[] {
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
