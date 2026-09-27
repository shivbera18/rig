import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const entry = path.join(root, "src", "tools", "web-search.ts");

function loadModule() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rig-websearch-"));
  const outfile = path.join(tmp, "web-search.cjs");
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

test("executeSearchWith falls back sequentially and cites fixture URL", async () => {
  const mod = await loadModule();
  const calls = [];
  const failing = {
    id: "stub-a",
    label: "Stub A",
    isAvailable: () => true,
    search: async () => {
      calls.push("a");
      throw new Error("stub-a HTTP 500");
    },
  };
  const fixtureUrl = "https://example.com/fixture-article";
  const ok = {
    id: "stub-b",
    label: "Stub B",
    isAvailable: () => true,
    search: async () => {
      calls.push("b");
      return { providerId: "stub-b", results: [{ title: "Fixture", url: fixtureUrl, snippet: "body" }] };
    },
  };
  const res = await mod.executeSearchWith([failing, ok], { query: "test query" });
  assert.deepEqual(calls, ["a", "b"]);
  assert.equal(res.providerId, "stub-b");
  assert.ok(res.results.some((r) => r.url === fixtureUrl), "result cites fixture URL");
});

test("executeSearchWith throws last error when all fail", async () => {
  const mod = await loadModule();
  const bad = (id, msg) => ({
    id,
    label: id,
    isAvailable: () => true,
    search: async () => {
      throw new Error(msg);
    },
  });
  await assert.rejects(() => mod.executeSearchWith([bad("a", "first"), bad("b", "last boom")], { query: "x" }), /last boom/);
});

test("mapWithConcurrencyLimit caps per-request concurrency", async () => {
  const mod = await loadModule();
  let live = 0;
  let peak = 0;
  const out = await mod.mapWithConcurrencyLimit([1, 2, 3, 4, 5], 2, async (n) => {
    live++;
    peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 10));
    live--;
    return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10]);
  assert.ok(peak <= 2, `peak ${peak} exceeds limit`);
});

test("webSearchTool formats title — url lines", async () => {
  const mod = await loadModule();
  assert.equal(mod.webSearchTool.name, "web_search");
  process.env.TAVILY_API_KEY = "test-key";
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ results: [{ title: "T", url: "https://example.com/fixture-article", content: "S" }] }),
  });
  try {
    const text = await mod.webSearchTool.execute({ query: "hi" });
    assert.ok(text.includes("https://example.com/fixture-article"));
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.TAVILY_API_KEY;
  }
});
