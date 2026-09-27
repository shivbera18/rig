import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { buildSync } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const entry = path.join(root, "src", "subagents", "worktree.ts");
function loadModule() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rig-worktree-mod-"));
  const outfile = path.join(tmp, "worktree.cjs");
  buildSync({
    absWorkingDir: root,
    bundle: true,
    entryPoints: [entry],
    format: "cjs",
    outfile,
    platform: "node",
    target: "node22",
  });
  return import(pathToFileURL(outfile).href);
}

function git(cwd, ...args) {
  return execFileSync("git", [...args], { cwd, encoding: "utf8" });
}

function initRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rig-wt-repo-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "rig@test.local");
  git(dir, "config", "user.name", "rig test");
  fs.writeFileSync(path.join(dir, "base.txt"), "base v1\n");
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "initial");
  return dir;
}

function worktreePaths(repo) {
  const out = git(repo, "worktree", "list", "--porcelain");
  return out
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => path.normalize(l.slice("worktree ".length).trim()));
}

test("isolated write merges into parent and leaves no worktree behind", async () => {
  const mod = await loadModule();
  const repo = initRepo();
  try {
    const iso = mod.ensureIsolation(repo, "worker-1");
    assert.equal(iso.enabled, true);
    fs.writeFileSync(path.join(iso.dir, "hello.txt"), "hello from worker\n");
    fs.writeFileSync(path.join(iso.dir, "base.txt"), "base v1\nbase v2\n");

    const patch = mod.collectDelta(iso.dir);
    assert.ok(patch.includes("hello.txt"), "delta includes the untracked file");
    assert.ok(patch.includes("base v2"), "delta includes the tracked edit");

    const read = (f) => fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");
    assert.equal(mod.mergeDelta(repo, patch, iso.dir), "applied");
    assert.equal(read(path.join(repo, "hello.txt")), "hello from worker\n");
    assert.equal(read(path.join(repo, "base.txt")), "base v1\nbase v2\n");

    // Re-merging the same patch is a silent skip, not an error.
    assert.equal(mod.mergeDelta(repo, patch, iso.dir), "skipped");

    mod.cleanupIsolation(repo, iso.dir);
    assert.ok(!fs.existsSync(iso.dir), "worktree dir removed");
    assert.deepEqual(worktreePaths(repo), [repo]);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("failing apply retains the dir and prints its path", async () => {
  const mod = await loadModule();
  const repo = initRepo();
  const lines = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => {
    lines.push(String(chunk));
    return origWrite(chunk, ...rest);
  };
  try {
    const iso = mod.ensureIsolation(repo, "worker-bad");
    assert.equal(iso.enabled, true);
    assert.throws(() => mod.mergeDelta(repo, "@@@ not a patch\n", iso.dir), /did not apply/);
    assert.ok(fs.existsSync(iso.dir), "worktree retained after failed merge");
    assert.ok(
      lines.some((l) => l.includes(iso.dir)),
      "stderr names the retained worktree dir",
    );
    mod.cleanupIsolation(repo, iso.dir);
    assert.deepEqual(worktreePaths(repo), [repo]);
  } finally {
    process.stderr.write = origWrite;
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("non-git cwd disables isolation with a warning", async () => {
  const mod = await loadModule();
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "rig-wt-plain-"));
  try {
    const iso = mod.ensureIsolation(plain, "worker-x");
    assert.deepEqual(iso, { enabled: false });
  } finally {
    fs.rmSync(plain, { recursive: true, force: true });
  }
});
