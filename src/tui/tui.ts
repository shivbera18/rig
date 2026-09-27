import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
import { getConfigPath, getDataDir, loadConfig } from "../config.js";
import { LOGIN_PROVIDERS, setupHint } from "../auth/catalog.js";
import { loadStore } from "../auth/store.js";
import { listSessions, loadSession, mostRecentSession, newSessionId, saveSession } from "../session/store.js";
import { runOnce } from "../cli/runner.js";
import type { ChatMessage } from "../providers/types.js";

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

const BANNER = `${BOLD}${CYAN}  █▀█ ▄█ ▄▀█${RESET}
${BOLD}${CYAN}  █▀▄ ░█ █░█${RESET}  ${DIM}type /help · / to browse commands · Tab completes${RESET}`;

interface SlashDef {
  name: string;
  description: string;
  usage: string;
  args?: string;
}

const SLASH: SlashDef[] = [
  { name: "help", description: "Show available commands", usage: "/help" },
  { name: "new", description: "Start a fresh thread", usage: "/new" },
  { name: "model", description: "Show or set model (@smol @default @vision provider/model)", usage: "/model [ref]", args: "ref" },
  { name: "status", description: "Show account, model and session status", usage: "/status" },
  { name: "usage", description: "Show thread usage (messages, tool calls, est. tokens)", usage: "/usage" },
  { name: "context", description: "Show carried context snapshot", usage: "/context" },
  { name: "compact", description: "Summarise thread into a fresh compacted session", usage: "/compact [keep-last-n]", args: "n" },
  { name: "export", description: "Export thread as Markdown", usage: "/export [file]", args: "file" },
  { name: "copy", description: "Copy last answer to clipboard (pbcopy/xclip/clip fallback)", usage: "/copy" },
  { name: "sessions", description: "List saved sessions", usage: "/sessions" },
  { name: "resume", description: "Switch to a session", usage: "/resume <id>", args: "id" },
  { name: "fork", description: "Fork current thread under a new id", usage: "/fork" },
  { name: "rewind", description: "Drop last exchange from the thread", usage: "/rewind" },
  { name: "retry", description: "Re-run last prompt", usage: "/retry" },
  { name: "history", description: "Show prompt history", usage: "/history" },
  { name: "queue", description: "Queue a prompt while a run is live, or list queue", usage: "/queue [prompt]", args: "prompt" },
  { name: "stop", description: "Interrupt the live run", usage: "/stop" },
  { name: "login", description: "Log in to a provider", usage: "/login [provider]", args: "provider" },
  { name: "logout", description: "Remove credentials for a provider", usage: "/logout <provider>", args: "provider" },
  { name: "doctor", description: "Check config, creds and sessions", usage: "/doctor" },
  { name: "provider", description: "List configured providers and models", usage: "/provider" },
  { name: "agents", description: "List bundled agents", usage: "/agents" },
  { name: "tools", description: "List builtin tools", usage: "/tools" },
  { name: "permissions", description: "Show/ask write-approval mode (ask|auto)", usage: "/permissions [ask|auto]", args: "mode" },
  { name: "review", description: "Review thread: counts, errors, open questions", usage: "/review" },
  { name: "quit", description: "Exit", usage: "/quit" },
];

function helpText(): string {
  const rows = SLASH.map((c) => `  ${GREEN}/${c.name}${RESET}${c.args ? ` ${DIM}${c.args}${RESET}` : ""}  ${DIM}—${RESET} ${c.description}`);
  return `${BOLD}commands${RESET}\n${rows.join("\n")}\n${DIM}anything else is sent to the agent. Ctrl+C interrupts a run, again exits.${RESET}`;
}

function statusText(profile?: string | undefined, model?: string, sessionId?: string): string {
  const { config } = loadConfig(getConfigPath(undefined, profile));
  const creds = loadStore(profile);
  const models = Object.entries(config.provider).flatMap(([pid, e]) => Object.keys(e.models).map((m) => `${pid}/${m}`));
  const cur = sessionId ? loadSession(sessionId, profile) : undefined;
  return (
    `${DIM}model${RESET} ${model ?? config.defaultModel}  ` +
    `${DIM}providers${RESET} ${Object.keys(config.provider).join(", ") || "none"}  ` +
    `${DIM}models${RESET} ${models.length}  ` +
    `${DIM}creds${RESET} ${creds.length}  ` +
    `${DIM}sessions${RESET} ${listSessions(profile).length}` +
    (cur ? `  ${DIM}thread${RESET} ${cur.id} (${cur.messages.length} msgs)` : "")
  );
}

