import type { ChatMessage, StreamFn } from "../providers/types.js";
import type { Tool, ToolContext } from "../tools/index.js";

export type AgentMessage =
  | { role: "assistant"; content: string }
  | { role: "toolResult"; toolCallId: string; name: string; content: string; isError?: boolean };

export class MaxStepsError extends Error {
  constructor(public steps: number) {
    super(`agent exceeded max steps (${steps})`);
  }
}

export interface RunTurnOpts {
  messages: ChatMessage[];
  model: string;
  streamFn: StreamFn;
  tools: Tool[];
  maxSteps?: number;
  signal?: AbortSignal;
  sequential?: boolean;
  cwd?: string;
}

interface PendingCall {
  id: string;
  name: string;
  args: string;
}

export async function runTurn(opts: RunTurnOpts): Promise<AgentMessage[]> {
  const maxSteps = opts.maxSteps ?? 30;
  const byName: Record<string, Tool> = {};
  for (const t of opts.tools) byName[t.name] = t;
  const ctx: ToolContext = {};
  if (opts.cwd !== undefined) ctx.cwd = opts.cwd;
  if (opts.signal !== undefined) ctx.signal = opts.signal;
  const messages = opts.messages.slice();
  const out: AgentMessage[] = [];
  for (let step = 0; step < maxSteps; step++) {
    let text = "";
    const calls: PendingCall[] = [];
    const streamOpts: { signal?: AbortSignal } = {};
    if (opts.signal !== undefined) streamOpts.signal = opts.signal;
    for await (const e of opts.streamFn(opts.model, messages, streamOpts)) {
      if (e.type === "text") text += e.delta;
      else calls.push({ id: e.id, name: e.name, args: e.args });
    }
    if (text) {
      out.push({ role: "assistant", content: text });
      messages.push({ role: "assistant", content: text });
    }
    if (calls.length === 0) return out;
    const runOne = async (c: PendingCall): Promise<AgentMessage> => {
      const tool = byName[c.name];
      if (!tool) {
        return {
          role: "toolResult",
          toolCallId: c.id,
          name: c.name,
          content: `error: unknown tool "${c.name}"`,
          isError: true,
        };
      }
      let args: unknown;
      try {
        args = JSON.parse(c.args);
      } catch {
        return {
          role: "toolResult",
          toolCallId: c.id,
          name: c.name,
          content: `error: malformed tool args (not JSON): ${c.args.slice(0, 500)}`,
          isError: true,
        };
      }
      try {
        return { role: "toolResult", toolCallId: c.id, name: c.name, content: await tool.execute(args, ctx) };
      } catch (err) {
        return {
          role: "toolResult",
          toolCallId: c.id,
          name: c.name,
          content: `error: ${(err as Error).message}`,
          isError: true,
        };
      }
    };
    const results: AgentMessage[] = [];
    if (opts.sequential) {
      for (const c of calls) results.push(await runOne(c));
    } else {
      // Parallel by default (pi-mono ToolExecutionMode semantics): every call
      // in one step runs concurrently; pass sequential only when order matters.
      results.push(...(await Promise.all(calls.map(runOne))));
    }
    for (const r of results) {
      out.push(r);
      if (r.role === "toolResult") {
        messages.push({ role: "toolResult", toolCallId: r.toolCallId, name: r.name, content: r.content });
      }
    }
    opts.signal?.throwIfAborted();
  }
  throw new MaxStepsError(maxSteps);
}
