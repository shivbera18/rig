import { execFile } from "node:child_process";

export const RIG_PACKAGE = "@shivcdhry/rig";

function npmCmd(): string {
  if (process.platform === "win32") return `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\cmd.exe`;
  return "npm";
}

function npmArgs(args: string[]): string[] {
  if (process.platform === "win32") return ["/d", "/s", "/c", `npm ${args.join(" ")}`];
  return args;
}

function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 30_000 }, (err, stdout, stderr) => {
      resolve({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        code: err && typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : err ? 1 : 0,
      });
    });
  });
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export async function installedVersion(): Promise<string | undefined> {
  const r = await run(process.execPath, ["--version"]);
  void r;
  try {
    const { default: pkg } = await import("../../package.json", { with: { type: "json" } });
    const v = (pkg as { version?: unknown }).version;
    return typeof v === "string" ? v : undefined;
  } catch {
    return undefined;
  }
}

export async function latestVersion(distTag = "latest"): Promise<string> {
  const r = await run(npmCmd(), npmArgs(["view", `${RIG_PACKAGE}@${distTag}`, "version"]));
  const v = r.stdout.trim().split("\n").pop()?.trim();
  if (!v || r.code !== 0) throw new Error(`could not check latest version (npm view failed)`);
  return v;
}

export interface UpdatePlan {
  current: string;
  latest: string;
  needed: boolean;
  command: string[];
}

export async function planUpdate(): Promise<UpdatePlan> {
  const current = (await installedVersion()) ?? "0.0.0";
  const latest = await latestVersion();
  const needed = compareVersions(latest, current) > 0;
  return { current, latest, needed, command: ["npm", "install", "-g", `${RIG_PACKAGE}@latest`] };
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export async function runUpdate(opts: { check?: boolean; yes?: boolean }): Promise<void> {
  const plan = await planUpdate();
  if (!plan.needed) {
    console.log(`rig ${plan.current} — already latest`);
    return;
  }
  console.log(`update available: ${plan.current} → ${plan.latest}`);
  if (opts.check === true) {
    console.log(`run \`rig update\` to install, or: ${plan.command.join(" ")}`);
    return;
  }
  if (opts.yes !== true && process.stdin.isTTY) {
    const { promptLine } = await import("../auth/engines.js");
    const answer = (await promptLine(`Update to ${plan.latest}? [Y/n] `)).trim().toLowerCase();
    if (answer !== "" && answer !== "y" && answer !== "yes") {
      console.log("cancelled");
      return;
    }
  }
  let i = 0;
  const spin = setInterval(() => {
    process.stderr.write(`\r${SPINNER[i++ % SPINNER.length]} installing ${plan.latest}…`);
  }, 80);
  const r = await run(npmCmd(), npmArgs(plan.command.slice(1)));
  clearInterval(spin);
  process.stderr.write("\r");
  if (r.code !== 0) {
    console.error(r.stderr.trim().split("\n").slice(-5).join("\n"));
    throw new Error(`update failed (exit ${r.code}); try manually: ${plan.command.join(" ")}`);
  }
  console.log(`updated to ${plan.latest} — restart your shell sessions to use it`);
}