function usageText(sessionId: string, profile?: string | undefined): string {
  const s = loadSession(sessionId, profile);
  if (!s) return "no active thread";
  const users = s.messages.filter((m) => m.role === "user").length;
  const assistants = s.messages.filter((m) => m.role === "assistant").length;
  const tools = s.messages.filter((m) => m.role === "toolResult").length;
  const chars = s.messages.reduce((n, m) => n + m.content.length, 0);
  return `thread ${s.id}\n  model: ${s.model}\n  prompts: ${users}  answers: ${assistants}  tool results: ${tools}\n  ~${Math.round(chars / 4)} est. tokens (${chars} chars)`;
}

function contextText(sessionId: string, profile?: string | undefined): string {
  const s = loadSession(sessionId, profile);
  if (!s) return "no active thread";
  const tail = s.messages.slice(-8);
  const lines = tail.map((m) => {
    const tag = m.role === "user" ? "you" : m.role === "assistant" ? "rig" : `tool:${m.name ?? ""}`;
    const first = m.content.split("\n")[0]?.slice(0, 100) ?? "";
    return `  ${DIM}${tag}${RESET} ${first}${m.content.length > 100 ? "…" : ""}`;
  });
  return `last ${tail.length}/${s.messages.length} messages:\n${lines.join("\n")}`;
}

function threadMarkdown(sessionId: string, profile?: string | undefined): string {
  const s = loadSession(sessionId, profile);
  if (!s) return "";
  const out = [`# rig session ${s.id}`, ``, `model: ${s.model}`, ``];
  for (const m of s.messages) {
    if (m.role === "user") out.push(`## you`, ``, m.content, ``);
    else if (m.role === "assistant") out.push(`## rig`, ``, m.content, ``);
    else out.push(`<details><summary>tool ${m.name ?? ""}</summary>`, ``, "```", m.content.slice(0, 4000), "```", `</details>`, ``);
  }
  return out.join("\n");
}

function fuzzy(hay: string, needle: string): boolean {
  let j = 0;
  const h = hay.toLowerCase();
  const n = needle.toLowerCase();
  for (const ch of h) {
    if (ch === n[j]) j++;
    if (j >= n.length) return true;
  }
  return j >= n.length;
}

function completeSlash(frag: string): string[] {
  return SLASH.filter((c) => fuzzy(c.name, frag)).map((c) => `/${c.name}`);
}

