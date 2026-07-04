# Phase 2 verify — pull-mode MCP server

Verified 2026-07-04.

## What was proven

1. **Server works standalone.** `server/mcp-server.mjs` exposes `route` and
   `list_all` via `@modelcontextprotocol/sdk`. Smoke-tested with a real MCP
   client (`StdioClientTransport`): `route("extract table from this pdf")`
   returned the correct pointer, `route("write a poem about the ocean")`
   correctly returned `[]`.
2. **Registered on 2 hosts minimum** (Claude Code, Codex), plus 5 more
   detected on this machine (Claude Desktop, Cursor, Gemini CLI, GitHub
   Copilot CLI, VS Code) — via the existing Step 1 loader (`recipe.yaml`'s
   new `harness-router` entry, dogfooding the loader on itself).
3. **Cwd-independence proven.** add-mcp silently promoted the install from
   project to global scope ("Selected agents require global installation").
   A relative path would have broken for any host launched from outside
   this repo. Fixed by resolving to an absolute path before writing host
   configs (`scripts/load.mjs`) and having the server resolve its own
   `recipe.yaml`/`router.config.yaml`/cache via `import.meta.url`, not
   `process.cwd()` (`server/mcp-server.mjs`, `core/registry.mjs`). Verified
   by spawning the server with `cwd` set to `%TEMP%` and confirming
   `route()` still returned the correct result.
4. **Instruction one-liner installed** (idempotent, marker-comment based —
   `adapters/instructions/generate.mjs`) into the user's real global
   `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md` (backed up first).
   Verified idempotent install/remove on a scratch file before touching the
   real ones: no duplicate block on repeat install, exact restore on remove.

## What's not yet proven

**Live behavioral confirmation** — a fresh Claude Code / Codex CLI session
actually calling `route()` unprompted on a matching task, per PLAN.md's
literal exit criteria. The MCP plumbing and instruction text are both in
place; what's untested is whether the model, in a real fresh session,
follows the instruction on its own. This needs to be observed the next time
either host is opened in a new session — not something provable from
within this same running session.
