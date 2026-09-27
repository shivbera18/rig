import { getConfigPath, loadConfig } from "../config.js";
import type { Config } from "../config.js";
import { streamFor } from "../providers/dispatch.js";
import { loadStore } from "../auth/store.js";
import { builtinTools } from "../tools/index.js";
import { runTurn } from "../turn/loop.js";
import type { ChatMessage, StreamFn } from "../providers/types.js";
import { loadSession, newSessionId, saveSession } from "../session/store.js";

export interface RunOnceOpts {
  model?: string | undefined;
  maxSteps?: number | undefined;
  profile?: string | undefined;
  sessionId?: string | undefined;
  signal?: AbortSignal;
  onText?: (delta: string) => void;
  onToolStart?: (name: string, args: string) => void;
  onToolEnd?: (name: string, preview: string) => void;
}

export async function resolveRef(model: string | undefined, config: Config): Promise<string> {
  let ref = model ?? config.defaultModel;
  if (ref.startsWith("@")) {
    try {
      ref = (await import("../agents/roles.js")).resolveRoleChain(ref, config);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("unknown model role")) throw err;
      throw new Error(`unknown model role ${ref}`);
    }
  }
  return ref;
}

async function buildStreamFn(ref: string, profile?: string | undefined): Promise<StreamFn> {
  const { config } = loadConfig(getConfigPath(undefined, profile));
  const slash = ref.indexOf("/");
  if (slash < 0) throw new Error(`model must be "provider/model", got "${ref}"`);
  const providerId = ref.slice(0, slash);
  const entry = config.provider[providerId];
  if (!entry) throw new Error(`unknown provider "${providerId}" (not in config)`);
  const apiKey =
    (entry.apiKeyEnv ? process.env[entry.apiKeyEnv] : undefined) ??
    loadStore(profile).find((c) => c.provider === providerId)?.access;
  const bound: { baseUrl: string; providerId: string; apiKey?: string } = {
    baseUrl: entry.baseUrl,
    providerId,
  };
  if (apiKey !== undefined) bound.apiKey = apiKey;
  return streamFor(entry.apiFormat, bound);
}
// One agent turn against a (possibly resumed) thread; persists the merged thread.
export async function runOnce(
  prompt: string,
  opts: RunOnceOpts = {},
): Promise<{ text: string; sessionId: string }> {
  const { config } = loadConfig(getConfigPath(undefined, opts.profile));
  const ref = await resolveRef(opts.model, config);
  const streamFn = await buildStreamFn(ref, opts.profile);
  const carried: ChatMessage[] =
    opts.sessionId === undefined ? [] : (loadSession(opts.sessionId, opts.profile)?.messages ?? []);
  const input: ChatMessage[] = [...carried, { role: "user", content: prompt }];
  const history = await runTurn({
    messages: input,
    model: ref,
    streamFn,
    tools: builtinTools(),
    maxSteps: opts.maxSteps ?? config.maxSteps ?? 30,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    ...(opts.onText !== undefined ? { onText: opts.onText } : {}),
    ...(opts.onToolStart !== undefined ? { onToolStart: opts.onToolStart } : {}),
    ...(opts.onToolEnd !== undefined ? { onToolEnd: opts.onToolEnd } : {}),
  });
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m?.role === "assistant") {
      const id = opts.sessionId ?? newSessionId();
      const thread: ChatMessage[] = [...input];
      for (const h of history) {
        if (h.role === "assistant") thread.push({ role: "assistant", content: h.content });
        else thread.push({ role: "toolResult", content: h.content, toolCallId: h.toolCallId, name: h.name });
      }
      saveSession({ id, model: ref, messages: thread, updatedAtMs: Date.now() }, opts.profile);
      return { text: m.content, sessionId: id };
    }
  }
  throw new Error("agent produced no response");
}
