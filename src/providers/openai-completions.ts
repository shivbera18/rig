import { ProviderHttpError } from "./types.js";
import { markFailed } from "../auth/pool.js";
import type { ChatMessage, StreamEvent, StreamFn } from "./types.js";

export interface PendingCall {
  serverId?: string;
  name: string;
  args: string;
}

// One checked gate for parsed network JSON: object-ness verified here, every
// value stays unknown so call sites must narrow with `in`/`typeof` per read.
export function fields(v: unknown): Record<string, unknown> | undefined {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  return v as Record<string, unknown>;
}

export function splitModel(model: string): { providerId: string; name: string } {
  const i = model.indexOf("/");
  return i < 0 ? { providerId: model, name: model } : { providerId: model.slice(0, i), name: model.slice(i + 1) };
}

export function toOpenAiMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((m) =>
    m.role === "toolResult"
      ? {
          role: "tool",
          content: m.content,
          ...(m.toolCallId !== undefined ? { tool_call_id: m.toolCallId } : {}),
        }
      : { role: m.role, content: m.content },
  );
}

export async function* sseDataLines(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const line of parts) {
      const t = line.trim();
      if (t.startsWith("data:")) yield t.slice(5).trim();
    }
  }
  const tail = buf.trim();
  if (tail.startsWith("data:")) yield tail.slice(5).trim();
}

export function throwIfSseError(evt: unknown, providerId: string): void {
  const root = fields(evt);
  if (!root || !("error" in root)) return;
  const detail = fields(root.error);
  const status = detail && typeof detail.code === "number" ? detail.code : 500;
  throw new ProviderHttpError(status, providerId, JSON.stringify(root.error).slice(0, 500));
}

export async function throwForStatus(res: Response, providerId: string): Promise<void> {
  if (res.ok) return;
  const snippet = (await res.text()).slice(0, 500);
  if (res.status === 401) {
    try {
      markFailed(providerId);
    } catch {
      // pool slice owns markFailed; a missing/broken store must not hide the 401.
    }
  }
  throw new ProviderHttpError(res.status, providerId, snippet);
}

export function requestSignal(signal: AbortSignal | undefined, timeoutMs: number | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs ?? 120000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function emitPending(pending: Record<string, PendingCall>, order: string[]): StreamEvent[] {
  const out: StreamEvent[] = [];
  let n = 0;
  for (const key of order) {
    const slot = pending[key];
    if (!slot) continue;
    out.push({ type: "toolCall", id: slot.serverId ?? `call_${n++}`, name: slot.name, args: slot.args });
  }
  return out;
}

function trackToolCall(
  pending: Record<string, PendingCall>,
  order: string[],
  raw: unknown,
): void {
  const c = fields(raw);
  if (!c) return;
  const fn = "function" in c ? fields(c.function) : undefined;
  const serverId = typeof c.id === "string" && c.id ? c.id : undefined;
  const key = serverId ?? `index:${typeof c.index === "number" ? c.index : order.length}`;
  let slot = pending[key];
  if (!slot) {
    slot = pending[key] = { name: "", args: "" };
    order.push(key);
  }
  if (serverId) slot.serverId = serverId;
  if (!slot.name && fn && typeof fn.name === "string") slot.name = fn.name;
  if (fn && typeof fn.arguments === "string") slot.args += fn.arguments;
}

export const streamCompletions: StreamFn = async function* (
  model,
  messages,
  opts,
): AsyncGenerator<StreamEvent> {
  const split = splitModel(model);
  const providerId = opts.providerId ?? split.providerId;
  if (!opts.baseUrl) throw new Error(`openai-completions: missing baseUrl for model ${model}`);
  const res = await fetch(`${opts.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: split.name, messages: toOpenAiMessages(messages), stream: true }),
    signal: requestSignal(opts.signal, opts.timeoutMs),
  });
  await throwForStatus(res, providerId);
  const pending: Record<string, PendingCall> = {};
  const order: string[] = [];
  for await (const data of sseDataLines(res)) {
    if (data === "[DONE]") break;
    let evt: unknown;
    try {
      evt = JSON.parse(data);
    } catch {
      continue;
    }
    throwIfSseError(evt, providerId);
    const root = fields(evt);
    const choices = root && "choices" in root && Array.isArray(root.choices) ? root.choices : [];
    const first = fields(choices[0]);
    const delta = first && "delta" in first ? fields(first.delta) : undefined;
    if (!delta) continue;
    if (typeof delta.content === "string" && delta.content) yield { type: "text", delta: delta.content };
    if ("tool_calls" in delta && Array.isArray(delta.tool_calls)) {
      for (const c of delta.tool_calls) trackToolCall(pending, order, c);
    }
  }
  for (const e of emitPending(pending, order)) yield e;
};
