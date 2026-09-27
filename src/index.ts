import { Command } from "commander";
import { getConfigPath, loadConfig } from "./config.js";
import { runExec } from "./cli/exec.js";
import { runAuthRefresh, runAuthStatus, runAuthUse, runLogin, runLogout } from "./auth/cli.js";
import { runAuthCheck } from "./auth/pool.js";

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("rig")
    .description("rig — headless coding-agent CLI")
    .option("--profile <name>", "config profile");

  program
    .command("exec [prompt]")
    .description("headless agent run (saves a session per run)")
    .option("--model <m>", "provider/model or @smol|@default|@vision")
    .option("--max-steps <n>", "max tool steps", (v: string) => parseInt(v, 10))
    .option("--session <id>", "run in an existing session thread")
    .option("-c, --continue", "continue the most recent session")
    .option("--print-session", "print the session id to stderr after the run")
    .option("--input <source>", "read prompt from file or - for stdin")
    .option("--cwd <path>", "workspace directory for tools")
    .option("--file <path>", "attach a file as context (repeatable)", (v: string, p: string[]) => [...p, v], [] as string[])
    .option("--timeout <duration>", "run timeout, e.g. 30s 2m 500ms")
    .option("--output-format <f>", "output format: text|json|stream-json")
    .option("--format <f>", "alias of --output-format")
    .option("--output-schema <schema>", "JSON Schema file or inline object validating the final answer")
    .option("-o, --output-last-message <file>", "write the final agent message to a file")
    .option("--output <file>", "alias of --output-last-message for text format")
    .option("--quiet", "suppress text output (use with --output-last-message)")
    .option("--diagnostics-dir <path>", "save bounded run diagnostics to a fresh directory")
    .action(
      async (
        prompt: string | undefined,
        opts: { model?: string; maxSteps?: number; session?: string; continue?: boolean; printSession?: boolean; input?: string; cwd?: string; file?: string[]; timeout?: string; outputFormat?: string; format?: string; outputSchema?: string; outputLastMessage?: string; output?: string; quiet?: boolean; diagnosticsDir?: string },
      ) => {
        const { format: rawFormat, outputFormat, output: rawOutput, outputLastMessage, ...rest } = opts;
        const format = outputFormat ?? rawFormat;
        if (format !== undefined && format !== "text" && format !== "json" && format !== "stream-json") {
          throw new Error(`--output-format must be text|json|stream-json, got "${format}"`);
        }
        await runExec(prompt, {
          ...rest,
          ...(format === undefined ? {} : { format }),
          ...(outputLastMessage ?? rawOutput === undefined ? {} : { output: outputLastMessage ?? rawOutput }),
          profile: program.opts().profile as string | undefined,
        });
      },
    );

  program
    .command("tui")
    .description("interactive rig session (fullscreen)")
    .option("--model <m>", "provider/model or @smol|@default|@vision")
    .option("--max-steps <n>", "max tool steps", (v: string) => parseInt(v, 10))
    .option("--session <id>", "continue or fork a named session thread")
    .option("-c, --continue", "continue the most recent session")
    .action(
      async (opts: { model?: string; maxSteps?: number; session?: string; continue?: boolean }) => {
        const { runTui } = await import("./tui/fullscreen.js");
        await runTui({ ...opts, profile: program.opts().profile as string | undefined });
      },
    );

  program
    .command("update")
    .description("update rig to the latest version")
    .option("--check", "only check, do not install")
    .option("-y, --yes", "skip confirmation")
    .action(async (opts: { check?: boolean; yes?: boolean }) => {
      const { runUpdate } = await import("./update/update.js");
      await runUpdate(opts);
    });

  program
    .command("login [provider]")
    .description("log in to a provider")
    .action(async (provider?: string) => {
      await runLogin(provider, { profile: program.opts().profile as string | undefined });
    });

  program
    .command("logout <provider>")
    .description("remove stored credentials for a provider")
    .action(async (provider: string) => {
      await runLogout(provider, { profile: program.opts().profile as string | undefined });
    });

  const sessions = program.command("sessions").description("past runs");
  sessions
    .command("list")
    .description("list saved sessions, most recent first")
    .action(async () => {
      const { listSessions } = await import("./session/store.js");
      const rows = listSessions(program.opts().profile as string | undefined);
      if (rows.length === 0) {
        console.log("no sessions");
        return;
      }
      for (const s of rows) {
        console.log(`${s.id}  ${s.model}  ${s.messages.length} msgs  ${new Date(s.updatedAtMs).toLocaleString()}`);
      }
    });

  const auth = program.command("auth").description("credential operations");
  auth
    .command("check")
    .description("probe every stored credential")
    .action(async () => {
      await runAuthCheck({ profile: program.opts().profile as string | undefined });
    });
  auth
    .command("status")
    .description("show every stored account with health and expiry")
    .action(async () => {
      await runAuthStatus({ profile: program.opts().profile as string | undefined });
    });
  auth
    .command("refresh")
    .description("refresh every refreshable credential now")
    .action(async () => {
      await runAuthRefresh({ profile: program.opts().profile as string | undefined });
    });
  auth
    .command("use <provider> <id>")
    .description("prefer one stored account for a provider")
    .action(async (provider: string, id: string) => {
      await runAuthUse(provider, id, { profile: program.opts().profile as string | undefined });
    });

  const pv = program.command("provider").description("provider info");
  pv.command("list")
    .description("list configured providers and models")
    .action(() => {
      const { config } = loadConfig(
        getConfigPath(undefined, program.opts().profile as string | undefined),
      );
      for (const [id, entry] of Object.entries(config.provider)) {
        console.log(`${id} (${entry.apiFormat}) ${entry.baseUrl}`);
        for (const m of Object.keys(entry.models)) console.log(`  - ${m}`);
      }
    });

  // Bare `rig` drops into the interactive session, like other coding harnesses.
  if (process.argv.length <= 2) {
    const { runTui } = await import("./tui/fullscreen.js");
    await runTui({ profile: program.opts().profile as string | undefined });
    return;
  }
  await program.parseAsync(process.argv);
}

main().catch((err: Error) => {
  // runExec sets process.exitCode itself (0-5 contract); commander errors
  // arrive here too. Print once (exec already prefixes its message).
  if (process.exitCode === undefined || process.exitCode === 0) process.exitCode = 1;
  console.error(err.message);
});
