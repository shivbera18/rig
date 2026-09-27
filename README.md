# rig

Minimax-inspired headless coding-agent CLI: multi-account auth pool with
fallback, git-worktree-isolated subagents, model-role agents
(`@smol`/`@default`/`@vision`), and web search.

## Install

```sh
npm install -g @shivbera18/rig
# or run once
npx @shivbera18/rig exec "list TODOs in this repo"
```

Requires Node ≥ 22.

## Auth

```sh
rig login                 # pick a provider (opencode-zen, google-antigravity, openai-codex)
rig login opencode-zen
rig auth check            # probe every stored credential
rig logout opencode-zen
```

Credentials live in `~/.rig/auth.json` (mode `0600`); config in
`~/.rig/config.yaml` (created on first run). Use `--profile <name>` or
`RIG_PROFILE` for isolated profiles (`~/.rig-<name>`), `RIG_DATA_DIR` to
override the data dir outright.

## Use

```sh
rig exec "print the contents of package.json" --model @smol
rig exec "list TODOs in this repo" --model @default
rig exec "summarise the auth flow" --model provider-id/model-id --max-steps 20
rig provider list
```

## How it works

`exec` → config → credential pool (round-robin, 401/403 fallback) →
provider dispatch (openai-completions / openai-responses /
anthropic-messages) → turn loop (`read`, `write`, `edit`, `bash`,
`web_search`, `task`) → final answer. `task` spawns subagents in detached
git worktrees and merges their diffs back as patches.

## Dev

```sh
pnpm install && pnpm build
node dist/cli.cjs --help
node --test test/*.test.mjs
```

## License

MIT
