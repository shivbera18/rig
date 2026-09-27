import { LOGIN_PROVIDERS, setupHint } from "./catalog.js";
import { LoginFailedError, apiKeyLogin, deviceCodeLogin, oauthCodeLogin, promptLine } from "./engines.js";
import { loadStore, removeProviderCreds, saveStore, upsertCredential } from "./store.js";
import type { StoredCredential } from "./store.js";
import { getConfigPath, loadConfig } from "../config.js";
import { refreshIfNeeded } from "./pool.js";

export interface CliOpts {
  profile?: string | undefined;
}

interface FreshSecret {
  access: string;
  refresh?: string;
  expiresAtMs?: number;
  email?: string;
}

const GREEN = "\u001b[32m";
const DIM = "\u001b[2m";
const YELLOW = "\u001b[33m";
const RESET = "\u001b[0m";

async function pickProvider(explicitProfile?: string): Promise<string> {
  const rows = LOGIN_PROVIDERS.map((p, i) => {
    const n = loadStore(explicitProfile).filter((c) => c.provider === p.id).length;
    return `  ${i + 1}. ${p.id} — ${p.name}${n > 0 ? ` (${n} account${n === 1 ? "" : "s"})` : ""}`;
  });
  // Arrow-key picker when attached to a TTY; numbered fallback otherwise.
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const pick = await arrowPick(
      "Select provider:",
      LOGIN_PROVIDERS.map((p) => `${p.id} — ${p.name}`),
    );
    if (pick === undefined) {
      process.stderr.write(`Login failed: no selection.\n`);
      process.exitCode = 1;
      throw new LoginFailedError("no selection");
    }
    return LOGIN_PROVIDERS[pick]?.id ?? "";
  }
  console.log(rows.join("\n"));
  const answer = (await promptLine(`Select provider (1-${LOGIN_PROVIDERS.length}): `)).trim();
  const n = Number.parseInt(answer, 10);
  const picked = Number.isInteger(n) ? LOGIN_PROVIDERS[n - 1] : undefined;
  if (!picked) {
    process.stderr.write(`Login failed: invalid selection.\n`);
    process.exitCode = 1;
    throw new LoginFailedError("invalid selection");
  }
  return picked.id;
}

// Minimal arrow-key list: ↑/↓ moves, Enter accepts, Esc/Ctrl+C aborts.
// Raw-mode stdin with a hidden cursor; restores both on exit.
function arrowPick(title: string, items: string[]): Promise<number | undefined> {
  return new Promise((resolve) => {
    let idx = 0;
    const stdin = process.stdin;
    const stdout = process.stdout;
    const wasRaw: boolean = stdin.isTTY === true && (stdin as unknown as { isRaw?: boolean }).isRaw === true;
    const cleanup = (): void => {
      stdin.removeListener("data", onData);
      if (stdin.isTTY) stdin.setRawMode(false);
      (stdin as unknown as { isRaw?: boolean }).isRaw = wasRaw;
      stdout.write("\x1b[?25h");
    };
    const render = (): void => {
      stdout.write("\x1b[2K\r");
      stdout.write(`${title}\n`);
      items.forEach((label, i) => {
        stdout.write(i === idx ? `${GREEN}› ${label}${RESET}\n` : `  ${label}\n`);
      });
      stdout.write(`${DIM}↑/↓ move · Enter accepts · Esc aborts${RESET}`);
    };
    const rerender = (): void => {
      stdout.write(`\x1b[${items.length + 2}A`);
      items.forEach((label, i) => {
        stdout.write("\x1b[2K\r");
        stdout.write(i === idx ? `${GREEN}› ${label}${RESET}\n` : `  ${label}\n`);
      });
      stdout.write("\x1b[2K\r");
      stdout.write(`${DIM}↑/↓ move · Enter accepts · Esc aborts${RESET}`);
    };
    const onData = (buf: Buffer): void => {
      const s = buf.toString("utf8");
      if (s === "\x1b[A" || s === "k") {
        idx = (idx - 1 + items.length) % items.length;
        rerender();
      } else if (s === "\x1b[B" || s === "j") {
        idx = (idx + 1) % items.length;
        rerender();
      } else if (s === "\r" || s === "\n") {
        cleanup();
        stdout.write("\n");
        resolve(idx);
      } else if (s === "\x1b" || s === "\x03") {
        cleanup();
        stdout.write("\n");
        resolve(undefined);
      }
    };
    if (stdin.isTTY) stdin.setRawMode(true);
    stdout.write("\x1b[?25l");
    render();
    stdin.on("data", onData);
  });
}

function persist(provider: string, result: FreshSecret, explicitProfile?: string): void {
  const cred: StoredCredential = {
    id: `${provider}-${result.email ?? "default"}`,
    provider,
    access: result.access,
    failCount: 0,
  };
  if (result.refresh !== undefined) cred.refresh = result.refresh;
  if (result.expiresAtMs !== undefined) cred.expiresAtMs = result.expiresAtMs;
  if (result.email !== undefined) cred.email = result.email;
  upsertCredential(cred, explicitProfile);
}

function relistModels(provider: string, explicitProfile?: string): void {
  const { config } = loadConfig(getConfigPath(undefined, explicitProfile));
  const entry = config.provider[provider];
  if (!entry) {
    console.log(`No models configured for ${provider} in config.`);
    return;
  }
  for (const m of Object.keys(entry.models)) console.log(`  - ${provider}/${m}`);
}

