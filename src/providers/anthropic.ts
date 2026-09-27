import type { ChatMessage, StreamFn } from "./types.js";
import type { PendingCall } from "./openai-completions.js";
import { emitPending, fields, requestSignal, splitModel, sseDataLines, throwForStatus } from "./openai-completions.js";

function toAnthropic(messages: ChatMessage[]): { system?: string; messages: Record<string, unknown>[] } {
  const system: string[] = [];
  const out: Record<string, unknown>[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      system.push(m.content);
    } else if (m.role === "toolResult") {
      out.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.toolCallId ?? "", content: m.content }],
      });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return { ...(system.length ? { system: system.join("\n") } : {}), messages: out };
}

export const streamAnthropic: StreamFn = async function* (
  model,
  messages,
  opts,
) {
  const split = splitModel(model);
  const providerId = opts.providerId ?? split.providerId;
  if (!opts.baseUrl) throw new Error(`anthropic-messages: missing baseUrl for model ${model}`);
  const res = await fetch(`${opts.baseUrl}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      "anthropic-version": "2023-06-01",
      ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: split.name, max_tokens: 4096, ...toAnthropic(messages), stream: true }),
    signal: requestSignal(opts.signal, opts.timeoutMs),
  });
  // 401s surface in throwForStatus, which marks the credential failed.
  await throwForStatus(res, providerId);
  const pending: Record<string, PendingCall> = {};
  const order: string[] = [];
  const byIndex: Record<number, string> = {};
  const closed: Record<string, true> = {};
  for await (const data of sseDataLines(res)) {
    let evt: unknown;
    try {
      evt = JSON.parse(data);
    } catch {
      continue;
    }
    const root = fields(evt);
    if (!root || typeof root.type !== "string") continue;
    const index = typeof root.index === "number" ? root.index : undefined;
    if (root.type === "content_block_start") {
      const block = "content_block" in root ? fields(root.content_block) : undefined;
      if (block?.type !== "tool_use") continue;
      const key = `index:${index ?? order.length}`;
      pending[key] = {
        ...(typeof block.id === "string" && block.id ? { serverId: block.id } : {}),
        name: typeof block.name === "string" ? block.name : "",
        args: "",
      };
      order.push(key);
      if (index !== undefined) byIndex[index] = key;
    } else if (root.type === "content_block_delta") {
      const delta = "delta" in root ? fields(root.delta) : undefined;
      if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text) {
        yield { type: "text", delta: delta.text };
      } else if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
        const slot = index !== undefined ? pending[byIndex[index]] : undefined;
        if (slot) slot.args += delta.partial_json;
      }
    } else if (root.type === "content_block_stop") {
      const key = index !== undefined ? byIndex[index] : undefined;
      if (key && pending[key] && !closed[key]) {
        closed[key] = true;
        for (const e of emitPending(pending, [key])) yield e;
      }
    } else if (root.type === "message_stop") {
      break;
    }
  }
  for (const key of order) {
    if (closed[key] || !pending[key]) continue;
    closed[key] = true;
    for (const e of emitPending(pending, [key])) yield e;
  }
};
