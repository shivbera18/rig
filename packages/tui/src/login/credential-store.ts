/** Multi-provider credential persistence (Step 2).
 * api-key results go through the existing `RigProviderRuntimePort` ModelProvider
 * API; OAuth results persist as provider records in the existing
 * `<authHome>/auth.json` file (same envelope, separate record key per
 * provider). No SQLite `agent.db` port.
 */

import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { chmod, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";

import type { RigProviderRuntimePort } from "../provider/contract.js";
import { getRigLoginProvider, type RigLoginProviderDef } from "./provider-login-registry.js";
import type { RigOAuthCredentials } from "./engines/oauth-login.js";

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(directory, 0o700);
}

async function atomicWritePrivateFile(path: string, content: string): Promise<void> {
  await ensurePrivateDirectory(dirname(path));
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(content, { encoding: "utf8" });
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (process.platform !== "win32") await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export interface RigLoginCredentialWriter {
  readonly saveApiKey: (providerId: string, apiKey: string) => Promise<void>;
  readonly saveOAuth: (providerId: string, credential: RigOAuthCredentials) => Promise<void>;
  readonly deleteCredential: (providerId: string) => Promise<void>;
}

export interface RigLoginOAuthPaths {
  readonly authHome: string;
  readonly credentialPath: string;
}

export function resolveRigLoginOAuthPaths(dataDir: string): RigLoginOAuthPaths {
  const authHome = join(resolve(dataDir), "auth");
  return { authHome, credentialPath: join(authHome, "auth.json") };
}

export interface RigStoredOAuthCredential extends RigOAuthCredentials {
  readonly schemaVersion: 1;
  readonly provider: string;
  readonly tokenType: "Bearer";
}

function providerKey(providerId: string): { service: string; account: string } {
  const account = createHash("sha256").update(`rig-login\0${providerId}`).digest("base64url");
  return { service: `com.rig.login.${providerId}`, account };
}

/**
 * Routes a validated login result to existing storage: `rig_api` key via
 * `upsertRigApiKey`, other api-key providers via create/update of the
 * `custom_provider:*` entry, OAuth tokens as provider records in `auth.json`.
 */
export async function saveLoginCredential(
  writer: RigLoginCredentialWriter,
  providerId: string,
  credential: string | RigOAuthCredentials,
): Promise<void> {
  if (typeof credential === "string") await writer.saveApiKey(providerId, credential);
  else await writer.saveOAuth(providerId, credential);
}

export interface RigLoginTemplate {
  readonly providerId: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly apiFormat: "anthropic-messages" | "openai-completions" | "openai-responses";
}

/** Port-backed writer: the only credential-write API new login code may call. */
export function createPortCredentialWriter(
  port: RigProviderRuntimePort,
  options: {
    readonly prepareDataDir: () => Promise<string>;
    readonly listTemplates?: () => Promise<readonly RigLoginTemplate[]>;
  },
): RigLoginCredentialWriter {
  return {
    async saveApiKey(providerId: string, apiKey: string): Promise<void> {
      if (providerId === "rig") {
        await port.upsertRigApiKey({ apiKey, saveAndUse: true });
      } else {
        const existing = await port.listUserModelProviders();
        const match = existing.find(
          (provider) =>
            provider.providerId === `custom_provider:${providerId}` || provider.providerId === providerId,
        );
        if (match) {
          await port.updateUserModelProvider({ providerId: match.providerId, apiKey, saveAndUse: false });
        } else {
          const templates = (await options.listTemplates?.()) ?? [];
          const template = templates.find((candidate) => candidate.providerId === providerId);
          const def = getRigLoginProvider(providerId);
          const name = template?.name ?? def?.name ?? providerId;
          const baseUrl = template?.baseUrl ?? deriveLoginBaseUrl(providerId, def);
          const apiFormat =
            template?.apiFormat ??
            (def?.validate?.kind === "anthropic-messages" ? "anthropic-messages" : "openai-completions");
          await port.createUserModelProvider({
            name,
            baseUrl,
            apiFormat,
            apiKey,
            models: [],
            saveAndUse: false,
          });
        }
      }
    },
    async saveOAuth(providerId: string, credential: RigOAuthCredentials): Promise<void> {
      const dataDir = await options.prepareDataDir();
      const { credentialPath } = resolveRigLoginOAuthPaths(dataDir);
      const stored: RigStoredOAuthCredential = {
        schemaVersion: 1,
        provider: providerId,
        tokenType: "Bearer",
        ...credential,
      };
      await writeProviderRecord(credentialPath, providerKey(providerId), stored);
    },
    async deleteCredential(providerId: string): Promise<void> {
      if (providerId !== "rig") {
        const existing = await port.listUserModelProviders();
        const match = existing.find(
          (provider) =>
            provider.providerId === `custom_provider:${providerId}` || provider.providerId === providerId,
        );
        if (match) await port.deleteUserModelProvider(match.providerId);
        try {
          const dataDir = await options.prepareDataDir();
          const { credentialPath } = resolveRigLoginOAuthPaths(dataDir);
          await deleteProviderRecord(credentialPath, providerKey(providerId));
        } catch {
          // OAuth file is best-effort on logout; port deletion already ran.
        }
      }
    },
  };
}

/** Human label for a stored login: `email (org)` / `email` / org; undefined for API keys. */
export function formatLoginIdentity(
  identity: { email?: string; accountId?: string; orgName?: string; orgId?: string } | undefined,
): string | undefined {
  if (!identity) return undefined;
  const base = identity.email ?? identity.accountId;
  const org = identity.orgName ?? identity.orgId;
  if (base) return org ? `${base} (${org})` : base;
  return org;
}

function deriveLoginBaseUrl(providerId: string, def?: RigLoginProviderDef): string {
  if (def?.validate?.baseUrl) return def.validate.baseUrl;
  if (def?.validate?.url) {
    return def.validate.url.replace(/\/models(?:\?.*)?$/, "");
  }
  return `https://${providerId}.example.invalid/v1`;
}

async function readOAuthRecords(credentialPath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(credentialPath, "utf8");
    const payload = JSON.parse(raw) as { records?: Record<string, unknown> };
    if (payload && typeof payload === "object" && payload.records && typeof payload.records === "object") {
      return { ...(payload.records as Record<string, unknown>) };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return {};
}

async function writeProviderRecord(
  credentialPath: string,
  key: { service: string; account: string },
  stored: RigStoredOAuthCredential,
): Promise<void> {
  await ensurePrivateDirectory(dirname(credentialPath));
  const records = await readOAuthRecords(credentialPath);
  records[`${key.service}\0${key.account}`] = stored;
  await atomicWritePrivateFile(credentialPath, `${JSON.stringify({ schemaVersion: 1, records }, null, 2)}\n`);
}

async function deleteProviderRecord(
  credentialPath: string,
  key: { service: string; account: string },
): Promise<void> {
  const records = await readOAuthRecords(credentialPath);
  delete records[`${key.service}\0${key.account}`];
  await mkdir(dirname(credentialPath), { recursive: true });
  await writeFile(credentialPath, `${JSON.stringify({ schemaVersion: 1, records }, null, 2)}\n`, "utf8");
}

export type { RigLoginProviderDef };
