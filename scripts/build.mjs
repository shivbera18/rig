import { build } from "esbuild";
import { chmodSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));

await build({
  absWorkingDir: root,
  banner: { js: "#!/usr/bin/env node" },
  bundle: true,
  entryPoints: ["src/index.ts"],
  external: [],
  format: "cjs",
  outfile: "dist/cli.cjs",
  platform: "node",
  target: "node22",
});
rmSync(path.join(root, "dist/package.json"), { force: true });
rmSync(path.join(root, "dist/cli.js"), { force: true });
chmodSync(path.join(root, "dist/cli.cjs"), 0o755);
console.log("built dist/cli.cjs");
