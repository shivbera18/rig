import { Command } from "commander";
import { getConfigPath, loadConfig } from "./config.js";
import { runExec } from "./cli/exec.js";
import { runLogin, runLogout } from "./auth/cli.js";
import { runAuthCheck } from "./auth/pool.js";

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("rig")
    .description("rig — minimax-inspired coding CLI")
    .option("--profile <name>", "config profile");

  program
    .command("exec <prompt>")
    .description("headless agent run")
    .option("--model <m>", "provider/model or @smol|@default|@vision")
    .option("--max-steps <n>", "max tool steps", (v: string) => parseInt(v, 10))
    .action(async (prompt: string, opts: { model?: string; maxSteps?: number }) => {
      await runExec(prompt, { ...opts, profile: program.opts().profile as string | undefined });
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

  await program.parseAsync(process.argv);
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
