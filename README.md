<div align="center">

# <img width="646" height="87" alt="portawhip" src="https://github.com/user-attachments/assets/bfb6583b-a7e3-4237-8776-0de6cf18379f" />

**One control plane for the tools, skills, MCP servers, and hooks used by your AI coding agents.**

[![npm version](https://img.shields.io/npm/v/portawhip?color=cb3837&logo=npm)](https://www.npmjs.com/package/portawhip)
[![npm downloads](https://img.shields.io/npm/dm/portawhip?color=2f80ed)](https://www.npmjs.com/package/portawhip)
[![CI](https://github.com/VVeb1250/portawhip/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/VVeb1250/portawhip/actions/workflows/ci.yml)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Stop loading every capability into every prompt. Portawhip discovers what is installed, keeps agent hosts aligned, and surfaces only the capability that fits the task.

</div>

## Install

Portawhip is published on npm and requires Node.js 20 or newer. Run it once without installing anything globally:

```bash
npx --yes portawhip
```

Or install the CLI globally:

```bash
npm install --global portawhip
portawhip
```

No repository clone is required for normal use. The npm package provides three executables: `portawhip` for the interactive TUI, `portawhip-router` for direct routing, and `harness-router` for MCP hosts.

Route a task directly from npm:

```bash
npx --yes --package=portawhip -- portawhip-router route --prompt "inspect this PDF and extract its tables"
```

Portawhip returns a short, actionable pointer—or nothing. Abstaining on weak matches is a feature, so unrelated prompts stay clean.

## What it solves

AI agent setups drift quickly: one host knows about an MCP server, another has the useful skill, and every tool description competes for context. Portawhip gives that sprawl one lightweight control plane:

- **Discover** capabilities already installed across Claude Code, Codex, Gemini CLI, Cursor, VS Code/Copilot, OpenCode, Zed, Windsurf, Cline, Pi, and Amp.
- **Route** with a hybrid lexical + local semantic engine instead of dumping the full catalog into context.
- **Sync** tools, skills, commands, agents, MCP configuration, and supported hooks across hosts.
- **Stay safe** with read-only status/preview defaults and explicit confirmation for writes in the TUI.
- **Learn quietly** from whether suggestions were used, without sending prompts to a hosted model.

## Three ways to use it

### 1. Interactive TUI

```bash
npx --yes portawhip
```

The six tabs cover overview, config sync, connectors, hooks, enrichment, and the capability catalog. Press `h` or `?` for the key map. Repair/remove actions require a second keypress.

### 2. Router CLI

```bash
npx --yes --package=portawhip -- portawhip-router list --type skill
npx --yes --package=portawhip -- portawhip-router route --prompt "run an accessibility-focused browser test"
```

Dense retrieval uses a local multilingual embedding model and warms in the background. Add `--dense-block` when deterministic full semantic retrieval matters more than startup latency.

### 3. MCP connector

Add this stdio server to any MCP-compatible host:

```json
{
  "mcpServers": {
    "harness-router": {
      "command": "npx",
      "args": ["--yes", "--package=portawhip", "--", "harness-router"]
    }
  }
}
```

The server exposes:

- `route(query)` — find the best installed capability for a concrete action.
- `list_all(type?)` — inspect the catalog, optionally filtered by capability type.

## Manage a workspace

Run Portawhip from the root of the project you want it to inspect. It discovers both project-local and global agent surfaces from the current working directory:

```bash
cd path/to/your-project
npx --yes portawhip
```

Use the TUI to review inventory, connector and hook status, and config-sync previews before applying changes. Global connector and hook changes are a trust boundary: back up host configuration first. Portawhip does not silently activate third-party embedded hooks.

## How it works

```text
installed tools + skills + MCP servers + agent surfaces
                         │
                         ▼
              live capability registry
                         │
              lexical + local semantic rank
                         │
                confidence / intent gates
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
       MCP pull       CLI / TUI      optional hooks
```

The loader delegates installation to maintained tools (`add-mcp`, `mise`, and `agent-skill-manager`) instead of rebuilding package management. The router combines curated entries from `recipe.yaml` with live discovery, then applies confidence, intent, and per-lane peakedness gates. See [VISION.md](VISION.md) for the design rationale.

## Useful commands

| Goal | Command |
| --- | --- |
| Interactive TUI | `npx --yes portawhip` |
| List discovered skills | `npx --yes --package=portawhip -- portawhip-router list --type skill` |
| Route a task | `npx --yes --package=portawhip -- portawhip-router route --prompt "your task"` |
| Global install | `npm install --global portawhip` |

Repository-level commands such as `npm test`, `npm run doctor`, and `npm run route:eval` are for contributors working from a source checkout.

## Supported surfaces

Support is capability-specific: some hosts expose MCP configuration but no native lifecycle hooks. Portawhip reports those lanes as `mcp-only` or `unsupported` instead of pretending they are linked. The evidence-backed matrix lives in [docs/host-support.md](docs/host-support.md).

## Privacy and safety

- Routing runs locally; the dense model is downloaded and cached on first use.
- Status and preview commands are read-only by default.
- Broad config writes and all-skills writes are blocked.
- Runtime package fallback through unpinned `npx --yes` is opt-in.
- Host-native permission controls still govern actual tool execution.

Please report security issues through the private process in [SECURITY.md](SECURITY.md), not a public issue.

## Contributing

Bug reports, host adapters, routing eval cases, and documentation improvements are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the open [issues](https://github.com/VVeb1250/portawhip/issues). Release process and maintainer workflow live in [MAINTAINING.md](MAINTAINING.md).

## License

MIT © portawhip contributors. See [LICENSE](LICENSE).
