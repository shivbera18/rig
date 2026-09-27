export type ApiFormat =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "toolResult";
  content: string;
  toolCallId?: string;
  name?: string;
}

export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "toolCall"; id: string; name: string; args: string };

export type StreamFn = (
  model: string,
  messages: ChatMessage[],
  opts: {
    signal?: AbortSignal;
    timeoutMs?: number;
    apiKey?: string;
    baseUrl?: string;
    providerId?: string;
  },
) => AsyncGenerator<StreamEvent>;

export class ProviderHttpError extends Error {
  constructor(
    public status: number,
    public providerId: string,
    public bodySnippet: string,
  ) {
    super(`provider ${providerId} HTTP ${status}: ${bodySnippet}`);
  }
}

export class AllCredentialsFailed extends Error {
  constructor(public providerId: string) {
    super(`all credentials failed for provider ${providerId}`);
  }
}
