import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type Isolation = { enabled: false } | { enabled: true; dir: string };

function gitOk(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function isRepo(cwd: string): boolean {
  try {
    const out = execFileSync("git", ["-C", cwd, "rev-parse", "--is-inside-work-tree"], {
      encoding: "utf8",
    });
    return out.trim() === "true";
  } catch {
    return false;
  }
}

export function digestId(id: string): string {
  return `t${createHash("sha1").update(id).digest("hex").slice(0, 9)}`;
}

export function ensureIsolation(cwd: string, id: string): Isolation {
  if (!gitOk() || !isRepo(cwd)) {
    console.error(`rig: no git worktree available in ${cwd}; running without isolation`);
    return { enabled: false };
  }
  const dir = path.join(cwd, ".rig-worktrees", digestId(id));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    execFileSync("git", ["-C", cwd, "worktree", "add", "--detach", dir, "HEAD"]);
  }
  return { enabled: true, dir };
}

export function baselineInfo(dir: string): { rev: string; status: string } {
  const rev = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const status = execFileSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf8" });
  return { rev, status };
}

export function collectDelta(dir: string): string {
  // intent-to-add makes plain `git diff HEAD` include untracked file content.
  execFileSync("git", ["-C", dir, "add", "-N", "."], { stdio: "ignore" });
  try {
    return execFileSync("git", ["-C", dir, "diff", "HEAD", "--", "."], { encoding: "utf8" });
  } finally {
    try {
      execFileSync("git", ["-C", dir, "reset", "-q"], { stdio: "ignore" });
    } catch {
      // ignore: worktree may be mid-cleanup; the diff above already succeeded
    }
  }
}

function tryArgs(repoRoot: string, args: string[], input: string): boolean {
  try {
    execFileSync("git", ["-C", repoRoot, ...args], { input });
    return true;
  } catch {
    return false;
  }
}

export function mergeDelta(repoRoot: string, patch: string, worktreeDir?: string): "applied" | "skipped" {
  if (!patch.trim()) return "skipped";
  // Idempotency: already applied (e.g. retried merge) → skip instead of failing.
  if (tryArgs(repoRoot, ["apply", "--reverse", "--check", "-"], patch)) return "skipped";
  try {
    execFileSync("git", ["-C", repoRoot, "apply", "--check", "-"], { input: patch });
    execFileSync("git", ["-C", repoRoot, "apply", "-"], { input: patch });
  } catch {
    console.error(
      `rig: patch did not apply in ${repoRoot}; isolated worktree retained at ${worktreeDir ?? repoRoot}`,
    );
    throw new Error(`patch did not apply cleanly in ${repoRoot}`);
  }
  return "applied";
}

export function cleanupIsolation(cwd: string, branchDir: string): void {
  try {
    execFileSync("git", ["-C", cwd, "worktree", "remove", "--force", "--", branchDir], {
      stdio: "ignore",
    });
  } catch {
    // fall through to rm: the worktree may already be half-removed
  }
  fs.rmSync(branchDir, { recursive: true, force: true });
  try {
    execFileSync("git", ["-C", cwd, "worktree", "prune"], { stdio: "ignore" });
  } catch {
    // ignore: prune is best-effort list hygiene
  }
}
