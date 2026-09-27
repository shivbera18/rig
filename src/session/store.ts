import fs from "node:fs";
import path from "node:path";
import { getDataDir } from "../config.js";
import type { ChatMessage } from "../providers/types.js";

export interface Session {
  id: string;
  model: string;
  messages: ChatMessage[];
  updatedAtMs: number;
}

export function sessionDir(explicitProfile?: string | undefined): string {
  return path.join(getDataDir(explicitProfile), "sessions");
}

export function newSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function sessionPath(id: string, explicitProfile?: string | undefined): string {
  return path.join(sessionDir(explicitProfile), `${id}.json`);
}

export function loadSession(id: string, explicitProfile?: string | undefined): Session | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(sessionPath(id, explicitProfile), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  const doc = JSON.parse(raw) as Session;
  if (!Array.isArray(doc.messages)) throw new Error(`session ${id} has no messages array`);
  return doc;
}

export function saveSession(s: Session, explicitProfile?: string | undefined): void {
  const dir = sessionDir(explicitProfile);
  fs.mkdirSync(dir, { recursive: true });
  const p = sessionPath(s.id, explicitProfile);
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...s, updatedAtMs: Date.now() }, null, 2));
  fs.renameSync(tmp, p);
}

export function listSessions(explicitProfile?: string | undefined): Session[] {
  const dir = sessionDir(explicitProfile);
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: Session[] = [];
  for (const f of files) {
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Session);
    } catch {
      // skip corrupt session files
    }
  }
  out.sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0));
  return out;
}

export function mostRecentSession(explicitProfile?: string | undefined): Session | undefined {
  return listSessions(explicitProfile)[0];
}
