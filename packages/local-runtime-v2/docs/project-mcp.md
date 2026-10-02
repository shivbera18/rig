# Project-level MCP Configuration

The local Runtime reads `.mcp.json` from the active session's primary workspace directory. Desktop, Rig interactive TUI, `rig exec`, `rig acp`, and CLIs sharing the same Runtime utilize this capability. No manual import is needed.

```json
{
  "mcpServers": {
    "repo-tools": {
      "command": "node",
      "args": ["./tools/mcp-server.js"],
      "env": { "API_TOKEN": "${REPO_API_TOKEN}" }
    },
    "docs": {
      "type": "http",
      "url": "${DOCS_MCP_URL:-https://example.com/mcp}",
      "headers": { "Authorization": "Bearer ${DOCS_TOKEN}" }
    }
  }
}
```

## Automatic Loading and Connection

- Runtime reads configuration from the session's canonical `workspaceDir`. It does not skip project files based on client type; project path does not depend on Runtime process startup cwd.
- Reading configuration or listing does not launch MCP. During actual turn tool discovery or invocation, Runtime automatically connects to valid, non-disabled servers.
- stdio connections execute commands in project config, and remote connections access configured URLs. Tool calls still follow standard permission policies.
- Configuration is re-read before tool discovery and execution. When file content or expanded environment variables change, old project calls are aborted, old connections closed, and subsequent requests automatically use the new config.
- Entries can be disabled with `enabled: false` in `.mcp.json`. When the file is deleted or invalid, the project layer is removed and matching profile config restored.
- The file remains strictly read-only; it does not write back to the profile's `mcp.json`.

## Project Boundaries and Format

- Only `.mcp.json` in the primary workspace directory is read; no upward directory walking or `/add-dir` scanning.
- Supports stdio, `http`, `streamable-http`, and `sse`.
- `command`, `args`, `env`, `url`, and `headers` support `${VAR}` and `${VAR:-default}`. Missing variables disable the server and show the variable name without echoing values.
- Supports positive integer `timeout` (milliseconds). Runtime internal fields are not loaded from project files.
- stdio cwd and MCP `roots/list` use the canonical primary project directory. HTTP credentials cannot cross origin redirects.
- File max size is 1 MiB. Invalid JSON or naming conflicts invalidate the file; single server errors do not block other valid servers.

## Precedence and Status

Precedence for matching names is **ACP session > project > profile** full replacement, without splicing URLs, commands, env, or headers across sources. Disabled or errored project entries still shadow matching profile entries.

Config, connections, and error state are isolated by session, canonical project directory, and configuration version.

- TUI `/mcp`: Displays Built-in, User-configured, Project, and Client session config and state for current session.
- TUI `/mcp reload`: Re-reads and displays; `/mcp <filter>` filters by server name.
- ACP `/mcp <filter>`: Lists active config for current ACP session.
- Inspection interfaces do not echo args, env, headers, or URL queries.

Connection statuses are `available`, `configured`, `disabled`, or `error`.
