import fs from "node:fs";
import path from "node:path";
import { getConfigPath, getDataDir, loadConfig } from "../config.js";
import { listSessions, loadSession, mostRecentSession, newSessionId } from "../session/store.js";
import { runOnce } from "../cli/runner.js";
import { Screen, padToWidth, truncateToWidth, visibleWidth, wrapText } from "./screen.js";
import { attachSuggest } from "./suggest.js";
import { completeSlash, contextLines, dispatchSlash, helpLines, statusLines, usageLines } from "./commands.js";
import type { CommandCtx } from "./commands.js";

export interface TuiOpts {
  model?: string;
  maxSteps?: number;
  profile?: string | undefined;
  session?: string | undefined;
  continue?: boolean;
}

const DIM = "\u001b[2m";
const BOLD = "\u001b[1m";
const GREEN = "\u001b[32m";
const YELLOW = "\u001b[33m";
const CYAN = "\u001b[36m";
const RED = "\u001b[31m";
const RESET = "\u001b[0m";

const MARK = [`${BOLD}${CYAN}  ○─╮${RESET}`, `${BOLD}${CYAN}  ○─╯▌${RESET}`];

interface Line {
  text: string;
  kind: "plain" | "dim" | "user" | "rig" | "rig-stream" | "tool" | "error" | "ok";
}

