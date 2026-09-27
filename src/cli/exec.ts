import fs from "node:fs";
import path from "node:path";
import { getConfigPath, loadConfig } from "../config.js";
import { resolveRef, runOnce } from "./runner.js";
import { loadSession, mostRecentSession, newSessionId } from "../session/store.js";

export type ExecFormat = "text" | "json" | "stream-json";

export interface ExecOpts {
  model?: string;
  maxSteps?: number;
  profile?: string | undefined;
  session?: string | undefined;
  continue?: boolean;
  resume?: string | undefined;
  printSession?: boolean;
  format?: ExecFormat;
  output?: string | undefined;
  quiet?: boolean;
  input?: string | undefined;
  cwd?: string | undefined;
  file?: string[];
  timeout?: string | undefined;
  outputSchema?: string | undefined;
  diagnosticsDir?: string | undefined;
}

// Exit codes mirror the reference headless contract: 0 ok, 1 config,
// 2 runtime/tool failure, 3 timeout, 4 cancelled, 5 step/usage limit.
export const EXEC_EXIT = { success: 0, config: 1, runtime: 2, timeout: 3, cancelled: 4, limit: 5 };

export function parseDurationMs(raw: string): number {
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i);
  if (!m) throw new Error(`--timeout must look like 30s, 2m, 500ms (got "${raw}")`);
  const n = parseFloat(m[1] ?? "0");
  const unit = (m[2] ?? "s").toLowerCase();
  return Math.round(n * (unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? 60_000 : 3_600_000));
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  return new Promise((resolve) => {
    let out = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => {
      out += c;
    });
    process.stdin.on("end", () => resolve(out));
  });
}

async function resolvePrompt(arg: string | undefined, opts: ExecOpts): Promise<string> {
  if (opts.input !== undefined) {
    if (opts.input === "-") return (await readStdin()).trim();
    return fs.readFileSync(opts.input, "utf8").trim();
  }
  if (arg !== undefined && arg !== "") return arg;
  const piped = await readStdin();
  if (piped.trim()) return piped.trim();
  throw new Error("no prompt: pass [prompt], --input <file|->, or pipe stdin");
}

function withAttachments(prompt: string, files: string[] | undefined, cwd: string | undefined): string {
  if (!files || files.length === 0) return prompt;
  const parts = [prompt];
  for (const f of files) {
    const p = cwd ? path.resolve(cwd, f) : f;
    let body: string;
    try {
      body = fs.readFileSync(p, "utf8");
    } catch {
      throw new Error(`--file not found: ${f}`);
    }
    parts.push(`\n\n<attached file="${f}">\n${body.slice(0, 50_000)}\n</attached>`);
  }
  return parts.join("");
}

function validateSchema(text: string, schemaRaw: string): void {
  let schema: unknown;
  try {
    schema = schemaRaw.trim().startsWith("{") ? JSON.parse(schemaRaw) : JSON.parse(fs.readFileSync(schemaRaw, "utf8"));
  } catch {
    throw new Error("--output-schema must be a JSON Schema file or inline object");
  }
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error("final answer is not JSON, but --output-schema requires JSON");
  }
  const required =
    typeof schema === "object" && schema !== null && "required" in schema && Array.isArray(schema.required)
      ? (schema.required as unknown[])
      : [];
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw new Error("final answer must be a JSON object per --output-schema");
  }
  for (const key of required) {
    if (typeof key === "string" && !(key in doc)) {
      throw new Error(`final answer missing required key "${key}" per --output-schema`);
    }
  }
}

function writeDiagnostics(dir: string, record: Record<string, unknown>): void {
  fs.mkdirSync(dir, { recursive: true });
  const entries = fs.readdirSync(dir);
  if (entries.length > 0) throw new Error(`--diagnostics-dir must be a fresh directory: ${dir}`);
  fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify(record, null, 2));
}

