import fs from "node:fs";
import path from "node:path";
import { getDataDir } from "../config.js";

export interface StoredCredential {
  id: string;
  provider: string;
  access: string;
  refresh?: string;
  expiresAtMs?: number;
  email?: string;
  projectId?: string;
  lastFailureAtMs?: number;
  failCount?: number;
  lastUsedAtMs?: number;
}

export function authFilePath(explicitProfile?: string | undefined): string {
  return path.join(getDataDir(explicitProfile), "auth.json");
}

export function loadStore(explicitProfile?: string | undefined): StoredCredential[] {
  let raw: string;
  try {
    raw = fs.readFileSync(authFilePath(explicitProfile), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const doc = JSON.parse(raw) as unknown;
  if (!Array.isArray(doc)) throw new Error("auth.json root must be an array");
  return doc as StoredCredential[];
}

export function saveStore(
  creds: StoredCredential[],
  explicitProfile?: string | undefined,
): void {
  const p = authFilePath(explicitProfile);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(creds, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(tmp, 0o600);
  } catch {
    // non-POSIX fs (Windows): mode already applied at creation where supported
  }
  fs.renameSync(tmp, p);
}

export function upsertCredential(
  cred: StoredCredential,
  explicitProfile?: string | undefined,
): void {
  const creds = loadStore(explicitProfile).filter((c) => c.id !== cred.id);
  creds.push(cred);
  saveStore(creds, explicitProfile);
}

export function removeProviderCreds(
  provider: string,
  explicitProfile?: string | undefined,
): number {
  const creds = loadStore(explicitProfile);
  const kept = creds.filter((c) => c.provider !== provider);
  saveStore(kept, explicitProfile);
  return creds.length - kept.length;
}
