import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

test("withFallback falls over to second cred and marks first failed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rig-pool-"));
  process.env.RIG_DATA_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "auth.json"),
    JSON.stringify([
      { id: "a", provider: "stub", access: "bad" },
      { id: "b", provider: "stub", access: "good" },
    ]),
  );
  const out = path.join(dir, "pool.cjs");
  await build({
    absWorkingDir: process.cwd(),
    entryPoints: ["src/auth/pool.ts"],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node22",
    outfile: out,
  });
  const pool = createRequire(import.meta.url)(out);
  const result = await pool.withFallback("stub", "stub/x", async (cred) => {
    if (cred.access === "bad") throw new pool.ProviderHttpError(401, "stub", "unauthorized");
    return "served";
  });
  assert.equal(result, "served");
  const stored = JSON.parse(fs.readFileSync(path.join(dir, "auth.json"), "utf8"));
  assert.equal(stored.find((c) => c.id === "a").failCount, 1);
  delete process.env.RIG_DATA_DIR;
});
