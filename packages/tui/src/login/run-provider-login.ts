/** Single dispatch from roster entry to Step-2 engine + Rig storage (Steps 3-5).
 * TUI/CLI/provider-row callers share this: api-key engine for api-key rows,
 * generic OAuth device/code engines for wired OAuth rows (per-provider token
 * URLs in device-flow-endpoints.ts), existing Codex OAuth for openai-codex,
 * manual paste + validation fallback for custom rows.
 */

import { getRigLoginProvider, type RigLoginProviderDef } from "./provider-login-registry.js";
import { runApiKeyLogin, type RigLoginController } from "./engines/api-key-login.js";
import { runDeviceCodeLogin, runOAuthCodeLogin } from "./engines/oauth-login.js";
import { getRigOAuthEndpoints } from "./engines/device-flow-endpoints.js";
import {
  formatLoginIdentity,
  saveLoginCredential,
  type RigLoginCredentialWriter,
} from "./credential-store.js";

export interface RigProviderLoginResult {
  readonly provider: RigLoginProviderDef;
  readonly credential: string | { access: string };
  readonly message: string;
}

/**
 * Runs the login flow for one roster entry and persists via the writer.
 * startCodexOAuth is the existing Codex browser+device flow (kept, not rewritten).
 */
export async function runProviderLogin(
  providerId: string,
  controller: RigLoginController,
  writer: RigLoginCredentialWriter,
  options: {
    readonly startCodexOAuth?: () => Promise<{ authUrl?: string } | void>;
  } = {},
): Promise<RigProviderLoginResult> {
  const def = getRigLoginProvider(providerId);
  if (!def) throw new Error(`Unknown provider '${providerId}'. Run 'rig login' to pick one.`);
  if (def.kind === "rig-managed") throw new Error("Rig Token Plan sign-in runs through the region picker.");
  if (def.kind === "api-key" || def.kind === "custom") {
    const key = await runApiKeyLogin(def.kind === "custom" ? toManualApiKeyDef(def) : def, controller);
    await saveLoginCredential(writer, providerId, key);
    return { provider: def, credential: key, message: `Logged in to ${def.name}.` };
  }
  if (providerId === "openai-codex" || providerId === "openai-codex-device") {
    if (!options.startCodexOAuth) throw new Error("Codex sign-in is unavailable in this host.");
    await options.startCodexOAuth();
    return { provider: def, credential: { access: "" }, message: `Logged in to ${def.name}.` };
  }
  const endpoints = getRigOAuthEndpoints(providerId);
  if (!endpoints) throw new Error(`${def.name} sign-in needs manual setup; paste a key via /provider.`);
  if (def.kind === "device-code") {
    const deviceUrl = endpoints.extraDeviceParams?.["device_url"];
    if (!deviceUrl) throw new Error(`${def.name} sign-in needs manual setup; paste a key via /provider.`);
    const credential = await runDeviceCodeLogin(def, { ...controller, deviceUrl, tokenUrl: endpoints.tokenUrl });
    await saveLoginCredential(writer, providerId, credential);
    const who = formatLoginIdentity(credential);
    return {
      provider: def,
      credential,
      message: `Logged in to ${def.name}${who ? ` as ${who}` : ""}.`,
    };
  }
  const credential = await runOAuthCodeLogin(def, {
    ...controller,
    tokenUrl: endpoints.tokenUrl,
    ...(endpoints.exchangeBody ? { exchangeBody: endpoints.exchangeBody } : {}),
  });
  await saveLoginCredential(writer, providerId, credential);
  if (providerId === "openrouter") {
    await saveLoginCredential(writer, providerId, credential.access);
  }
  const who = formatLoginIdentity(credential);
  return {
    provider: def,
    credential,
    message: `Logged in to ${def.name}${who ? ` as ${who}` : ""}.`,
  };
}

/**
 * custom-hook rows ship as api-key fallback with manual paste + validation
 * (per plan contingencies: no portable hook without OMP browser sessions).
 * Recorded inline at each table row via hookId; nothing is hidden.
 */
function toManualApiKeyDef(def: RigLoginProviderDef): RigLoginProviderDef {
  return {
    ...def,
    kind: "api-key",
    prompt: def.prompt ?? `Paste your ${def.name} API key`,
  };
}
