# rig

Interactive + headless coding-agent CLI: multi-account auth pool with
fallback, git-worktree-isolated subagents, model-role agents
(`@smol`/`@default`/`@vision`), web search, and persistent sessions.

## Install

```sh
npm install -g @shivcdhry/rig
# or run once
npx @shivcdhry/rig exec "list TODOs in this repo"
```

Requires Node ≥ 22.

## Interactive

Bare `rig` drops into the session (same as `rig tui`):

```sh
rig
rig tui --model @smol
rig tui --continue
```

Slash commands: `/help /new /model /status /usage /context /compact
/export /copy /sessions /resume /fork /rewind /retry /history /queue
/stop /login /logout /doctor /provider /agents /tools /permissions
/review /quit`. `/` lists commands, Tab completes, ↑/↓ recalls history,
Ctrl+C interrupts a run. Every answer streams live with per-tool progress
and saves to `~/.rig/sessions/`.

## Headless (CI-friendly)

```sh
rig exec "print the contents of package.json" --model @smol
rig exec "list TODOs" --format json --output result.json --print-session
rig exec "summarise" --format stream-json | jq .
rig exec "again" --continue
rig sessions list
```

## Auth

```sh
rig login                 # pick a provider (opencode-zen + env-configured OAuth)
rig login opencode-zen
rig auth check            # probe every stored credential
rig logout opencode-zen
```

`opencode-zen` uses an API key. OAuth providers need client IDs via env
(`RIG_GOOGLE_CLIENT_ID` / `RIG_GOOGLE_CLIENT_SECRET`, `RIG_CODEX_CLIENT_ID`);
without them `rig login <id>` prints setup guidance.

Credentials live in `~/.rig/auth.json` (mode `0600`); config in
`~/.rig/config.yaml` (created on first run). Use `--profile <name>` or
`RIG_PROFILE` for isolated profiles (`~/.rig-<name>`), `RIG_DATA_DIR` to
override the data dir outright.

## How it works

`exec`/`tui` → config → credential pool (round-robin, 401/403 fallback) →
provider dispatch (openai-completions / openai-responses /
anthropic-messages) → turn loop (`read`, `write`, `edit`, `bash`,
`web_search`, `task`) → final answer. `task` spawns subagents in detached
git worktrees and merges their diffs back as patches.

## Release

Push a `v*` tag and GitHub Actions publishes to npm (OIDC trusted
publishing, no long-lived token):

```sh
git tag v0.2.0 && git push origin v0.2.0
```

## Dev

```sh
pnpm install && pnpm build
node dist/cli.cjs --help
node --test test/*.test.mjs
```

## License

MIT
