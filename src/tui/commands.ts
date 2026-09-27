import fs from "node:fs";
import path from "node:path";
import { getConfigPath, getDataDir, loadConfig } from "../config.js";
import { LOGIN_PROVIDERS, setupHint } from "../auth/catalog.js";
import { loadStore } from "../auth/store.js";
import { listSessions, loadSession } from "../session/store.js";
import type { ChatMessage } from "../providers/types.js";

export interface SlashDef {
  name: string;
  description: string;
  usage: string;
  args?: string;
}

export const SLASH: SlashDef[] = [
  { name: "help", description: "Show available commands", usage: "/help" },
  { name: "new", description: "Start a fresh thread", usage: "/new" },
  { name: "model", description: "Show or set model (@smol @default @vision provider/model)", usage: "/model [ref]", args: "ref" },
  { name: "status", description: "Show account, model and session status", usage: "/status" },
  { name: "usage", description: "Show thread usage (messages, tool calls, est. tokens)", usage: "/usage" },
  { name: "context", description: "Show carried context snapshot", usage: "/context" },
  { name: "compact", description: "Summarise thread into a fresh compacted session", usage: "/compact [keep-last-n]", args: "n" },
  { name: "export", description: "Export thread as Markdown", usage: "/export [file]", args: "file" },
  { name: "copy", description: "Copy last answer to clipboard", usage: "/copy" },
  { name: "sessions", description: "List saved sessions", usage: "/sessions" },
  { name: "resume", description: "Switch to a session", usage: "/resume <id>", args: "id" },
  { name: "fork", description: "Fork current thread under a new id", usage: "/fork" },
  { name: "rewind", description: "Drop last exchange from the thread", usage: "/rewind" },
  { name: "retry", description: "Re-run last prompt", usage: "/retry" },
  { name: "rename", description: "Rename the active session", usage: "/rename <name>", args: "name" },
  { name: "archive", description: "Archive the active session", usage: "/archive" },
  { name: "history", description: "Show prompt history", usage: "/history" },
  { name: "transcript", description: "Browse the full thread with message numbers", usage: "/transcript [n]", args: "n" },
  { name: "queue", description: "Queue a prompt while a run is live, or list queue", usage: "/queue [prompt]", args: "prompt" },
  { name: "stop", description: "Interrupt the live run", usage: "/stop" },
  { name: "steer", description: "Queue a steering note without interrupting the run", usage: "/steer <note>", args: "note" },
  { name: "login", description: "Log in to a provider", usage: "/login [provider]", args: "provider" },
  { name: "logout", description: "Remove credentials for a provider", usage: "/logout <provider>", args: "provider" },
  { name: "auth-status", description: "Show every stored account", usage: "/auth-status" },
  { name: "auth-refresh", description: "Refresh refreshable credentials now", usage: "/auth-refresh" },
  { name: "auth-use", description: "Prefer one stored account", usage: "/auth-use <provider> <id>", args: "provider id" },
  { name: "doctor", description: "Check config, creds and sessions", usage: "/doctor" },
  { name: "provider", description: "List configured providers and models", usage: "/provider" },
  { name: "agents", description: "List bundled agents", usage: "/agents" },
  { name: "config", description: "Show effective read-only configuration", usage: "/config" },
  { name: "settings", description: "Show runtime settings", usage: "/settings" },
  { name: "theme", description: "Choose accent color (cyan|green|yellow|none)", usage: "/theme [color]", args: "color" },
  { name: "tools", description: "List builtin tools", usage: "/tools" },
  { name: "allow", description: "Allowlist a tool for this session", usage: "/allow <tool>", args: "tool" },
  { name: "deny", description: "Block a tool for this session", usage: "/deny <tool>", args: "tool" },
  { name: "permissions", description: "Show write-approval mode (ask|auto)", usage: "/permissions [ask|auto]", args: "mode" },
  { name: "plan", description: "Switch plan mode or view the working plan", usage: "/plan [on|off|show]", args: "mode" },
  { name: "goal", description: "Set or show the session goal", usage: "/goal [text]", args: "text" },
  { name: "tasks", description: "Inspect queued and finished runs", usage: "/tasks" },
  { name: "add-dir", description: "Add a working directory to context", usage: "/add-dir <path>", args: "path" },
  { name: "changelog", description: "Show recent rig changes", usage: "/changelog" },
  { name: "hotkeys", description: "Show keyboard shortcuts", usage: "/hotkeys" },
  { name: "update", description: "Check for rig updates (add --install to apply)", usage: "/update [--install]", args: "flags" },
  { name: "review", description: "Review thread: counts, errors, open questions", usage: "/review" },
  { name: "feedback", description: "Save redacted feedback to the data dir", usage: "/feedback <text>", args: "text" },
  { name: "quit", description: "Exit", usage: "/quit" },
];

