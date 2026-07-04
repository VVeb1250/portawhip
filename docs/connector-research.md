# Connector research — harness-router links

Verified 2026-07-04.

## Why revisit this

The open item from `HANDOFF.md` is not MCP installation itself: pull-mode
`harness-router` is already installed across detected MCP hosts through
`add-mcp`. The gap is the connector surface around it: each host needs either a
native instruction block telling the model to call `route()`, or an explicit
`mcp-only` status when no reliable instruction convention is known.

## Reference checked

- `ken-jo/agent-connector`: https://github.com/ken-jo/agent-connector
- Agent Connector README describes a `defineConnector()` model: declare a
  server plus related surfaces once, then render host-native config/plugin
  artifacts for detected hosts.
- The useful pattern for this repo is the separation between connector identity,
  server launch shape, and per-host rendered surfaces.
- The dependency itself is still not adopted here because `portable-harness-v2`
  is currently a consumer-side router/loader, not a branded MCP package authoring
  flow. `add-mcp` remains the right delegated MCP config writer for installed
  third-party servers.

## Host instruction references

- Codex: official OpenAI docs say Codex reads `AGENTS.md`.
  https://developers.openai.com/codex/guides/agents-md
- Gemini CLI: official Gemini CLI docs use `GEMINI.md` context files.
  https://google-gemini.github.io/gemini-cli/docs/cli/gemini-md.html
- Cursor: official Cursor docs cover persistent rules including Project Rules
  and AGENTS.md support.
  https://cursor.com/docs/rules
- GitHub Copilot / VS Code: official docs use
  `.github/copilot-instructions.md` for repository custom instructions.
  https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot
  https://code.visualstudio.com/docs/agent-customization/custom-instructions

## Implemented shape

- `core/connector-targets.mjs`: data-only host-to-instruction-surface catalog.
- `scripts/link-connectors.mjs`: detects hosts, verifies whether
  `harness-router` is linked as an MCP server, and installs/removes/status-checks
  instruction blocks per host.
- `adapters/instructions/generate.mjs`: still owns idempotent marked blocks, now
  with variants for generic, Claude Code, and Cursor `.mdc` rules.

## Current coverage model

- MCP link: delegated to `add-mcp` and checked with `listInstalledServers()`.
- Instruction link:
  - Claude Code: `CLAUDE.md`, with ToolSearch-specific wording.
  - Codex: `AGENTS.md`.
  - Gemini CLI: `GEMINI.md`.
  - Cursor: `.cursor/rules/harness-router.mdc` plus `AGENTS.md` fallback.
  - GitHub Copilot CLI / VS Code: `.github/copilot-instructions.md`.
- Hosts without a trustworthy instruction file convention are reported as
  `instruction:mcp-only` rather than pretending they have equal behavior.

