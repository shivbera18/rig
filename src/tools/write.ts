import fs from "node:fs";
import path from "node:path";
import type { Tool, ToolContext } from "./index.js";

export const writeTool: Tool = {
  name: "write",
  description: "Write content to a file, creating parent directories as needed.",
  schema: {
    type: "object",
    required: ["path", "content"],
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
  },
  async execute(args: unknown, ctx?: ToolContext): Promise<string> {
    const a = args as { path: string; content: string }; // parsed-JSON tool args; see read.ts
    const p = path.resolve(ctx?.cwd ?? process.cwd(), a.path);
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    await fs.promises.writeFile(p, a.content, "utf8");
    return `wrote ${Buffer.byteLength(a.content, "utf8")} bytes to ${a.path}`;
  },
};
