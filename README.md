<div align="center">

# <img width="646" height="87" alt="portawhip" src="https://github.com/user-attachments/assets/bfb6583b-a7e3-4237-8776-0de6cf18379f" />

**One control plane for the tools, skills, MCP servers, and hooks used by your AI coding agents.**

[![npm version](https://img.shields.io/npm/v/portawhip?color=cb3837&logo=npm)](https://www.npmjs.com/package/portawhip)
[![npm downloads](https://img.shields.io/npm/dm/portawhip?color=2f80ed)](https://www.npmjs.com/package/portawhip)
[![CI](https://github.com/VVeb1250/portawhip/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/VVeb1250/portawhip/actions/workflows/ci.yml)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Discover the tools, skills, MCP servers, commands, agents and hooks already installed across your agent hosts — then keep every host aligned on them.

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

No repository clone is required for normal use. The npm package provides one executable, `portawhip`, for the interactive TUI.

## What it solves

AI agent setups drift quickly: one host knows about an MCP server, another has the useful skill, and every tool description competes for context. Portawhip gives that sprawl one lightweight control plane:

- **Discover** capabilities already installed across Claude Code, Codex, Gemini CLI, Cursor, VS Code/Copilot, OpenCode, Zed, Windsurf, Cline, Pi, and Amp.
- **Sync** tools, skills, commands, agents, MCP configuration, and supported hooks across hosts.
- **Extend** through capability providers — optional packages that add config keys, instruction connectors, and hook behaviour without portawhip depending on them.
- **Stay safe** with read-only status/preview defaults and explicit confirmation for writes in the TUI.

## How to use it

### Interactive TUI

```bash
npx --yes portawhip
```

The seven tabs cover overview, config sync, connectors, hooks, enrichment, the capability catalog, and settings. The settings tab shows the keys of whatever providers you have installed. Press `7` to configure user/project overrides, or `h`/`?` for the full key map. Config writes and repair/remove actions require confirmation.

### Capability providers

Routing lives in a separate package, [`portawhip-router`](https://github.com/VVeb1250/portawhip-router).
Portawhip collects capabilities; the router decides which one to mention for a
given task, instead of dumping the catalogue into the model's context.

```bash
npm install portawhip portawhip-router
```

Installing it is the whole of the wiring. Portawhip resolves providers at
runtime, so the router's settings appear in `portawhip config`, its instruction
connector goes out to your hosts on the next sync, and the universal hook starts
asking it what to say. Uninstall it and all of that goes away — portawhip keeps
working, just quieter.

That seam is open: a provider is any package exporting a `configSchema`, a
`connector`, or `hooks`. `PORTAWHIP_EXTRA_PROVIDERS=name=<specifier>` registers
one you are developing locally, and `PORTAWHIP_DISABLE_PROVIDERS` turns one off
without uninstalling it.

## Manage a workspace

Run Portawhip from the root of the project you want it to inspect. It discovers both project-local and global agent surfaces from the current working directory:

```bash
cd path/to/your-project
npx --yes portawhip
```

Use the TUI to review inventory, connector and hook status, and config-sync previews before applying changes. Global connector and hook changes are a trust boundary: back up host configuration first. Portawhip does not silently activate third-party embedded hooks.

### Configure Portawhip

The packaged defaults are now overridable without cloning or editing the npm package. In the TUI, press `7`, choose user/project scope with `g`, select a setting, then press `e` to edit or `u` twice to unset. Boolean and enum values use `←`/`→` or Space; numeric fields reject non-numeric input and `Ctrl+U` clears the current value:

    # Inspect the effective merged configuration
    npx --yes portawhip config list

    # Persist a preference for this user
    npx --yes portawhip config set denseEnabled false

    # Override it only in the current project
    npx --yes portawhip config set denseEnabled true --scope project

    # Return to the inherited value
    npx --yes portawhip config unset denseEnabled --scope project

Configuration is layered from lowest to highest priority:

1. packaged defaults
2. user config (<code>%APPDATA%portawhipconfig.yaml</code> on Windows, <code>$XDG_CONFIG_HOME/portawhip/config.yaml</code> or <code>~/.config/portawhip/config.yaml</code> elsewhere)
3. <code>&lt;project&gt;/.portawhip/config.yaml</code>
4. the file named by <code>PORTAWHIP_CONFIG</code>

Use <code>portawhip config get &lt;key&gt;</code>, <code>list</code>, <code>set</code>, <code>unset</code>, or <code>path</code>; add <code>--json</code> for machine-readable output. Values are type- and range-checked before writes. Run <code>portawhip config --help</code> for the full command reference.

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

The loader delegates installation to maintained tools (`add-mcp`, `mise`, and `agent-skill-manager`) instead of rebuilding package management. The registry combines curated entries from `recipe.yaml` with live discovery of what each host already has. See [VISION.md](VISION.md) for the design rationale.

## Useful commands

| Goal | Command |
| --- | --- |
| Interactive TUI | `npx --yes portawhip` |
| Show effective configuration | <code>npx --yes portawhip config list</code> |
| Set a user preference | <code>npx --yes portawhip config set &lt;key&gt; &lt;value&gt;</code> |
| Global install | `npm install --global portawhip` |

Repository-level commands such as `npm test` and `npm run doctor` are for contributors working from a source checkout.

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
