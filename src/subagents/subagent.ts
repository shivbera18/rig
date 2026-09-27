import { createHash, randomUUID } from "node:crypto";
import {
  cleanupIsolation,
  collectDelta,
  ensureIsolation,
  mergeDelta,
} from "./worktree.js";
import { SchemaMismatchError, truncateOutput } from "./workpool.js";

export { SchemaMismatchError } from "./workpool.js";

export const DEFAULT_SPAWN_AGENT = "task";

export type IsolationRequest = { enabled: boolean; merge: "patch" };

export interface RunSubagentRequest {
  assignment: string;
  agent?: string;
  model?: string;
  schema?: Record<string, unknown>;
  isolation: IsolationRequest;
  cwd?: string;
  signal?: AbortSignal;
  depth?: number;
}

export type SubagentHandler = (
  req: RunSubagentRequest & { workdir: string; agent: string },
) => Promise<string>;

let subagentHandler: SubagentHandler | undefined;

export function setSubagentHandler(h: SubagentHandler): void {
  subagentHandler = h;
}

export function canSpawnAtDepth(depth: number, maxRecursionDepth = 3): boolean {
  return depth < maxRecursionDepth;
}

export function resolveSpawnAgent(parentSpawns: string | undefined, requested?: string): string {
  if (requested) return requested;
  if (parentSpawns === undefined || parentSpawns === "*") return DEFAULT_SPAWN_AGENT;
  const allowed = parentSpawns
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length === 0) throw new Error("parent agent may not spawn subagents");
  return allowed[0];
}

function validateSchema(output: string, schema: Record<string, unknown>, worker: string): string {
  const required =
    schema.required && Array.isArray(schema.required) ? (schema.required as string[]) : [];
  if (required.length === 0) return output;
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new SchemaMismatchError(`${worker} output is not valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new SchemaMismatchError(`${worker} output must be a JSON object`);
  }
  for (const key of required) {
    if (!(key in (parsed as Record<string, unknown>))) {
      throw new SchemaMismatchError(`${worker} output missing required key "${key}"`);
    }
  }
  return output;
}

export async function runSubagent(req: RunSubagentRequest): Promise<string> {
  const depth = req.depth ?? 0;
  if (!canSpawnAtDepth(depth)) {
    throw new Error(`max subagent recursion depth reached at depth ${depth}`);
  }
  if (!subagentHandler) throw new Error("no subagent handler registered");
  const cwd = req.cwd ?? process.cwd();
  const agent = resolveSpawnAgent("*", req.agent);

  if (!req.isolation.enabled) {
    const out = truncateOutput(await subagentHandler({ ...req, agent, workdir: cwd }));
    return req.schema ? validateSchema(out, req.schema, `agent "${agent}"`) : out;
  }

  const id = `${Date.now()}-${randomUUID()}-${createHash("sha1").update(req.assignment).digest("hex").slice(0, 6)}`;
  const iso = ensureIsolation(cwd, id);
  if (!iso.enabled) {
    const out = truncateOutput(await subagentHandler({ ...req, agent, workdir: cwd }));
    return req.schema ? validateSchema(out, req.schema, `agent "${agent}"`) : out;
  }
  let out: string;
  try {
    out = truncateOutput(await subagentHandler({ ...req, agent, workdir: iso.dir }));
  } catch (err) {
    console.error(`rig: subagent failed; isolated worktree retained at ${iso.dir}`);
    throw err;
  }
  let checked: string;
  try {
    checked = req.schema ? validateSchema(out, req.schema, `agent "${agent}"`) : out;
  } catch (err) {
    console.error(`rig: subagent output rejected; isolated worktree retained at ${iso.dir}`);
    throw err;
  }
  const patch = collectDelta(iso.dir);
  mergeDelta(cwd, patch, iso.dir);
  cleanupIsolation(cwd, iso.dir);
  return checked;
}
