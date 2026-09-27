import { readTool } from "./read.js";
import { writeTool } from "./write.js";
import { editTool } from "./edit.js";
import { bashTool } from "./bash.js";
import { webSearchTool } from "./web-search.js";
import { taskTool } from "./task.js";

export interface ToolContext {
  cwd?: string;
  signal?: AbortSignal;
}

export interface Tool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  execute(args: unknown, ctx?: ToolContext): Promise<string>;
}

const extra: Record<string, Tool> = {};

// Later slices add tools without touching this file.
export function registerTool(t: Tool): void {
  extra[t.name] = t;
}

export function builtinTools(): Tool[] {
  const base: Record<string, Tool> = {};
  for (const t of [readTool, writeTool, editTool, bashTool, webSearchTool, taskTool]) {
    base[t.name] = t;
  }
  return Object.values({ ...base, ...extra });
}
