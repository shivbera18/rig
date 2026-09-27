import { LOGIN_PROVIDERS, setupHint } from "./catalog.js";
import { LoginFailedError, apiKeyLogin, deviceCodeLogin, oauthCodeLogin, promptLine } from "./engines.js";
import { removeProviderCreds, upsertCredential } from "./store.js";
import type { StoredCredential } from "./store.js";
import { getConfigPath, loadConfig } from "../config.js";

export interface CliOpts {
  profile?: string | undefined;
}

interface FreshSecret {
  access: string;
  refresh?: string;
  expiresAtMs?: number;
  email?: string;
}

async function pickProvider(): Promise<string> {
  LOGIN_PROVIDERS.forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.id} — ${p.name}`);
  });
  const answer = (await promptLine(`Select provider (1-${LOGIN_PROVIDERS.length}): `)).trim();
  const n = Number.parseInt(answer, 10);
  const picked = Number.isInteger(n) ? LOGIN_PROVIDERS[n - 1] : undefined;
  if (!picked) {
    process.stderr.write(`Login failed: invalid selection '${answer}'\n`);
    process.exitCode = 1;
    throw new LoginFailedError(answer);
  }
  return picked.id;
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

// Local login flow: pick → engine by login kind → persist → re-list models.
export async function runLogin(provider: string | undefined, opts: CliOpts): Promise<void> {
  try {
    const id = provider ?? (await pickProvider());
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

export async function runLogout(provider: string, opts: CliOpts): Promise<void> {
  const n = removeProviderCreds(provider, opts.profile);
  console.log(`Removed ${n} credential${n === 1 ? "" : "s"} for ${provider}.`);
}
