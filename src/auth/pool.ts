import { getConfigPath, loadConfig } from "../config.js";
import { AllCredentialsFailed, ProviderHttpError } from "../providers/types.js";
import { loadStore, saveStore } from "./store.js";
import type { StoredCredential } from "./store.js";
export { AllCredentialsFailed, ProviderHttpError } from "../providers/types.js";

export interface PoolOpts {
  profile?: string | undefined;
}
const REFRESH_WINDOW_MS = 5 * 60 * 1000;
const REFRESH_URLS: Record<string, string> = {
  "google-antigravity": "https://oauth2.googleapis.com/token",
  "openai-codex": "https://auth.openai.com/oauth/token",
};

export function selectCredentials(providerId: string, profile?: string | undefined): StoredCredential[] {
  const now = Date.now();
  const all = loadStore(profile);
  const rows = all
    .filter((c) => c.provider === providerId && (!c.expiresAtMs || c.expiresAtMs > now))
    .sort(
      (a, b) =>
        (a.failCount ?? 0) - (b.failCount ?? 0) || (a.lastUsedAtMs ?? 0) - (b.lastUsedAtMs ?? 0),
    );
  if (rows.length === 0) return rows;
  // Round-robin: stamp the head row so the next call rotates to the next idlest row.
  rows[0].lastUsedAtMs = now;
  saveStore(all, profile);
  return rows;
}

export async function refreshIfNeeded(
  cred: StoredCredential,
  profile?: string | undefined,
): Promise<StoredCredential> {
  const now = Date.now();
  if (!cred.refresh || !cred.expiresAtMs || cred.expiresAtMs - now >= REFRESH_WINDOW_MS) {
    return cred;
  }
  const url = REFRESH_URLS[cred.provider];
  if (!url) return cred;
  try {
    const res = await fetch(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: cred.refresh,
        }).toString(),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) return cred;
    const doc = (await res.json()) as { access_token?: string; expires_in?: number };
    if (typeof doc.access_token !== "string" || !doc.access_token) return cred;
    const all = loadStore(profile);
    const row = all.find((c) => c.id === cred.id);
    if (!row) return cred;
    row.access = doc.access_token;
    if (typeof doc.expires_in === "number") row.expiresAtMs = Date.now() + doc.expires_in * 1000;
    saveStore(all, profile);
    return { ...row };
  } catch {
    return cred;
  }
}

export function markFailed(id: string, profile?: string | undefined): void {
  const all = loadStore(profile);
  const row = all.find((c) => c.id === id);
  if (!row) return;
  row.failCount = (row.failCount ?? 0) + 1;
  row.lastFailureAtMs = Date.now();
  saveStore(all, profile);
}

export async function withFallback<T>(
  providerId: string,
  _model: string,
  fn: (cred: StoredCredential) => Promise<T>,
  profile?: string | undefined,
): Promise<T> {
  const creds = selectCredentials(providerId, profile);
  for (const snapshot of creds) {
    const cred = await refreshIfNeeded(snapshot, profile);
    try {
      return await fn(cred);
    } catch (err) {
      if (err instanceof ProviderHttpError && (err.status === 401 || err.status === 403)) {
        markFailed(cred.id, profile);
        continue;
      }
      throw err;
    }
  }
  throw new AllCredentialsFailed(providerId);
}

export async function runAuthCheck(opts: PoolOpts): Promise<void> {
  const creds = loadStore(opts.profile);
  let baseUrls: Record<string, string> = {};
  try {
    baseUrls = Object.fromEntries(
      Object.entries(loadConfig(getConfigPath(undefined, opts.profile)).config.provider).map(
        ([id, entry]) => [id, entry.baseUrl],
      ),
    );
  } catch {
    baseUrls = {};
  }
  for (const cred of creds) {
    const baseUrl = baseUrls[cred.provider];
    if (!baseUrl) {
      console.log(`${cred.provider}/${cred.id}: FAIL (no baseUrl)`);
      continue;
    }
    try {
      const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
        headers: { authorization: `Bearer ${cred.access}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) console.log(`${cred.provider}/${cred.id}: ok`);
      else console.log(`${cred.provider}/${cred.id}: FAIL (HTTP ${res.status})`);
    } catch (err) {
      console.log(`${cred.provider}/${cred.id}: FAIL (${(err as Error).message})`);
    }
  }
}
