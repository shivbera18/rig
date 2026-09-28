<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/wordmark-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/wordmark-light.svg">
    <img src="docs/assets/wordmark-light.svg" alt="Rig" width="760">
  </picture>
</p>

<h1 align="center">Rig</h1>
<p align="center">A terminal coding agent with BYOK models, cloud tools, plugins, and ACP.</p>

<p align="center">
  <a href="#quick-start">Get started</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="docs/examples.md">Examples</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>
<p align="center"><strong>English</strong> · <a href="README_ZH.md">简体中文</a></p>
<p align="center">
  <img src="docs/assets/node.svg" alt="Compatibility: Node.js 22.19+, 24.2+, 25, and 26">
  <a href="LICENSE-STATUS.md"><img src="docs/assets/license.svg" alt="First-party default license: MIT"></a>
</p>

Understand a project, make changes, and run tests from your terminal. Bring your own model (OpenAI, Anthropic, custom relays) or connect accounts with search, plugins, and multimodal tools in the same workflow.

## Quick start

### 1. Install Rig

**npm** — requires **Node.js 22.19+ (22.x), 24.2+ (24.x), 25, or 26**:

```bash
npm install -g @shivcdhry/rig
```

Reopen your terminal and verify the installation:

```bash
rig --version
rig --help
```

### 2. Configure a model provider (BYOK)

Bring Your Own Key (BYOK) lets you connect any OpenAI- or Anthropic-compatible provider. Set your API key in the shell, then register the provider:

```bash
export RIG_PROVIDER_API_KEY="your-api-key"

rig provider add --name my-provider --base-url https://api.openai.com/v1 \
  --api-format openai-completions --model gpt-4o \
  --api-key-env RIG_PROVIDER_API_KEY --use
```

`--use` tests the first listed model before saving and selecting it.

Supported API formats: `openai-completions`, `openai-responses`, and `anthropic-messages`. See the [model examples](docs/examples.md) for more setups and custom headers.

### 3. Run your first task

Open the project you want to work on:

```bash
cd /path/to/your/project
rig
```

Describe your task in the interactive TUI, or run it directly from your command line:

```bash
rig "Find a failing test, fix the implementation, and run the relevant tests."
```

| Entry point | Command | Use it for |
| --- | --- | --- |
| Interactive TUI | `rig [prompt]` | Explore code, converse, and review changes with granular permissions. |
| Headless | `rig exec [prompt]` | Shell scripts, CI/CD, batch processing, and evaluations. |
| ACP | `rig acp` | Editors and clients supporting the Agent Client Protocol. |

### Continue your work

```bash
# Resume the latest session in the current workspace
rig --continue

# Open the interactive session picker
rig --session
```

Inside the TUI, use `/sessions` to browse past sessions and `/help` to view all available commands and shortcuts.

| Action | Shortcut |
| --- | --- |
| Send a message or steer running task | `Enter` |
| Queue a follow-up message while task runs | `Alt+Enter` |
| Insert a newline | `Shift+Enter` |
| Reference a workspace file or directory | `@` |
| Toggle Plan Mode | `Shift+Tab` |
| Switch permission modes | `Alt+M` |
| Close panel or interrupt task | `Escape` / `Ctrl+C` |

## Capabilities

| Feature | Description |
| --- | --- |
| **Edit & Verify Code** | Read files, inspect diffs, execute shell commands and tests, with granular permission boundaries and sandboxing. |
| **Choose Your Model** | Bring your own keys for OpenAI, Anthropic, or compatible custom endpoints and relays. |
| **Tools & Extensibility** | Built-in search, MCP (Model Context Protocol), local skills, and plugin system. |
| **Flexible Workflows** | Interactive terminal UI, headless CLI automation for pipelines, and ACP for IDE integration. |

## Build from source

To develop Rig locally:

```bash
git clone https://github.com/shivcdhry/rig.git
cd rig
pnpm install
pnpm build
pnpm rig
```

To run Rig against any directory using your source build:

```bash
node /path/to/rig/dist/cli.js
```

## Documentation

- [Getting Started & Installation](docs/installation.md)
- [Usage Examples](docs/examples.md)
- [Architecture & Design](docs/architecture.md)
- [Contributing](CONTRIBUTING.md)

## License

MIT © Rig contributors. See [LICENSE](LICENSE) for details.