export async function runTui(opts: TuiOpts): Promise<void> {
  const { config } = loadConfig(getConfigPath(undefined, opts.profile));
  let model = opts.model ?? config.defaultModel;
  let sessionId =
    opts.session ?? (opts.continue === true ? mostRecentSession(opts.profile)?.id : undefined) ?? newSessionId();
  if (opts.continue === true && loadSession(sessionId, opts.profile) === undefined) {
    throw new Error("no previous session found");
  }
  let approval: "ask" | "auto" = "ask";
  let planMode = false;
  let goal: string | undefined;
  const extraDirs: string[] = [];
  const deniedTools: Record<string, true> = {};
  const allowedTools: Record<string, true> = {};
  const historyFile = path.join(getDataDir(opts.profile), "tui-history");
  let promptHistory: string[] = [];
  try {
    promptHistory = fs.readFileSync(historyFile, "utf8").split("\n").filter(Boolean).slice(-200);
  } catch {
    // no history yet
  }
  const remember = (line: string): void => {
    if (!line.trim() || promptHistory[promptHistory.length - 1] === line) return;
    promptHistory.push(line);
    if (promptHistory.length > 200) promptHistory = promptHistory.slice(-200);
    try {
      fs.mkdirSync(path.dirname(historyFile), { recursive: true });
      fs.writeFileSync(historyFile, promptHistory.join("\n"));
    } catch {
      // history is best-effort
    }
  };
  let histIdx = -1;
  const queue: string[] = [];
  const tasks: Array<{ label: string; status: string; atMs: number }> = [];
  let lastPrompt: string | undefined;

  // Scrollback transcript (plain strings; color applied at paint time).
  const feed: Line[] = [];
  const push = (text: string, kind: Line["kind"] = "plain"): void => {
    for (const part of text.split("\n")) feed.push({ text: part, kind });
    paint();
  };
  const pushLines = (lines: string[]): void => {
    for (const l of lines) push(l);
  };

  // Composer state.
  let input = "";
  let cursor = 0;
  let running = false;
  let abort: AbortController | undefined;
  let suggest: Array<[string, string]> = [];
  let suggestIdx = 0;
  let suggestOn = false;
  let spinner = 0;
  let exited = false;

  const screen = new Screen();
  const paint = (): void => {
    if (!screen.isActive || exited) return;
    const w = screen.width;
    const h = screen.height;
    const lines: string[] = [];
    // Header: mark + status, always visible.
    lines.push(...MARK);
    for (const s of statusLines(opts.profile, model, sessionId, DIM, RESET)) {
      for (const wrapped of wrapText(s, w)) lines.push(`${DIM}${wrapped}${RESET}`);
    }
    lines.push(`${DIM}${"─".repeat(Math.max(8, Math.min(w, 80)))}${RESET}`);
    // Transcript viewport: last N lines above composer.
    const reserved = 6 + (suggestOn ? Math.min(suggest.length, 8) + 2 : 0);
    const room = Math.max(4, h - lines.length - reserved);
    const tail = feed.slice(-room);
    for (const l of tail) {
      const prefix =
        l.kind === "user" ? `${BOLD}› ${RESET}` : l.kind === "rig" ? `${CYAN}◈ ${RESET}` : l.kind === "tool" ? `${DIM}· ${RESET}` : l.kind === "error" ? `${YELLOW}! ${RESET}` : l.kind === "ok" ? `${GREEN}✓ ${RESET}` : "";
      const style =
        l.kind === "user" ? BOLD : l.kind === "error" ? YELLOW : l.kind === "dim" || l.kind === "tool" ? DIM : "";
      for (const wrapped of wrapText(`${prefix}${l.text}`, w)) {
        lines.push(style ? `${style}${wrapped}${RESET}` : wrapped);
      }
    }
    while (lines.length < h - reserved + 2) lines.push("");
    // Slash overlay above composer.
    if (suggestOn && suggest.length > 0) {
      lines.push(`${DIM}  ${suggest.length} commands — Tab to cycle, Enter to accept${RESET}`);
      suggest.slice(0, 8).forEach(([cmd, desc], i) => {
        const mark = i === suggestIdx ? `${GREEN}›${RESET}` : " ";
        lines.push(`${mark} ${GREEN}${cmd}${RESET}  ${DIM}${desc.slice(0, Math.max(20, w - 30))}${RESET}`);
      });
    }
    // Composer.
    const prompt = running ? `${YELLOW}◌${RESET} ` : `${BOLD}›${RESET} `;
    const before = input.slice(0, cursor);
    const after = input.slice(cursor);
    const shown = truncateToWidth(`${before}▊${after}`, w - 4);
    lines.push(`${prompt}${shown}`);
    // Status bar.
    const bar = running
      ? `${YELLOW}running${["⠋", "⠙", "⠹", "⠸", "⠼", "⠴"][spinner % 6]}${RESET}  ${DIM}Ctrl+C interrupts · /stop · /queue${RESET}`
      : `${DIM}${model} · ${sessionId.slice(0, 8)} · Tab completes / · ↑/↓ history · Ctrl+C quits${RESET}`;
    lines.push(padToWidth(truncateToWidth(bar, w), w));
    screen.paint(lines);
  };

  const refreshSuggest = (): void => {
    const m = input.match(/(^|\s)(\/\w*)$/);
    if (!m || running) {
      suggestOn = false;
      suggest = [];
      return;
    }
    suggest = completeSlash((m[2] ?? "/").slice(1)).slice(0, 8);
    suggestIdx = 0;
    suggestOn = suggest.length > 0;
  };

  const ctx: CommandCtx = {
    profile: opts.profile,
    get model() {
      return model;
    },
    setModel(m: string) {
      model = m;
    },
    get sessionId() {
      return sessionId;
    },
    setSessionId(id: string) {
      sessionId = id;
    },
    get approval() {
      return approval;
    },
    setApproval(a: "ask" | "auto") {
      approval = a;
    },
    get planMode() {
      return planMode;
    },
    setPlanMode(b: boolean) {
      planMode = b;
    },
    get goal() {
      return goal;
    },
    setGoal(g: string | undefined) {
      goal = g;
    },
    queue,
    tasks,
    promptHistory,
    get lastPrompt() {
      return lastPrompt;
    },
    setLastPrompt(p: string | undefined) {
      lastPrompt = p;
    },
    remember,
    extraDirs,
    deniedTools,
    allowedTools,
    runPrompt,
  };

  async function runPrompt(text: string): Promise<void> {
    abort = new AbortController();
    const { signal } = abort;
    lastPrompt = text;
    const effective = planMode ? `[plan mode: investigate and propose a plan, do not modify files] ${text}` : text;
    const goalPrefix = goal ? `[session goal: ${goal}] ` : "";
    running = true;
    paint();
    const spin = setInterval(() => {
      spinner++;
      paint();
    }, 120);
    try {
      const started = Date.now();
      let first = true;
      const { text: answer, sessionId: id } = await runOnce(`${goalPrefix}${effective}`, {
        model,
        maxSteps: opts.maxSteps ?? config.maxSteps ?? 30,
        profile: opts.profile,
        sessionId,
        signal,
        onText: (delta) => {
          if (first) {
            push("", "plain");
            first = false;
          }
          const last = feed[feed.length - 1];
          if (last && last.kind === "rig-stream") {
            last.text += delta;
          } else {
            feed.push({ text: delta, kind: "rig-stream" as Line["kind"] });
          }
          paint();
        },
        onToolStart: (name, args) => {
          let summary = "";
          try {
            const parsed = JSON.parse(args) as { path?: string; command?: string; query?: string };
            summary = parsed.path ?? parsed.command ?? parsed.query ?? "";
          } catch {
            summary = args.slice(0, 80);
          }
          push(`· ${name}${summary ? ` ${summary.slice(0, 80)}` : ""}`, "tool");
        },
        onToolEnd: (name, preview) => {
          if (preview.startsWith("error:")) push(`${name}: ${preview.slice(0, 160)}`, "error");
        },
      });
      sessionId = id;
      // Fold the stream into a final answer line.
      for (let i = feed.length - 1; i >= 0; i--) {
        if ((feed[i]?.kind as string) === "rig-stream") feed.splice(i, 1);
      }
      push(answer, "plain");
      push(`(${(Date.now() - started) / 1000}s · ${id})`, "dim");
      tasks.push({ label: text.slice(0, 100), status: "done", atMs: Date.now() });
    } catch (err) {
      tasks.push({ label: text.slice(0, 100), status: signal.aborted ? "interrupted" : "error", atMs: Date.now() });
      if (signal.aborted) push("interrupted", "error");
      else push(`error: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      clearInterval(spin);
      running = false;
      abort = undefined;
    }
    paint();
    while (queue.length > 0 && !signal.aborted) {
      const next = queue.shift();
      if (next === undefined) break;
      push(`queued › ${next.slice(0, 120)}`, "dim");
      await runPrompt(next);
    }
    paint();
  }

  async function submit(): Promise<void> {
    const text = input;
    input = "";
    cursor = 0;
    histIdx = -1;
    suggestOn = false;
    if (!text.trim()) {
      paint();
      return;
    }
    const cmd = text.trim();
    const [head, ...rest] = cmd.split(/\s+/);
    const args = rest.join(" ").trim();
    if (running) {
      if (head === "/queue" && args) {
        queue.push(args);
        push(`queued (${queue.length})`, "dim");
      } else if (head === "/queue") {
        push(queue.length === 0 ? "queue empty" : queue.map((q, i) => `  ${i + 1}. ${q.slice(0, 100)}`).join("\n"), "dim");
      } else if (head === "/stop") {
        abort?.abort();
      } else {
        queue.push(cmd);
        push(`run live — queued (${queue.length}); /stop interrupts`, "dim");
      }
      paint();
      return;
    }
    if (cmd === "/") {
      pushLines(helpLines(GREEN, DIM, RESET, BOLD));
      paint();
      return;
    }
    if (cmd.startsWith("/")) {
      const first = cmd.split(/\s+/)[0];
      if (first === "/login" || first === "/logout" || first === "/auth-refresh") {
        // These run interactive stdin prompts: leave alt-screen first.
        screen.stop();
        process.stdin.removeListener("data", onData);
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
      }
      push(`› ${cmd}`, "user");
      const r = await dispatchSlash(cmd, ctx, (lines) => pushLines(lines), {
        dim: DIM,
        green: GREEN,
        yellow: YELLOW,
        red: RED,
        reset: RESET,
        bold: BOLD,
        cyan: CYAN,
      });
      if (first === "/login" || first === "/logout" || first === "/auth-refresh") {
        // Back to fullscreen: re-enter alt-screen, raw mode, listener.
        screen.start(() => paint());
        process.stdin.on("data", onData);
        if (process.stdin.isTTY) process.stdin.setRawMode(true);
      }
      if (r === "quit") {
        exited = true;
        screen.stop();
        return;
      }
      paint();
      return;
    }
  }

  // Raw key handling: printable chars, navigation, Tab cycling, history.
  const onData = (buf: Buffer): void => {
    const s = buf.toString("utf8");
    if (s === "\x03") {
      // Ctrl+C: interrupt run, or quit when idle.
      if (running && abort) {
        abort.abort();
        return;
      }
      exited = true;
      screen.stop();
      process.exit(0);
    }
    if (running) {
      if (s === "\x1b") abort?.abort();
      return;
    }
    if (s === "\r" || s === "\n") {
      void submit();
      return;
    }
    if (s === "\x7f" || s === "\b") {
      if (cursor > 0) {
        input = input.slice(0, cursor - 1) + input.slice(cursor);
        cursor--;
        refreshSuggest();
        paint();
      }
      return;
    }
    if (s === "\x1b[A") {
      if (suggestOn && suggest.length > 0) {
        suggestIdx = (suggestIdx - 1 + suggest.length) % suggest.length;
        paint();
        return;
      }
      if (promptHistory.length === 0) return;
      if (histIdx < 0) histIdx = promptHistory.length;
      histIdx = Math.max(0, histIdx - 1);
      input = promptHistory[histIdx] ?? "";
      cursor = input.length;
      refreshSuggest();
      paint();
      return;
    }
    if (s === "\x1b[B") {
      if (suggestOn && suggest.length > 0) {
        suggestIdx = (suggestIdx + 1) % suggest.length;
        paint();
        return;
      }
      if (histIdx < 0) return;
      histIdx = Math.min(promptHistory.length, histIdx + 1);
      input = histIdx >= promptHistory.length ? "" : (promptHistory[histIdx] ?? "");
      cursor = input.length;
      refreshSuggest();
      paint();
      return;
    }
    if (s === "\x1b[D") {
      cursor = Math.max(0, cursor - 1);
      paint();
      return;
    }
    if (s === "\x1b[C") {
      cursor = Math.min(input.length, cursor + 1);
      paint();
      return;
    }
    if (s === "\t") {
      if (suggestOn && suggest.length > 0) {
        const pick = suggest[suggestIdx]?.[0];
        if (pick) {
          input = input.replace(/\/\w*$/, pick) + " ";
          cursor = input.length;
          suggestOn = false;
          paint();
        }
      }
      return;
    }
    if (s.startsWith("\x1b")) return;
    if (s >= " " || s === "\t") {
      input = input.slice(0, cursor) + s + input.slice(cursor);
      cursor += s.length;
      refreshSuggest();
      paint();
    }
  };

  // Seed transcript from a resumed thread.
  const resumed = loadSession(sessionId, opts.profile);
  if (resumed) {
    push(`resumed ${sessionId} (${resumed.messages.length} msgs)`, "dim");
    for (const m of resumed.messages.slice(-6)) {
      if (m.role === "user") push(m.content.slice(0, 300), "user");
      else if (m.role === "assistant") push(m.content.slice(0, 500), "plain");
    }
  } else {
    push("type /help · / to browse commands · Tab completes", "dim");
  }

  screen.start(() => paint());
  process.stdin.on("data", onData);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  paint();
  await new Promise<void>((resolve) => {
    const check = (): void => {
      if (exited) resolve();
      else setTimeout(check, 100).unref?.();
    };
    check();
  });
  process.stdin.removeListener("data", onData);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  screen.stop();
  void attachUnused;
  void visibleWidth;
}

function attachUnused(): void {
  // Placeholder to keep suggest helper importable without cycles.
  void completeSlash;
  void contextLines;
  void usageLines;
  void helpLines;
}

void listSessions;
void mostRecentSession;
void newSessionId;