function expiryNote(cred: StoredCredential): string {
  if (!cred.expiresAtMs) return "no expiry";
  const ms = cred.expiresAtMs - Date.now();
  if (ms <= 0) return "expired";
  const h = Math.round(ms / 3_600_000);
  return h < 48 ? `expires in ${h}h` : `expires in ${Math.round(h / 24)}d`;
}

// Local login flow: pick → engine by login kind → persist → re-list models.
export async function runLogin(provider: string | undefined, opts: CliOpts): Promise<void> {
  try {
    const id = provider ?? (await pickProvider(opts.profile));
    const def = LOGIN_PROVIDERS.find((p) => p.id === id);
    if (!def) {
      const hint = setupHint(id);
      process.stderr.write(
        `Login failed: unknown provider '${id}'. ${hint ? `${hint}. ` : ""}Run \`rig login\` to pick one.\n`,
      );
      process.exitCode = 1;
      return;
    }
    if (def.login.kind === "api-key") {
      if (def.login.authUrl) console.log(`${def.login.instructions}: ${def.login.authUrl}`);
      else console.log(def.login.instructions);
      persist(id, { access: await apiKeyLogin(def.login.prompt ?? "Paste your API key") }, opts.profile);
      console.log(`\nLogged in to ${def.name}`);
    } else if (def.login.kind === "oauth-code") {
      let result: FreshSecret;
      try {
        result = await oauthCodeLogin(def.login);
      } catch (err) {
        if (!(err instanceof LoginFailedError) || !def.deviceFallback) throw err;
        process.exitCode = 0;
        console.log("Browser flow failed; trying device-code flow instead.");
        result = await deviceCodeLogin(def.deviceFallback);
      }
      persist(id, result, opts.profile);
      // Project provisioning hint: a later 403 means re-login.
      if (id === "google-antigravity") {
        console.log("Note: if model calls fail with 403, re-run `rig login google-antigravity` to re-provision the Cloud project.");
      }
      console.log(`\nLogged in to ${def.name}${result.email ? ` as ${result.email}` : ""}`);
    } else {
      const result = await deviceCodeLogin(def.login);
      persist(id, result, opts.profile);
      console.log(`\nLogged in to ${def.name}`);
    }
    relistModels(id, opts.profile);
  } catch (err) {
    if (err instanceof LoginFailedError) return;
    process.stderr.write(`Login failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}

// Multi-account status: every stored row with health, expiry and usage.
export async function runAuthStatus(opts: CliOpts): Promise<void> {
  const creds = loadStore(opts.profile);
  if (creds.length === 0) {
    console.log("no credentials stored — run `rig login`");
    return;
  }
  const byProvider: Record<string, StoredCredential[]> = {};
  for (const c of creds) {
    (byProvider[c.provider] ??= []).push(c);
  }
  for (const [provider, rows] of Object.entries(byProvider)) {
    console.log(`${GREEN}${provider}${RESET} (${rows.length} account${rows.length === 1 ? "" : "s"})`);
    for (const c of rows) {
      const health = (c.failCount ?? 0) > 0 ? `${YELLOW}${c.failCount} failures${RESET}` : `${GREEN}healthy${RESET}`;
      const exp = !c.expiresAtMs ? "no expiry" : c.expiresAtMs <= Date.now() ? "expired" : `expires in ${Math.max(1, Math.round((c.expiresAtMs - Date.now()) / 3_600_000))}h`;
      console.log(`  ${c.id}${c.email ? ` <${c.email}>` : ""} — ${health} · ${exp}${c.lastUsedAtMs ? ` · last used ${new Date(c.lastUsedAtMs).toLocaleString()}` : ""}`);
    }
  }
}
export async function runLogout(provider: string, opts: CliOpts): Promise<void> {
  const n = removeProviderCreds(provider, opts.profile);
  console.log(`Removed ${n} credential${n === 1 ? "" : "s"} for ${provider}.`);
}

// Switch the preferred account: pool order is (failCount, lastUsedAtMs), so
// stamping every other row as just-used makes `id` the next pick.
export async function runAuthUse(provider: string, id: string, opts: CliOpts): Promise<void> {
  const all = loadStore(opts.profile);
  if (!all.some((c) => c.provider === provider && c.id === id)) {
    console.log(`no credential '${id}' for provider '${provider}'`);
    return;
  }
  const now = Date.now();
  for (const c of all) {
    if (c.provider === provider && c.id !== id) c.lastUsedAtMs = now;
  }
  const preferred = all.find((c) => c.provider === provider && c.id === id);
  if (preferred) preferred.lastUsedAtMs = 0;
  saveStore(all, opts.profile);
  console.log(`preferred account for ${provider}: ${id}`);
}
// Refresh every refreshable credential now instead of waiting for a call.
export async function runAuthRefresh(opts: CliOpts): Promise<void> {
  const creds = loadStore(opts.profile);
  let ok = 0;
  let skipped = 0;
  for (const c of creds) {
    if (!c.refresh) {
      skipped++;
      continue;
    }
    try {
      const before = c.access;
      const next = await refreshIfNeeded({ ...c, expiresAtMs: 0 }, opts.profile);
      if (next.access !== before) {
        ok++;
        console.log(`${c.provider}/${c.id}: refreshed`);
      } else {
        console.log(`${c.provider}/${c.id}: refresh failed, kept old token`);
      }
    } catch (err) {
      console.log(`${c.provider}/${c.id}: refresh error (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  console.log(`${DIM}refreshed ${ok}, skipped ${skipped} without refresh tokens${RESET}`);
}
