import type { ApiFormat, StreamEvent, StreamFn } from "./types.js";

export interface BoundCreds {
  baseUrl?: string;
  apiKey?: string;
  providerId?: string;
}

export async function streamFor(apiFormat: ApiFormat, bound?: BoundCreds): Promise<StreamFn> {
  // NOTE: await import here is genuinely runtime-selected (one module per
  // format); a static import would load all three providers every run.
  let inner: StreamFn;
  switch (apiFormat) {
    case "openai-completions":
      inner = (await import("./openai-completions.js")).streamCompletions;
      break;
    case "openai-responses":
      inner = (await import("./openai-responses.js")).streamResponses;
      break;
    case "anthropic-messages":
      inner = (await import("./anthropic.js")).streamAnthropic;
      break;
  }
  if (bound === undefined) return inner;
  return async function* (model, messages, opts): AsyncGenerator<StreamEvent> {
    const merged = { ...opts };
    if (merged.baseUrl === undefined && bound.baseUrl !== undefined) merged.baseUrl = bound.baseUrl;
    if (merged.apiKey === undefined && bound.apiKey !== undefined) merged.apiKey = bound.apiKey;
    if (merged.providerId === undefined && bound.providerId !== undefined) merged.providerId = bound.providerId;
    yield* inner(model, messages, merged);
  };
}
