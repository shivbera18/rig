import fs from "node:fs";
import { getConfigPath, loadConfig } from "../config.js";
import { streamFor } from "../providers/dispatch.js";
import { loadStore } from "../auth/store.js";
import { builtinTools } from "../tools/index.js";
import { runTurn } from "../turn/loop.js";
import type { ChatMessage } from "../providers/types.js";

export interface ExecOpts {
  model?: string;
  maxSteps?: number;
  profile?: string | undefined;
}

export async function runExec(prompt: string, opts: ExecOpts): Promise<void> {
  try {
    fs.accessSync(".git");
  } catch {
    console.error("rig: warning: not a git repository; running in-place with isolation disabled");
  }
  const { config } = loadConfig(getConfigPath(undefined, opts.profile));
  let ref = opts.model ?? config.defaultModel;
  if (ref.startsWith("@")) {
    // NOTE: await import is genuinely runtime-selected here — the roles module
    // belongs to a sibling slice and may not exist yet; a static import would
    // hard-fail the bundle when it hasn't landed.
    try {
      ref = (await import("../agents/roles.js")).resolveRoleChain(ref, config);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("unknown model role")) throw err;
      throw new Error(`unknown model role ${ref}`);
    }
  }
  const slash = ref.indexOf("/");
  if (slash < 0) throw new Error(`model must be "provider/model", got "${ref}"`);
  const providerId = ref.slice(0, slash);
  const entry = config.provider[providerId];
  if (!entry) throw new Error(`unknown provider "${providerId}" (not in config)`);
  const apiKey =
    (entry.apiKeyEnv ? process.env[entry.apiKeyEnv] : undefined) ??
    loadStore(opts.profile).find((c) => c.provider === providerId)?.access;
  const bound: { baseUrl: string; providerId: string; apiKey?: string } = {
    baseUrl: entry.baseUrl,
    providerId,
  };
  if (apiKey !== undefined) bound.apiKey = apiKey;
  const streamFn = await streamFor(entry.apiFormat, bound);
  const messages: ChatMessage[] = [{ role: "user", content: prompt }];
  const history = await runTurn({
    messages,
    model: ref,
    streamFn,
    tools: builtinTools(),
    maxSteps: opts.maxSteps ?? config.maxSteps ?? 30,
  });
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m?.role === "assistant") {
      console.log(m.content);
      return;
    }
  }
}
