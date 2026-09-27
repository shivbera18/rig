import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import YAML from "yaml";

export class RigConfigError extends Error {}

export interface ModelEntry {
  contextLimit: number;
}

export interface ProviderEntry {
  baseUrl: string;
  apiFormat: "openai-completions" | "openai-responses" | "anthropic-messages";
  apiKeyEnv?: string;
  models: Record<string, ModelEntry>;
}

export interface AgentsConfig {
  defaults?: string;
}

export interface Config {
  defaultModel: string;
  defaultLightModel?: string;
  provider: Record<string, ProviderEntry>;
  agents: AgentsConfig;
  maxSteps?: number;
  maxConcurrency?: number;
}

const KNOWN_KEYS: Record<string, true> = {
  defaultModel: true,
  defaultLightModel: true,
  provider: true,
  agents: true,
  maxSteps: true,
  maxConcurrency: true,
};

const MINIMAL_TEMPLATE = `# rig config
defaultModel: opencode-zen/big-pickle
provider: {}
agents: {}
`;
export function getDataDir(explicitProfile?: string | undefined): string {
  if (process.env.RIG_DATA_DIR) return process.env.RIG_DATA_DIR;
  const p = explicitProfile ?? process.env.RIG_PROFILE ?? undefined;
  return path.join(os.homedir(), p ? `.rig-${p}` : ".rig");
}

export function getConfigPath(dataDir?: string | undefined, explicitProfile?: string | undefined): string {
  return path.join(dataDir ?? getDataDir(explicitProfile), "config.yaml");
}

export function loadConfig(configPath?: string): { config: Config; path: string } {
  const p = configPath ?? getConfigPath();
  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, MINIMAL_TEMPLATE, "utf8");
      console.log(`created config at ${p}`);
      raw = MINIMAL_TEMPLATE;
    } else {
      throw err;
    }
  }
  let doc: unknown;
  try {
    doc = YAML.parse(raw);
  } catch (err) {
    throw new RigConfigError(`invalid YAML in ${p}: ${(err as Error).message}`);
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw new RigConfigError(`config root must be an object: ${p}`);
  }
  const obj = doc as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS[key]) {
      throw new RigConfigError(`unknown config key "${key}" in ${p}`);
    }
  }
  const config = obj as unknown as Config;
  if (typeof config.defaultModel !== "string" || !config.defaultModel) {
    config.defaultModel = "opencode-zen/big-pickle";
  }
  if (config.provider == null || typeof config.provider !== "object") {
    config.provider = {};
  }
  if (config.agents == null || typeof config.agents !== "object") {
    config.agents = {};
  }
  return { config, path: p };
}