export function fuzzyScore(hay: string, needle: string): number {
  if (!needle) return 1;
  const h = hay.toLowerCase();
  const n = needle.toLowerCase();
  if (h.startsWith(n)) return 3;
  if (h.includes(n)) return 2;
  let j = 0;
  for (const ch of h) {
    if (ch === n[j]) j++;
    if (j >= n.length) return 1;
  }
  return 0;
}

export function completeSlash(frag: string): Array<[string, string]> {
  return SLASH.map((c) => ({ c, s: fuzzyScore(c.name, frag) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.c.name.localeCompare(b.c.name))
    .map((r) => [`/${r.c.name}`, r.c.description]);
}

export function helpLines(green: string, dim: string, reset: string, bold: string): string[] {
  const rows = SLASH.map(
    (c) => `  ${green}/${c.name}${reset}${c.args ? ` ${dim}${c.args}${reset}` : ""}  ${dim}—${reset} ${c.description}`,
  );
  return [
    `${bold}commands${reset}`,
    ...rows,
    `${dim}anything else is sent to the agent. Ctrl+C interrupts a run, again exits.${reset}`,
  ];
}

export function statusLines(
  profile: string | undefined,
  model: string | undefined,
  sessionId: string | undefined,
  dim: string,
  reset: string,
): string[] {
  const { config } = loadConfig(getConfigPath(undefined, profile));
  const creds = loadStore(profile);
  const models = Object.entries(config.provider).flatMap(([pid, e]) => Object.keys(e.models).map((m) => `${pid}/${m}`));
  const cur = sessionId ? loadSession(sessionId, profile) : undefined;
  return [
    `${dim}model${reset} ${model ?? config.defaultModel}  ` +
      `${dim}providers${reset} ${Object.keys(config.provider).join(", ") || "none"}  ` +
      `${dim}models${reset} ${models.length}  ` +
      `${dim}creds${reset} ${creds.length}  ` +
      `${dim}sessions${reset} ${listSessions(profile).length}` +
      (cur ? `  ${dim}thread${reset} ${cur.id} (${cur.messages.length} msgs)` : ""),
  ];
}

export function threadMarkdown(sessionId: string, profile: string | undefined): string {
  const s = loadSession(sessionId, profile);
  if (!s) return "";
  const out = [`# rig session ${s.id}`, ``, `model: ${s.model}`, ``];
  for (const m of s.messages) {
    if (m.role === "user") out.push(`## you`, ``, m.content, ``);
    else if (m.role === "assistant") out.push(`## rig`, ``, m.content, ``);
    else
      out.push(
        `<details><summary>tool ${m.name ?? ""}</summary>`,
        ``,
        "```",
        m.content.slice(0, 4000),
        "```",
        `</details>`,
        ``,
      );
  }
  return out.join("\n");
}

export function usageLines(sessionId: string, profile: string | undefined): string[] {
  const s = loadSession(sessionId, profile);
  if (!s) return ["no active thread"];
  const users = s.messages.filter((m) => m.role === "user").length;
  const assistants = s.messages.filter((m) => m.role === "assistant").length;
  const tools = s.messages.filter((m) => m.role === "toolResult").length;
  const chars = s.messages.reduce((n, m) => n + m.content.length, 0);
  return [
    `thread ${s.id}`,
    `  model: ${s.model}`,
    `  prompts: ${users}  answers: ${assistants}  tool results: ${tools}`,
    `  ~${Math.round(chars / 4)} est. tokens (${chars} chars)`,
  ];
}

export function contextLines(sessionId: string, profile: string | undefined, dim: string, reset: string): string[] {
  const s = loadSession(sessionId, profile);
  if (!s) return ["no active thread"];
  const tail = s.messages.slice(-8);
  return [
    `last ${tail.length}/${s.messages.length} messages:`,
    ...tail.map((m) => {
      const tag = m.role === "user" ? "you" : m.role === "assistant" ? "rig" : `tool:${m.name ?? ""}`;
      const first = m.content.split("\n")[0]?.slice(0, 100) ?? "";
      return `  ${dim}${tag}${reset} ${first}${m.content.length > 100 ? "…" : ""}`;
    }),
  ];
}

export async function copyToClipboard(text: string): Promise<boolean> {
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

export interface CommandCtx {
  profile: string | undefined;
  model: string;
  setModel(m: string): void;
  sessionId: string;
  setSessionId(id: string): void;
  approval: "ask" | "auto";
  setApproval(a: "ask" | "auto"): void;
  planMode: boolean;
  setPlanMode(b: boolean): void;
  goal: string | undefined;
  setGoal(g: string | undefined): void;
  queue: string[];
  tasks: Array<{ label: string; status: string; atMs: number }>;
  promptHistory: string[];
  lastPrompt: string | undefined;
  setLastPrompt(p: string | undefined): void;
  remember(line: string): void;
  extraDirs: string[];
  deniedTools: Record<string, true>;
  allowedTools: Record<string, true>;
  runPrompt(text: string): Promise<void>;
}

// Pure dispatch: every slash command appends printable lines, mutates ctx,
// and returns "quit" only for /quit//exit. The screen layer owns rendering.
export async function dispatchSlash(
  raw: string,
  ctx: CommandCtx,
  out: (lines: string[]) => void,
  colors: { dim: string; green: string; yellow: string; red: string; reset: string; bold: string; cyan: string },
): Promise<"quit" | "continue"> {
  const { dim, green, yellow, red, reset, bold } = colors;
  const cmd = raw.trim();
  const [head, ...rest] = cmd.split(/\s+/);
  const args = rest.join(" ").trim();
  const needSession = (): ChatMessage[] | undefined => {
    const cur = loadSession(ctx.sessionId, ctx.profile);
    if (!cur) {
      out(["no active thread"]);
      return undefined;
    }
    return cur.messages;
  };

  switch (head) {
    case "/quit":
    case "/exit":
      return "quit";
    case "/help":
    case "/?":
      out(helpLines(green, dim, reset, bold));
      return "continue";
    case "/new":
      ctx.setSessionId((await import("../session/store.js")).newSessionId());
      out([`${dim}new thread ${ctx.sessionId}${reset}`]);
      return "continue";
    case "/sessions": {
      const { listSessions } = await import("../session/store.js");
      const rows = listSessions(ctx.profile);
      if (rows.length === 0) out(["no sessions"]);
      else out(rows.slice(0, 15).map((s) => `${s.id === ctx.sessionId ? "*" : " "} ${s.id}  ${s.model}  ${s.messages.length} msgs`));
      return "continue";
    }
    case "/resume": {
      if (!args || loadSession(args, ctx.profile) === undefined) {
        const { listSessions } = await import("../session/store.js");
        const rows = listSessions(ctx.profile).slice(0, 10);
        out([`${yellow}no session found: ${args}${reset}`, ...(rows.length > 0 ? ["recent:", ...rows.map((s) => `  ${s.id}  ${s.model}  ${s.messages.length} msgs`)] : [])]);
      } else {
        ctx.setSessionId(args);
        out([`${dim}resumed ${args}${reset}`]);
      }
      return "continue";
    }
    case "/fork": {
      const { newSessionId, saveSession } = await import("../session/store.js");
      const cur = loadSession(ctx.sessionId, ctx.profile);
      if (!cur) {
        out(["nothing to fork"]);
        return "continue";
      }
      const id = newSessionId();
      saveSession({ ...cur, id, updatedAtMs: Date.now() }, ctx.profile);
      ctx.setSessionId(id);
      out([`${dim}forked → ${id}${reset}`]);
      return "continue";
    }
    case "/rewind": {
      const { saveSession } = await import("../session/store.js");
      const cur = loadSession(ctx.sessionId, ctx.profile);
      if (!cur || cur.messages.length === 0) {
        out(["nothing to rewind"]);
        return "continue";
      }
      const msgs: ChatMessage[] = cur.messages.slice();
      while (msgs.length > 0 && msgs[msgs.length - 1]?.role === "toolResult") msgs.pop();
      if (msgs.length > 0 && msgs[msgs.length - 1]?.role === "assistant") msgs.pop();
      if (msgs.length > 0 && msgs[msgs.length - 1]?.role === "user") msgs.pop();
      saveSession({ ...cur, messages: msgs, updatedAtMs: Date.now() }, ctx.profile);
      out([`${dim}rewound to ${msgs.length} msgs${reset}`]);
      return "continue";
    }
    case "/retry": {
      if (!ctx.lastPrompt) {
        out(["nothing to retry"]);
        return "continue";
      }
      ctx.remember(ctx.lastPrompt);
      await ctx.runPrompt(ctx.lastPrompt);
      return "continue";
    }
    case "/rename": {
      const { saveSession } = await import("../session/store.js");
      const cur = loadSession(ctx.sessionId, ctx.profile);
      if (!cur) {
        out(["no active thread"]);
        return "continue";
      }
      if (!args) {
        out([cur.name ? `name: ${cur.name}` : "usage: /rename <name>"]);
        return "continue";
      }
      saveSession({ ...cur, name: args.slice(0, 80), updatedAtMs: Date.now() }, ctx.profile);
      out([`${dim}renamed → ${args.slice(0, 80)}${reset}`]);
      return "continue";
    }
    case "/archive": {
      const { newSessionId, saveSession } = await import("../session/store.js");
      const cur = loadSession(ctx.sessionId, ctx.profile);
      if (!cur) {
        out(["no active thread"]);
        return "continue";
      }
      saveSession({ ...cur, archived: true, updatedAtMs: Date.now() }, ctx.profile);
      ctx.setSessionId(newSessionId());
      out([`${dim}archived; new thread ${ctx.sessionId}${reset}`]);
      return "continue";
    }
    case "/history": {
      const tail = ctx.promptHistory.slice(-15);
      out([tail.length === 0 ? "no history" : tail.map((h, i) => `  ${i + 1}. ${h.slice(0, 100)}`).join("\n")]);
      return "continue";
    }
    case "/transcript": {
      const cur = loadSession(ctx.sessionId, ctx.profile);
      if (!cur) {
        out(["no active thread"]);
        return "continue";
      }
      const n = Math.max(1, parseInt(args || "20", 10) || 20);
      const tail = cur.messages.slice(-n);
      const start = cur.messages.length - tail.length;
      out(
        tail.map((m, i) => {
          const tag = m.role === "user" ? "you" : m.role === "assistant" ? "rig" : `tool:${m.name ?? ""}`;
          return `${dim}[${start + i}]${reset} ${green}${tag}${reset}: ${m.content.slice(0, 300)}${m.content.length > 300 ? "…" : ""}`;
        }),
      );
      return "continue";
    }
    case "/model": {
      if (!args) out([`${ctx.model}${dim}  (usage: /model @smol|@default|@vision|provider/model)${reset}`]);
      else {
        ctx.setModel(args);
        out([`${dim}model → ${args}${reset}`]);
      }
      return "continue";
    }
    case "/status":
      out(statusLines(ctx.profile, ctx.model, ctx.sessionId, dim, reset));
      return "continue";
    case "/usage":
      out(usageLines(ctx.sessionId, ctx.profile));
      return "continue";
    case "/context":
      out(contextLines(ctx.sessionId, ctx.profile, dim, reset));
      return "continue";
    case "/compact": {
      const { newSessionId, saveSession } = await import("../session/store.js");
      const cur = loadSession(ctx.sessionId, ctx.profile);
      if (!cur) {
        out(["nothing to compact"]);
        return "continue";
      }
      const keep = Math.max(0, parseInt(args || "6", 10) || 6);
      const kept = cur.messages.slice(-keep * 2);
      const digest = threadMarkdown(ctx.sessionId, ctx.profile)
        .split("\n")
        .filter((l) => l.startsWith("## ") || l.startsWith("model:"))
        .slice(0, 20)
        .join(" | ")
        .slice(0, 500);
      const id = newSessionId();
      saveSession(
        { id, model: cur.model, messages: [{ role: "user", content: `Continuing compacted thread ${cur.id}. Summary: ${digest}` }, ...kept], updatedAtMs: Date.now() },
        ctx.profile,
      );
      ctx.setSessionId(id);
      out([`${dim}compacted ${cur.messages.length} → ${kept.length + 1} msgs in ${id}${reset}`]);
      return "continue";
    }
    case "/export": {
      const md = threadMarkdown(ctx.sessionId, ctx.profile);
      if (!md) {
        out(["nothing to export"]);
        return "continue";
      }
      if (args) {
        fs.writeFileSync(args, md);
        out([`${dim}exported to ${args}${reset}`]);
      } else {
        out(md.split("\n"));
      }
      return "continue";
    }
    case "/copy": {
      const cur = loadSession(ctx.sessionId, ctx.profile);
      const last = cur ? [...cur.messages].reverse().find((m) => m.role === "assistant") : undefined;
      if (!last) {
        out(["nothing to copy"]);
        return "continue";
      }
      out([(await copyToClipboard(last.content)) ? `${dim}copied${reset}` : `${yellow}clipboard unavailable${reset}`]);
      return "continue";
    }
    case "/queue": {
      if (!args) {
        out([ctx.queue.length === 0 ? "queue empty" : ctx.queue.map((q, i) => `  ${i + 1}. ${q.slice(0, 100)}`).join("\n")]);
      } else {
        await ctx.runPrompt(args);
      }
      return "continue";
    }
    case "/stop":
      out(["no live run"]);
      return "continue";
    case "/steer": {
      if (!args) out(["usage: /steer <note>"]);
      else {
        ctx.queue.unshift(`[steering] ${args}`);
        out([`${dim}steering note queued first (${ctx.queue.length})${reset}`]);
      }
      return "continue";
    }
    case "/login": {
      if (!args) {
        out([...LOGIN_PROVIDERS.map((p, i) => `  ${i + 1}. ${p.id} — ${p.name}`), ...["google-antigravity", "openai-codex"].map((id) => `  ${dim}${id} — ${setupHint(id)}${reset}`)]);
      } else {
        const { runLogin } = await import("../auth/cli.js");
        await runLogin(args, { profile: ctx.profile });
        out([]);
      }
      return "continue";
    }
    case "/logout": {
      if (!args) out(["usage: /logout <provider>"]);
      else {
        const { runLogout } = await import("../auth/cli.js");
        await runLogout(args, { profile: ctx.profile });
        out([]);
      }
      return "continue";
    }
    case "/auth-status": {
      const { runAuthStatus } = await import("../auth/cli.js");
      await runAuthStatus({ profile: ctx.profile });
      out([]);
      return "continue";
    }
    case "/auth-refresh": {
      const { runAuthRefresh } = await import("../auth/cli.js");
      await runAuthRefresh({ profile: ctx.profile });
      out([]);
      return "continue";
    }
    case "/auth-use": {
      const [provider, id] = args.split(/\s+/);
      if (!provider || !id) out(["usage: /auth-use <provider> <id>"]);
      else {
        const { runAuthUse } = await import("../auth/cli.js");
        await runAuthUse(provider, id, { profile: ctx.profile });
        out([]);
      }
      return "continue";
    }
    case "/doctor": {
      const { config, path: cfgPath } = loadConfig(getConfigPath(undefined, ctx.profile));
      const creds = loadStore(ctx.profile);
      const { listSessions } = await import("../session/store.js");
      out([
        `config: ${cfgPath}`,
        `providers: ${Object.keys(config.provider).join(", ") || "none"}`,
        `creds: ${creds.length}${creds.length ? ` (${creds.map((c) => `${c.provider}/${c.id}`).join(", ")})` : ""}`,
        `sessions: ${listSessions(ctx.profile).length}`,
        `node: ${process.version}  cwd: ${process.cwd()}`,
      ]);
      return "continue";
    }
    case "/provider": {
      const { config } = loadConfig(getConfigPath(undefined, ctx.profile));
      out(
        Object.entries(config.provider).flatMap(([id, entry]) => [
          `${green}${id}${reset} (${entry.apiFormat}) ${entry.baseUrl}`,
          ...Object.keys(entry.models).map((m) => `  - ${m}`),
        ]),
      );
      return "continue";
    }
    case "/agents": {
      const { builtinTools } = await import("../tools/index.js");
      const names = builtinTools().map((t) => t.name);
      const { getAgent } = await import("../agents/definitions.js");
      out(
        ["task", "sonic", "scout", "reviewer"].map((a) => {
          try {
            const def = getAgent(a);
            const tools = def.tools ? def.tools.filter((t) => names.includes(t)) : names;
            return `  ${a} (${def.model ?? "@default"}) — ${def.description} [${tools.join(", ")}]`;
          } catch {
            return `${red}  ${a} — missing${reset}`;
          }
        }),
      );
      return "continue";
    }
    case "/tools": {
      const { builtinTools } = await import("../tools/index.js");
      out(builtinTools().map((t) => `  ${t.name} — ${t.description}`));
      return "continue";
    }
    case "/allow": {
      if (!args) out(["usage: /allow <tool>"]);
      else {
        ctx.allowedTools[args] = true;
        delete ctx.deniedTools[args];
        out([`${dim}${args} allowlisted for this session${reset}`]);
      }
      return "continue";
    }
    case "/deny": {
      if (!args) out(["usage: /deny <tool>"]);
      else {
        ctx.deniedTools[args] = true;
        delete ctx.allowedTools[args];
        out([`${dim}${args} blocked for this session${reset}`]);
      }
      return "continue";
    }
    case "/permissions": {
      if (!args) out([`write approval: ${ctx.approval}  (usage: /permissions ask|auto)`]);
      else if (args === "ask" || args === "auto") {
        ctx.setApproval(args);
        out([`${dim}write approval → ${args}${reset}`]);
      } else out(["usage: /permissions ask|auto"]);
      return "continue";
    }
    case "/update": {
      const { planUpdate } = await import("../update/update.js");
      try {
        const plan = await planUpdate();
        if (!plan.needed) out([`rig ${plan.current} — already latest`]);
        else if (args.includes("--install") || args.includes("-y")) {
          const { runUpdate } = await import("../update/update.js");
          await runUpdate({ yes: true });
          out([]);
        } else out([`update available: ${plan.current} → ${plan.latest}  (/update --install to apply)`]);
      } catch (err) {
        out([`${yellow}error: ${err instanceof Error ? err.message : String(err)}${reset}`]);
      }
      return "continue";
    }
    case "/config": {
      const { config, path: cfgPath } = loadConfig(getConfigPath(undefined, ctx.profile));
      out([
        `config: ${cfgPath}`,
        `defaultModel: ${config.defaultModel}`,
        `defaultLightModel: ${config.defaultLightModel ?? "(unset)"}`,
        `maxSteps: ${config.maxSteps ?? 30}  maxConcurrency: ${config.maxConcurrency ?? 4}`,
        `providers: ${Object.keys(config.provider).join(", ") || "none"}`,
      ]);
      return "continue";
    }
    case "/settings":
      out([`approval: ${ctx.approval}  planMode: ${ctx.planMode ? "on" : "off"}`, `goal: ${ctx.goal ?? "(unset)"}  dirs: ${[process.cwd(), ...ctx.extraDirs].join(", ")}`, `profile: ${ctx.profile ?? "(default)"}  thread: ${ctx.sessionId}`]);
      return "continue";
    case "/theme":
      out(["theme is fixed in this build (cyan accents)"]);
      return "continue";
    case "/plan": {
      if (!args || args === "show") out([ctx.planMode ? "plan mode: on (proposes, does not modify)" : "plan mode: off"]);
      else if (args === "on") {
        ctx.setPlanMode(true);
        out([`${dim}plan mode on${reset}`]);
      } else if (args === "off") {
        ctx.setPlanMode(false);
        out([`${dim}plan mode off${reset}`]);
      } else out(["usage: /plan [on|off|show]"]);
      return "continue";
    }
    case "/goal": {
      if (!args) out([ctx.goal ? `goal: ${ctx.goal}` : "no goal set (usage: /goal <text>)"]);
      else {
        ctx.setGoal(args.slice(0, 300));
        out([`${dim}goal set${reset}`]);
      }
      return "continue";
    }
    case "/tasks": {
      if (ctx.tasks.length === 0 && ctx.queue.length === 0) out(["no runs yet"]);
      else
        out([
          ...ctx.tasks.slice(-10).map((t) => `  [${t.status}] ${t.label.slice(0, 90)} (${new Date(t.atMs).toLocaleTimeString()})`),
          ...(ctx.queue.length > 0 ? [`  queued: ${ctx.queue.length}`] : []),
        ]);
      return "continue";
    }
    case "/add-dir": {
      if (!args) out([`dirs: ${[process.cwd(), ...ctx.extraDirs].join("\n  ")}`]);
      else {
        try {
          fs.accessSync(args);
          ctx.extraDirs.push(args);
          out([`${dim}added ${args}${reset}`]);
        } catch {
          out([`${yellow}not found: ${args}${reset}`]);
        }
      }
      return "continue";
    }
    case "/changelog":
      out(["v0.5.0 — live slash suggestions, headless contract, arrow-key login picker", "v0.4.2 — merge-mark banner in TUI, logo wired to tabs and manifest", "v0.4.1 — updater retries with force on existing shims"]);
      return "continue";
    case "/hotkeys":
      out(["  Tab — complete /command", "  ↑/↓ — prompt history", "  Ctrl+C — interrupt run, again exits", "  Enter — send"]);
      return "continue";
    case "/feedback": {
      if (!args) out(["usage: /feedback <text>"]);
      else {
        const fp = path.join(getDataDir(ctx.profile), "feedback.log");
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        const redacted = args.replace(/(sk-|api[_-]?key=)[^\s]+/gi, "$1…");
        fs.appendFileSync(fp, `${new Date().toISOString()} ${redacted.slice(0, 500)}\n`);
        out([`${dim}thanks — saved${reset}`]);
      }
      return "continue";
    }
    case "/review": {
      const cur = loadSession(ctx.sessionId, ctx.profile);
      if (!cur) {
        out(["nothing to review"]);
        return "continue";
      }
      const errs = cur.messages.filter((m) => m.role === "toolResult" && m.content.startsWith("error:")).length;
      const tools = cur.messages.filter((m) => m.role === "toolResult").length;
      out([
        `thread ${cur.id}: ${cur.messages.length} msgs, ${tools} tool results, ${errs} errors`,
        errs > 0 ? `${yellow}open: ${errs} tool error(s) unresolved${reset}` : `${green}no open tool errors${reset}`,
      ]);
      return "continue";
    }
    default: {
      if (head.startsWith("/") && head !== "//") {
        const hits = completeSlash(head.slice(1));
        if (hits.length === 1) out([`${yellow}did you mean ${hits[0]?.[0]}?${reset}`]);
        else if (hits.length > 1) out([`${yellow}did you mean one of: ${hits.map((h) => h[0]).join(", ")}?${reset}`]);
        else out([`${yellow}unknown command; /help lists commands${reset}`]);
        return "continue";
      }
      ctx.remember(cmd);
      await ctx.runPrompt(cmd);
      return "continue";
    }
  }
}
