import type { Config } from "../config.js";

const SEARCH_RE = /sonar|tavily|brave|search|perplexity/i;
const VISION_RE = /vision|gpt-4o|claude-3|gemini/i;

function allModels(config: Config): string[] {
  const out: string[] = [];
  for (const [pid, entry] of Object.entries(config.provider ?? {})) {
    for (const mid of Object.keys(entry.models ?? {})) out.push(`${pid}/${mid}`);
  }
  return out;
}

export const MODEL_ROLES: Record<string, { description: string; accepts: (modelId: string) => boolean }> = {
  default: { description: "Default chat model", accepts: () => true },
  smol: { description: "Cheap/fast model for mechanical tasks", accepts: () => true },
  vision: { description: "Vision-capable model", accepts: () => true },
  task: { description: "General subagent model", accepts: () => true },
  web: { description: "Search-capable model", accepts: (m) => SEARCH_RE.test(m) },
};

export function isRoleRef(s: string): boolean {
  return s.startsWith("@");
}

export function resolveRoleChain(ref: string, config: Config): string {
  switch (ref) {
    case "@default":
      return config.defaultModel;
    case "@smol":
      return config.defaultLightModel ?? config.defaultModel;
    case "@task":
      return config.defaultModel;
    case "@vision": {
      const hit = allModels(config).find((m) => VISION_RE.test(m));
      return hit ?? config.defaultModel;
    }
    case "@web": {
      const hit = allModels(config).find((m) => SEARCH_RE.test(m));
      if (!hit) throw new Error("no search-capable model configured for @web");
      return hit;
    }
    default:
      throw new Error(`unknown model role ${ref}`);
  }
}
