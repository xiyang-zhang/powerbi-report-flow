export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmImage {
  data: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
}

export interface LlmRequest {
  messages: LlmMessage[];
  /** Legacy single-image field; kept for compatibility. Prefer images. */
  image?: LlmImage;
  images?: LlmImage[];
  json?: boolean;
  model?: string;
  maxTokens?: number;
}

export interface LlmProvider {
  readonly id: string;
  complete(request: LlmRequest, token?: { isCancellationRequested: boolean }): Promise<string>;
}