async function copyToClipboard(text: string): Promise<boolean> {
  const { execFile } = await import("node:child_process");
  const attempt = (cmd: string, args: string[]): Promise<boolean> =>
    new Promise((resolve) => {
      const p = execFile(cmd, args, (err) => resolve(!err));
      p.stdin?.write(text);
      p.stdin?.end();
    });
  if (process.platform === "darwin") return attempt("pbcopy", []);
  if (process.platform === "win32") return attempt("clip", []);
  if (await attempt("xclip", ["-selection", "clipboard"])) return true;
  return attempt("xsel", ["--clipboard", "--input"]);
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
  let lastPrompt: string | undefined;

  console.log(BANNER);
  console.log(statusText(opts.profile, model, sessionId));
  if (loadSession(sessionId, opts.profile) !== undefined) console.log(`${DIM}resumed ${sessionId}${RESET}`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${BOLD}›${RESET} `,
    completer: (line: string) => {
      const m = line.match(/(^|\s)(\/\w*)$/);
      if (!m) return [[], line] as [[string[], string][number][], string];
      return [completeSlash((m[2] ?? "/").slice(1)), m[2] ?? "/"];
    },
  });

  let running: Promise<void> | undefined;
  let abort: AbortController | undefined;

  rl.on("SIGINT", () => {
    if (running && abort) abort.abort();
    else rl.close();
  });

  const ask = (): void => rl.prompt();
  readline.emitKeypressEvents(process.stdin);
  process.stdin.on("keypress", (_ch: unknown, key?: { name?: string }) => {
    if (key?.name !== "up" && key?.name !== "down") return;
    if (promptHistory.length === 0) return;
    if (histIdx < 0) histIdx = promptHistory.length;
    histIdx += key.name === "up" ? -1 : 1;
    histIdx = Math.max(0, Math.min(promptHistory.length, histIdx));
    rl.write(null, { ctrl: true, name: "u" });
    rl.write(promptHistory[histIdx] ?? "");
  });

  async function runPrompt(text: string): Promise<void> {
    abort = new AbortController();
    const { signal } = abort;
    lastPrompt = text;
    running = (async () => {
      try {
        const started = Date.now();
        let first = true;
        const { text: answer, sessionId: id } = await runOnce(text, {
          model,
          maxSteps: opts.maxSteps ?? config.maxSteps ?? 30,
          profile: opts.profile,
          sessionId,
          signal,
          onText: (delta) => {
            if (first) {
              process.stdout.write("\n");
              first = false;
            }
            process.stdout.write(delta);
          },
          onToolStart: (name, args) => {
            let summary = "";
            try {
              const parsed = JSON.parse(args) as { path?: string; command?: string; query?: string };
              summary = parsed.path ?? parsed.command ?? parsed.query ?? "";
            } catch {
              summary = args.slice(0, 80);
            }
            process.stdout.write(`\n${DIM}· ${name}${summary ? ` ${summary.slice(0, 80)}` : ""}${RESET}\n`);
          },
          onToolEnd: (name, preview) => {
            if (preview.startsWith("error:")) process.stdout.write(`${YELLOW}  ${name}: ${preview.slice(0, 160)}${RESET}\n`);
          },
        });
        sessionId = id;
        process.stdout.write(`\n${DIM}(${(Date.now() - started) / 1000}s · ${id})${RESET}\n`);
        void answer;
      } catch (err) {
        if (signal.aborted) console.log(`${YELLOW}interrupted${RESET}`);
        else console.log(`${YELLOW}error: ${err instanceof Error ? err.message : String(err)}${RESET}`);
      } finally {
        running = undefined;
        abort = undefined;
      }
    })();
    await running;
    while (queue.length > 0 && !signal.aborted) {
      const next = queue.shift();
      if (next === undefined) break;
      console.log(`${DIM}queued ›${RESET} ${next.slice(0, 120)}`);
      await runPrompt(next);
    }
  }

  ask();
  for await (const line of rl) {
    histIdx = -1;
    const text = line.trimEnd();
    if (!text.trim()) {
      ask();
      continue;
    }
    const cmd = text.trim();
    const [head, ...rest] = cmd.split(/\s+/);
    const args = rest.join(" ").trim();

    if (running) {
      if (head === "/queue" && args) {
        queue.push(args);
        console.log(`${DIM}queued (${queue.length})${RESET}`);
      } else if (head === "/queue") {
        console.log(queue.length === 0 ? "queue empty" : queue.map((q, i) => `  ${i + 1}. ${q.slice(0, 100)}`).join("\n"));
      } else if (head === "/stop") {
        abort?.abort();
      } else {
        queue.push(cmd);
        console.log(`${DIM}run live — queued (${queue.length}); /stop interrupts${RESET}`);
      }
      ask();
      continue;
    }

    if (cmd === "/" ) {
      console.log(helpText());
      ask();
      continue;
    }
    switch (head) {
      case "/quit":
      case "/exit":
        rl.close();
        return;
      case "/help":
      case "/?":
        console.log(helpText());
        break;
      case "/new":
        sessionId = newSessionId();
        console.log(`${DIM}new thread ${sessionId}${RESET}`);
        break;
      case "/sessions": {
        const rows = listSessions(opts.profile);
        if (rows.length === 0) console.log("no sessions");
        for (const s of rows.slice(0, 15)) {
          console.log(`${s.id === sessionId ? "*" : " "} ${s.id}  ${s.model}  ${s.messages.length} msgs`);
        }
        break;
      }
      case "/resume": {
        if (!args || loadSession(args, opts.profile) === undefined) {
          const rows = listSessions(opts.profile).slice(0, 10);
          console.log(`${YELLOW}no session found: ${args}${RESET}`);
          if (rows.length > 0) {
            console.log("recent:");
            for (const s of rows) console.log(`  ${s.id}  ${s.model}  ${s.messages.length} msgs`);
          }
        } else {
          sessionId = args;
          console.log(`${DIM}resumed ${args}${RESET}`);
        }
        break;
      }
      case "/fork": {
        const cur = loadSession(sessionId, opts.profile);
        if (!cur) {
          console.log("nothing to fork");
          break;
        }
        const id = newSessionId();
        saveSession({ ...cur, id, updatedAtMs: Date.now() }, opts.profile);
        sessionId = id;
        console.log(`${DIM}forked → ${id}${RESET}`);
        break;
      }
      case "/rewind": {
        const cur = loadSession(sessionId, opts.profile);
        if (!cur || cur.messages.length === 0) {
          console.log("nothing to rewind");
          break;
        }
        // Drop trailing tool chatter then the last user+answer pair.
        const msgs: ChatMessage[] = cur.messages.slice();
        while (msgs.length > 0 && msgs[msgs.length - 1]?.role === "toolResult") msgs.pop();
        if (msgs.length > 0 && msgs[msgs.length - 1]?.role === "assistant") msgs.pop();
        if (msgs.length > 0 && msgs[msgs.length - 1]?.role === "user") msgs.pop();
        saveSession({ ...cur, messages: msgs, updatedAtMs: Date.now() }, opts.profile);
        console.log(`${DIM}rewound to ${msgs.length} msgs${RESET}`);
        break;
      }
      case "/retry": {
        if (!lastPrompt) {
          console.log("nothing to retry");
          break;
        }
        remember(lastPrompt);
        await runPrompt(lastPrompt);
        break;
      }
      case "/history": {
        const tail = promptHistory.slice(-15);
        console.log(tail.length === 0 ? "no history" : tail.map((h, i) => `  ${i + 1}. ${h.slice(0, 100)}`).join("\n"));
        break;
      }
      case "/model": {
        if (!args) {
          console.log(`${model}${DIM}  (usage: /model @smol|@default|@vision|provider/model)${RESET}`);
        } else {
          model = args;
          console.log(`${DIM}model → ${args}${RESET}`);
        }
        break;
      }
      case "/status":
        console.log(statusText(opts.profile, model, sessionId));
        break;
      case "/usage":
        console.log(usageText(sessionId, opts.profile));
        break;
      case "/context":
        console.log(contextText(sessionId, opts.profile));
        break;
      case "/compact": {
        const cur = loadSession(sessionId, opts.profile);
        if (!cur) {
          console.log("nothing to compact");
          break;
        }
        const keep = Math.max(0, parseInt(args || "6", 10) || 6);
        const kept = cur.messages.slice(-keep * 2);
        const digest = threadMarkdown(sessionId, opts.profile)
          .split("\n")
          .filter((l) => l.startsWith("## ") || l.startsWith("model:"))
          .slice(0, 20)
          .join(" | ")
          .slice(0, 500);
        const id = newSessionId();
        saveSession(
          {
            id,
            model: cur.model,
            messages: [
              { role: "user", content: `Continuing compacted thread ${cur.id}. Summary: ${digest}` },
              ...kept,
            ],
            updatedAtMs: Date.now(),
          },
          opts.profile,
        );
        sessionId = id;
        console.log(`${DIM}compacted ${cur.messages.length} → ${kept.length + 1} msgs in ${id}${RESET}`);
        break;
      }
      case "/export": {
        const md = threadMarkdown(sessionId, opts.profile);
        if (!md) {
          console.log("nothing to export");
          break;
        }
        if (args) {
          fs.writeFileSync(args, md);
          console.log(`${DIM}exported to ${args}${RESET}`);
        } else {
          console.log(md);
        }
        break;
      }
      case "/copy": {
        const cur = loadSession(sessionId, opts.profile);
        const last = cur ? [...cur.messages].reverse().find((m) => m.role === "assistant") : undefined;
        if (!last) {
          console.log("nothing to copy");
          break;
        }
        console.log((await copyToClipboard(last.content)) ? `${DIM}copied${RESET}` : `${YELLOW}clipboard unavailable${RESET}`);
        break;
      }
      case "/queue": {
        if (!args) {
          console.log(queue.length === 0 ? "queue empty" : queue.map((q, i) => `  ${i + 1}. ${q.slice(0, 100)}`).join("\n"));
        } else {
          await runPrompt(args);
        }
        break;
      }
      case "/stop":
        console.log("no live run");
        break;
      case "/login": {
        if (!args) {
          const avail = LOGIN_PROVIDERS.map((p, i) => `  ${i + 1}. ${p.id} — ${p.name}`).join("\n");
          const missing = ["google-antigravity", "openai-codex"]
            .map((id) => `  ${DIM}${id} — ${setupHint(id)}${RESET}`)
            .join("\n");
          console.log(`${avail}\n${missing}`);
        } else {
          const { runLogin } = await import("../auth/cli.js");
          await runLogin(args, { profile: opts.profile });
        }
        break;
      }
      case "/logout": {
        if (!args) {
          console.log(`usage: /logout <provider>`);
        } else {
          const { runLogout } = await import("../auth/cli.js");
          await runLogout(args, { profile: opts.profile });
        }
        break;
      }
      case "/doctor": {
        const { config, path: cfgPath } = loadConfig(getConfigPath(undefined, opts.profile));
        const creds = loadStore(opts.profile);
        console.log(`config: ${cfgPath}`);
        console.log(`providers: ${Object.keys(config.provider).join(", ") || "none"}`);
        console.log(`creds: ${creds.length}${creds.length ? ` (${creds.map((c) => `${c.provider}/${c.id}`).join(", ")})` : ""}`);
        console.log(`sessions: ${listSessions(opts.profile).length}`);
        console.log(`node: ${process.version}  cwd: ${process.cwd()}`);
        break;
      }
      case "/provider": {
        const { config } = loadConfig(getConfigPath(undefined, opts.profile));
        for (const [id, entry] of Object.entries(config.provider)) {
          console.log(`${GREEN}${id}${RESET} (${entry.apiFormat}) ${entry.baseUrl}`);
          for (const m of Object.keys(entry.models)) console.log(`  - ${m}`);
        }
        break;
      }
      case "/agents": {
        const { builtinTools } = await import("../tools/index.js");
        const names = builtinTools().map((t) => t.name);
        const { getAgent } = await import("../agents/definitions.js");
        for (const a of ["task", "sonic", "scout", "reviewer"]) {
          try {
            const def = getAgent(a);
            const tools = def.tools ? def.tools.filter((t) => names.includes(t)) : names;
            console.log(`  ${a} (${def.model ?? "@default"}) — ${def.description} [${tools.join(", ")}]`);
          } catch {
            console.log(`${RED}  ${a} — missing${RESET}`);
          }
        }
        break;
      }
      case "/tools": {
        const { builtinTools } = await import("../tools/index.js");
        console.log(builtinTools().map((t) => `  ${t.name} — ${t.description}`).join("\n"));
        break;
      }
      case "/permissions": {
        if (!args) {
          console.log(`write approval: ${approval}  (usage: /permissions ask|auto)`);
        } else if (args === "ask" || args === "auto") {
          approval = args;
          console.log(`${DIM}write approval → ${args}${RESET}`);
        } else {
          console.log(`usage: /permissions ask|auto`);
        }
        break;
      }
      case "/review": {
        const cur = loadSession(sessionId, opts.profile);
        if (!cur) {
          console.log("nothing to review");
          break;
        }
        const errs = cur.messages.filter((m) => m.role === "toolResult" && m.content.startsWith("error:")).length;
        const tools = cur.messages.filter((m) => m.role === "toolResult").length;
        console.log(`thread ${cur.id}: ${cur.messages.length} msgs, ${tools} tool results, ${errs} errors`);
        if (errs > 0) console.log(`${YELLOW}open: ${errs} tool error(s) unresolved${RESET}`);
        else console.log(`${GREEN}no open tool errors${RESET}`);
        break;
      }
      default: {
        if (head.startsWith("/") && head !== "//") {
          const hits = completeSlash(head.slice(1));
          if (hits.length === 1) console.log(`${YELLOW}did you mean ${hits[0]}?${RESET}`);
          else if (hits.length > 1) console.log(`${YELLOW}did you mean one of: ${hits.join(", ")}?${RESET}`);
          else console.log(`${YELLOW}unknown command; /help lists commands${RESET}`);
          break;
        }
        remember(cmd);
        await runPrompt(cmd);
      }
    }
    ask();
  }
}
