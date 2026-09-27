import fs from "node:fs";
import path from "node:path";
import type { Tool, ToolContext } from "./index.js";

export const editTool: Tool = {
  name: "edit",
  description: "Exact-match string replace in a file (first occurrence only).",
  schema: {
    type: "object",
    required: ["path", "oldText", "newText"],
    properties: {
      path: { type: "string" },
      oldText: { type: "string" },
      newText: { type: "string" },
    },
  },
  async execute(
    args: unknown,
    ctx?: ToolContext,
  ): Promise<string> {
    const a = args as { path: string; oldText: string; newText: string }; // parsed-JSON tool args; see read.ts
    const p = path.resolve(ctx?.cwd ?? process.cwd(), a.path);
    let raw: string;
    try {
      raw = await fs.promises.readFile(p, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return `FileNotFound(${a.path})`;
      throw err;
    }
    const i = raw.indexOf(a.oldText);
    if (i < 0) return `error: oldText not found in ${a.path}`;
    await fs.promises.writeFile(p, raw.slice(0, i) + a.newText + raw.slice(i + a.oldText.length), "utf8");
    // Diff display is capped at 2000 chars and computed in a single pass:
    // per MINIMAX_CHANGES.md (2026-09-21), a second patch pass doubles cost
    // for no user-visible gain on a first-occurrence replace.
    const preview = `-${a.oldText}\n+${a.newText}`.slice(0, 2000);
    return `edited ${a.path}\n${preview}`;
  },
};
