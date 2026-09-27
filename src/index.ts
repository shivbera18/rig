import { Command } from "commander";
import { getConfigPath, loadConfig } from "./config.js";
import { runExec } from "./cli/exec.js";
import { runLogin, runLogout } from "./auth/cli.js";
import { runAuthCheck } from "./auth/pool.js";

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("rig")
    .description("rig — headless coding-agent CLI")
    .option("--profile <name>", "config profile");

  program
    .command("exec <prompt>")
    .description("headless agent run (saves a session per run)")
    .option("--model <m>", "provider/model or @smol|@default|@vision")
    .option("--max-steps <n>", "max tool steps", (v: string) => parseInt(v, 10))
    .option("--session <id>", "continue or fork a named session thread")
    .option("--resume <id>", "resume a session by id")
    .option("-c, --continue", "continue the most recent session")
    .option("--print-session", "print the session id to stderr after the run")
    .option("--format <f>", "output format: text|json|stream-json")
    .option("--output <file>", "write result to file instead of stdout")
    .option("--quiet", "suppress text output (use with --output)")
    .action(
      async (
        prompt: string,
        opts: { model?: string; maxSteps?: number; session?: string; resume?: string; continue?: boolean; printSession?: boolean; format?: string; output?: string; quiet?: boolean },
      ) => {
        const { format: rawFormat, ...rest } = opts;
        if (rawFormat !== undefined && rawFormat !== "text" && rawFormat !== "json" && rawFormat !== "stream-json") {
          throw new Error(`--format must be text|json|stream-json, got "${rawFormat}"`);
        }
        await runExec(prompt, {
          ...rest,
          ...(rawFormat === undefined ? {} : { format: rawFormat }),
          profile: program.opts().profile as string | undefined,
        });
      },
    );

  program
    .command("tui")
    .description("interactive rig session (readline)")
    .option("--model <m>", "provider/model or @smol|@default|@vision")
    .option("--max-steps <n>", "max tool steps", (v: string) => parseInt(v, 10))
    .option("--session <id>", "continue or fork a named session thread")
    .option("-c, --continue", "continue the most recent session")
    .action(
      async (opts: { model?: string; maxSteps?: number; session?: string; continue?: boolean }) => {
        const { runTui } = await import("./tui/tui.js");
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
    const { runTui } = await import("./tui/tui.js");
    await runTui({ profile: program.opts().profile as string | undefined });
    return;
  }
  await program.parseAsync(process.argv);
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
