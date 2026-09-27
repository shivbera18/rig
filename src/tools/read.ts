import fs from "node:fs";
import path from "node:path";
import type { Tool, ToolContext } from "./index.js";

export const readTool: Tool = {
  name: "read",
  description: "Read a file, optionally sliced by 0-based offset/limit (lines).",
  schema: {
    type: "object",
    required: ["path"],
    properties: {
      path: { type: "string" },
      offset: { type: "number" },
      limit: { type: "number" },
    },
  },
  async execute(
    args: unknown,
    ctx?: ToolContext,
  ): Promise<string> {
    const a = args as { path: string; offset?: number; limit?: number }; // tool args arrive as parsed JSON; loop validates JSON-ness, schema enforced by the model contract
    const p = path.resolve(ctx?.cwd ?? process.cwd(), a.path);
    let raw: string;
    try {
      raw = await fs.promises.readFile(p, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return `FileNotFound(${a.path})`;
      throw err;
    }
    const lines = raw.split("\n");
    const offset = a.offset ?? 0;
    const limit = a.limit ?? 200;
    return lines.slice(offset, offset + limit).join("\n");
  },
};
