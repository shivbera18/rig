import { ProviderHttpError } from "./types.js";
import { markFailed } from "../auth/pool.js";
import type { StreamEvent, StreamFn } from "./types.js";
import type { ChatMessage } from "./types.js";
import type { PendingCall } from "./openai-completions.js";
import { emitPending, fields, requestSignal, splitModel, sseDataLines, throwForStatus, throwIfSseError } from "./openai-completions.js";

function toResponsesInput(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((m) =>
    m.role === "toolResult" ? { role: "user", content: m.content } : { role: m.role, content: m.content },
  );
}

function callEvents(output: unknown): StreamEvent[] {
  if (!Array.isArray(output)) return [];
  const out: StreamEvent[] = [];
  let n = 0;
  for (const item of output) {
    const f = fields(item);
    if (!f || typeof f.type !== "string") continue;
    if (f.type === "message" && Array.isArray(f.content)) {
      for (const c of f.content) {
        const part = fields(c);
        if (part?.type === "output_text" && typeof part.text === "string" && part.text) {
          out.push({ type: "text", delta: part.text });
        }
      }
    } else if (f.type === "function_call") {
      const id = typeof f.call_id === "string" && f.call_id
        ? f.call_id
        : typeof f.id === "string" && f.id
          ? f.id
          : `call_${n++}`;
      out.push({
        type: "toolCall",
        id,
        name: typeof f.name === "string" ? f.name : "",
        args: typeof f.arguments === "string" ? f.arguments : JSON.stringify(f.arguments ?? ""),
      });
    }
  }
  return out;
}

export const streamResponses: StreamFn = async function* (
  model,
  messages,
  opts,
): AsyncGenerator<StreamEvent> {
  const split = splitModel(model);
  const providerId = opts.providerId ?? split.providerId;
  if (!opts.baseUrl) throw new Error(`openai-responses: missing baseUrl for model ${model}`);
  let res: Response;
  try {
    res = await fetch(`${opts.baseUrl}/responses`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: split.name, input: toResponsesInput(messages), stream: true }),
      signal: requestSignal(opts.signal, opts.timeoutMs),
    });
  } catch (err) {
    // A stale pool credential surfaces as 401 at fetch time; mark-by-provider
    // keeps the failure signal even when only the model string is known.
    if (err instanceof ProviderHttpError && err.status === 401) {
      try {
        markFailed(providerId);
      } catch {
        // pool slice owns markFailed; never hide the original error.
      }
    }
    throw err;
  }
  await throwForStatus(res, providerId);
  if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const body = fields(await res.json());
    const output = body && "output" in body ? body.output : undefined;
    for (const e of callEvents(output)) yield e;
    return;
  }
  const pending: Record<string, PendingCall> = {};
  const order: string[] = [];
  let textSeen = false;
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
    const t = root && typeof root.type === "string" ? root.type : undefined;
    if (t === "response.output_text.delta" && root && typeof root.delta === "string") {
      if (root.delta) {
        textSeen = true;
        yield { type: "text", delta: root.delta };
      }
    } else if (t === "response.function_call_arguments.delta" && root) {
      const serverId = typeof root.item_id === "string" && root.item_id ? root.item_id : undefined;
      const key = serverId ?? `index:${order.length}`;
      let slot = pending[key];
      if (!slot) {
        slot = pending[key] = { name: "", args: "" };
        order.push(key);
      }
      if (serverId) slot.serverId = serverId;
      if (typeof root.delta === "string") slot.args += root.delta;
    } else if ((t === "response.completed" || t === "response.complete") && root) {
      const resp = "response" in root ? fields(root.response) : undefined;
      const output = resp && "output" in resp ? resp.output : undefined;
      for (const e of callEvents(output)) {
        if (e.type === "text") {
          if (!textSeen) yield e;
        } else if (e.id && pending[e.id]) {
          const slot = pending[e.id];
          if (!slot.name) slot.name = e.name;
          if (!slot.args) slot.args = e.args;
        } else {
          const key = `completed:${e.id}`;
          pending[key] = { serverId: e.id, name: e.name, args: e.args };
          order.push(key);
        }
      }
      break;
    }
  }
  for (const e of emitPending(pending, order)) yield e;
};