export async function runExec(arg: string | undefined, opts: ExecOpts): Promise<void> {
  const started = Date.now();
  const fail = (code: number, message: string): never => {
    process.exitCode = code;
    throw new Error(`rig exec failed: ${message}`);
  };
  let workdir = process.cwd();
  try {
    if (opts.cwd) {
      fs.accessSync(opts.cwd);
      workdir = path.resolve(opts.cwd);
    } else {
      fs.accessSync(".git");
    }
  } catch {
    if (opts.cwd) fail(EXEC_EXIT.config, `workspace directory not found: ${opts.cwd}`);
    console.error("rig: warning: not a git repository; running in-place with isolation disabled");
  }

  let prompt: string;
  try {
    prompt = withAttachments(await resolvePrompt(arg, opts), opts.file, opts.cwd);
  } catch (err) {
    prompt = fail(EXEC_EXIT.config, err instanceof Error ? err.message : String(err));
  }
  void workdir;

  // --continue/--session: carry history forward instead of starting cold.
  const wanted = opts.resume ?? opts.session ?? (opts.continue === true ? mostRecentSession(opts.profile)?.id : undefined);
  if (opts.continue === true && wanted === undefined) fail(EXEC_EXIT.config, "no previous session found");
  if (wanted !== undefined && loadSession(wanted, opts.profile) === undefined && opts.session !== undefined) {
    // --session with an unknown id starts a fresh named thread.
  } else if (wanted !== undefined && loadSession(wanted, opts.profile) === undefined) {
    fail(EXEC_EXIT.config, `no session found: ${wanted}`);
  }
  const sessionId = wanted ?? opts.session ?? newSessionId();

  let timeoutMs: number | undefined;
  try {
    if (opts.timeout !== undefined) timeoutMs = parseDurationMs(opts.timeout);
  } catch (err) {
    fail(EXEC_EXIT.config, err instanceof Error ? err.message : String(err));
  }
  const controller = new AbortController();
  const timer = timeoutMs !== undefined ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  if (timer) timer.unref?.();

  const { config } = loadConfig(getConfigPath(undefined, opts.profile));
  let ref = "";
  try {
    ref = await resolveRef(opts.model, config);
  } catch (err) {
    fail(EXEC_EXIT.config, err instanceof Error ? err.message : String(err));
  }
  const events: Array<Record<string, unknown>> = [];
  const emit = (e: Record<string, unknown>): void => {
    events.push(e);
    if (opts.format === "stream-json") {
      const line = `${JSON.stringify(e)}\n`;
      if (opts.output !== undefined) fs.appendFileSync(opts.output, line);
      else process.stdout.write(line);
    }
  };
  let text = "";
  try {
    ({ text } = await runOnce(prompt, {
      model: opts.model,
      maxSteps: opts.maxSteps,
      profile: opts.profile,
      sessionId,
      signal: controller.signal,
      onText: (delta) => emit({ type: "text", delta, sessionId }),
      onToolStart: (name, args) => emit({ type: "tool-start", name, args, sessionId }),
      onToolEnd: (name, preview) => emit({ type: "tool-end", name, preview, sessionId }),
    }));
  } catch (err) {
    if (controller.signal.aborted) fail(EXEC_EXIT.timeout, `run timed out${timeoutMs ? ` after ${opts.timeout}` : ""}`);
    const msg = err instanceof Error ? err.message : String(err);
    if (/max steps/i.test(msg)) fail(EXEC_EXIT.limit, msg);
    fail(EXEC_EXIT.runtime, msg);
  } finally {
    clearTimeout(timer);
  }
  if (opts.outputSchema !== undefined) {
    try {
      validateSchema(text, opts.outputSchema);
    } catch (err) {
      fail(EXEC_EXIT.runtime, err instanceof Error ? err.message : String(err));
    }
  }
  const result = { sessionId, model: ref, prompt, text, durationMs: Date.now() - started };
  if (opts.diagnosticsDir !== undefined) {
    try {
      writeDiagnostics(opts.diagnosticsDir, { ...result, events: events.slice(0, 200) });
    } catch (err) {
      fail(EXEC_EXIT.config, err instanceof Error ? err.message : String(err));
    }
  }
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
  if (opts.printSession === true || opts.continue === true || opts.session !== undefined) {
    console.error(`session: ${sessionId}`);
  }
}
