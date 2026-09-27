import fs from "node:fs";
import { getConfigPath, loadConfig } from "../config.js";
import { resolveRef, runOnce } from "./runner.js";
import { loadSession, mostRecentSession, newSessionId } from "../session/store.js";

export interface ExecOpts {
  model?: string;
  maxSteps?: number;
  profile?: string | undefined;
  session?: string | undefined;
  continue?: boolean;
  resume?: string | undefined;
  printSession?: boolean;
  format?: "text" | "json" | "stream-json";
  output?: string | undefined;
  quiet?: boolean;
}

export async function runExec(prompt: string, opts: ExecOpts): Promise<void> {
  try {
    fs.accessSync(".git");
  } catch {
    console.error("rig: warning: not a git repository; running in-place with isolation disabled");
  }
  // --continue/--resume/--session: carry history forward instead of starting cold.
  // --session <id> forks/extends a named thread; --resume <id>/--continue reuse one.
  const wanted =
    opts.resume ?? opts.session ?? (opts.continue === true ? mostRecentSession(opts.profile)?.id : undefined);
  if (opts.continue === true && wanted === undefined) throw new Error("no previous session found");
  if (opts.resume !== undefined && wanted === undefined) throw new Error("no session found");
  if (wanted !== undefined && loadSession(wanted, opts.profile) === undefined && opts.session !== undefined) {
    // --session with an unknown id starts a fresh named thread.
  } else if (wanted !== undefined && loadSession(wanted, opts.profile) === undefined) {
    throw new Error(`no session found: ${wanted}`);
  }
  const sessionId = wanted ?? (opts.session === undefined ? undefined : opts.session) ?? newSessionId();
  const { config } = loadConfig(getConfigPath(undefined, opts.profile));
  const ref = await resolveRef(opts.model, config);
  const started = Date.now();
  const events: Array<Record<string, unknown>> = [];
  const emit = (e: Record<string, unknown>): void => {
    events.push(e);
    if (opts.format === "stream-json") {
      const line = `${JSON.stringify(e)}\n`;
      if (opts.output !== undefined) fs.appendFileSync(opts.output, line);
      else process.stdout.write(line);
    }
  };
  const { text } = await runOnce(prompt, {
    model: opts.model,
    maxSteps: opts.maxSteps,
    profile: opts.profile,
    sessionId,
    onText: (delta) => emit({ type: "text", delta, sessionId }),
    onToolStart: (name, args) => emit({ type: "tool-start", name, args, sessionId }),
    onToolEnd: (name, preview) => emit({ type: "tool-end", name, preview, sessionId }),
  });
  const result = {
    sessionId,
    model: ref,
    prompt,
    text,
    durationMs: Date.now() - started,
  };
  if (opts.format === "json") {
    const line = `${JSON.stringify(result)}\n`;
    if (opts.output !== undefined) fs.writeFileSync(opts.output, line);
    else console.log(line.trimEnd());
  } else if (opts.format === "stream-json") {
    emit({ type: "result", ...result });
  } else if (opts.quiet !== true) {
    if (opts.output !== undefined) fs.writeFileSync(opts.output, text.endsWith("\n") ? text : `${text}\n`);
    else console.log(text);
  } else if (opts.output !== undefined) {
    fs.writeFileSync(opts.output, text.endsWith("\n") ? text : `${text}\n`);
  }
  if (opts.printSession === true || opts.resume !== undefined || opts.continue === true || opts.session !== undefined) {
    console.error(`session: ${sessionId}`);
  }
}
