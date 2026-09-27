import { spawn } from "node:child_process";
import type { Tool, ToolContext } from "./index.js";

const OUTPUT_CAP = 50 * 1024;

export const bashTool: Tool = {
  name: "bash",
  description: "Run a shell command, preserving exit code, signal, and partial output.",
  schema: {
    type: "object",
    required: ["command"],
    properties: {
      command: { type: "string" },
      timeoutMs: { type: "number" },
      cwd: { type: "string" },
    },
  },
  async execute(
    args: unknown,
    ctx?: ToolContext,
  ): Promise<string> {
    const a = args as { command: string; timeoutMs?: number; cwd?: string }; // parsed-JSON tool args; see read.ts
    // NOTE: executor form (not Promise.withResolvers) — tsconfig targets
    // ES2022 lib, which lacks withResolvers typings.
    return new Promise<string>((resolve) => {
      const child = spawn(a.command, {
        cwd: a.cwd ?? ctx?.cwd ?? process.cwd(),
        shell: true,
        timeout: a.timeoutMs ?? 120_000,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => {
        stdout += d.toString();
      });
      child.stderr.on("data", (d) => {
        stderr += d.toString();
      });
      if (ctx?.signal) {
        const sig = ctx.signal;
        if (sig.aborted) child.kill();
        else sig.addEventListener("abort", () => child.kill(), { once: true });
      }
      child.on("error", (err) => {
        resolve(`exit=<failed> signal=<none>\nerror: ${(err as Error).message}`);
      });
      child.on("close", (code, signal) => {
        stdout = stdout.slice(0, OUTPUT_CAP);
        stderr = stderr.slice(0, Math.max(0, OUTPUT_CAP - stdout.length));
        resolve(`exit=${code} signal=${signal}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
      });
    });
  },
};
