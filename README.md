# portawhip

A thin, dynamic control plane for AI agent hosts (Claude Code, Codex, Gemini
CLI, Cursor, ...): a **tools collector** that installs capabilities by
delegating to existing, actively-maintained tools, and a **router** that
surfaces the right capability at the right moment instead of loading
everything into context up front.

Two halves:

1. **Loader / cross-host sync** — declare a capability once in `recipe.yaml`,
   it gets dispatched to whichever backend already solves that install problem
   well (`add-mcp` for MCP servers, `mise` for CLI tools, `agent-skill-manager`
   for skills). On top of that, a **sync connector** reads what's already
   installed across every host, promotes it into a shared canonical set, and
   fans it out to all the others — tools, skills, commands, agents, and
   (inventory) embedded hooks. No install logic of its own, no hardcoded host
   list.
2. **Router** — a hybrid lexical + dense-semantic retrieval engine (the
   semantic channel runs on a local embedding model that downloads and
   caches itself on first use, no manual setup) over both curated
   (`recipe.yaml`) and live auto-discovered capabilities, exposed 3 ways:
   pull (`harness-router` MCP server), push (a native hook that suggests
   capabilities inline as you type), and CLI. Usage feedback (was a
   suggestion actually used?) adjusts future ranking.

## Why

Most "skill router" setups either dump every tool's full description into
context (expensive) or hardcode brittle routing rules that misfire on
unrelated prompts (noisy). This project's answer: silence is a valid
output. If nothing clears the confidence bar, say nothing — never guess.

See [`VISION.md`](VISION.md) for the full design rationale and the
predecessor project's failure modes this is deliberately avoiding.

## Install

```bash
npm install
node scripts/load.mjs              # dispatch recipe.yaml to add-mcp/mise/asm
node scripts/doctor.mjs            # live-probed health check across all layers
```

Link the router into your agent hosts:

```bash
node scripts/link-connectors.mjs install --scope global   # instruction blocks (CLAUDE.md/AGENTS.md/...)
node scripts/link-hooks.mjs install --scope global        # native push-mode hooks, where supported
```

Both support `status` (dry read, no writes) and `remove`, and both back up
nothing themselves for `--scope global` writes — back up your host config
files yourself before running against global scope for the first time.

## Usage

```bash
node core/router-cli.mjs route --prompt "convert this pdf to text"
node core/router-cli.mjs list --type skill
npm run route:eval        # regression eval against docs/router-eval-set.jsonl
npm run sync-config       # status for delegated config-sync backends
npm run sync-config:preview -- --backend ai-config-sync
npm run sync-config:preview -- --profile ai-project-instructions
npm test                  # unit/integration tests
```

Or let a connected agent host call the `harness-router` MCP server's
`route(query)` / `list_all(type?)` tools directly.

## Config Sync

`scripts/sync-config.mjs` is a thin facade over existing sync backends. It
does not reconcile host files itself:

- `ai-config-sync-manager` for Claude Code ↔ Codex drift, preview, and apply.
- `agent-skill-manager` as the current skill-provider probe backend.
- `@agents-dev/cli` (`.agents`) as an optional source-of-truth sync probe for
  broader host coverage.

Default commands are read-only or dry-run. Writes require
`node scripts/sync-config.mjs apply --apply` plus a narrow `--include` or
`--profile`; broad all-area apply and all-skills apply are blocked.

Runtime package execution is pinned by default. `ai-config-sync-manager` is
installed as an exact dev dependency, so `npm run sync-config` uses
`node_modules/.bin/ai-config-sync` instead of downloading a package at command
time. The fallback to `npx --yes` is disabled unless the caller explicitly
passes `--allow-npx` or sets `PORTAWHIP_ALLOW_NPX=1`.

The TUI is available with:

```bash
npm run tui
node scripts/tui.mjs --summary
node scripts/tui.mjs --help
```

`router-cli route` is interactive-fast by default: dense retrieval joins only
when already warm. Use `--dense-block` for explicit offline/eval-style waits.

Built-in profiles:

- `ai-project-instructions` — project-scope Claude/Codex instructions only.
- `ai-global-instructions` — global Claude/Codex instructions only.
- `ai-project-mcp` — project-scope MCP only.
- `asm-status` — agent-skill-manager provider probe.
- `agents-check` — `.agents` source-of-truth status/check.

## Cross-host capability sync

Bring a capability that's installed in one host into the shared set, and let
every other host pick it up.

```bash
npm run import                 # grouped: what's installed but not yet canonical
npm run import:preview         # same, as a plan
node scripts/import-surfaces.mjs apply --apply --type cli,mcp   # promote (auto-enriched)
npm run sync-surfaces sync     # fan canonical out to all detected hosts
npm run hooks:embedded         # inventory hooks bundled inside skills/plugins
```

- **Import is manual, fan-out is automatic.** You choose what becomes
  canonical; a session-start hook then keeps every host in sync in the
  background (`autoSync` in `router.config.yaml`, throttled). Import never
  runs on its own.
- **CLI entries are auto-enriched** on import (mise registry → package
  registry → tldr → `--help`), so a bare `rg` routes on "search / grep /
  regex", not just its own name — no LLM involved.
- **Embedded hooks are inventoried, not linked.** Activating a third-party
  hook is a trust boundary; portawhip shows you what's there and stops.
- The `portawhip` management skill wraps this whole workflow — a connected
  agent can drive it when you ask to import/sync tools.

## Host support

portawhip syncs across Claude Code, Codex, Gemini CLI, Cursor, VS Code /
Copilot, OpenCode, Zed, Windsurf, Cline, plus Pi and Amp — each to the extent
its config surface allows. See **[`docs/host-support.md`](docs/host-support.md)**
for the full per-surface matrix and the concrete reason behind every gap
(e.g. Gemini commands are TOML not markdown; several hosts have no lifecycle
hook API). Detection is delegated to `add-mcp` plus a presence-checked
supplementary detector — a host is only ever targeted when it's actually
installed.

## Status

All 4 planned phases (loader → registry/scorer → pull-mode → push-mode →
feedback loop) are built and locally verified. Read
[`HANDOFF.md`](HANDOFF.md) for the current, living state — known gaps,
bugs found and fixed, and what's honestly still unverified (e.g. this was
built and tested on Windows only; POSIX-safety was reviewed statically,
not live-verified on macOS/Linux).

## License

MIT — see [`LICENSE`](LICENSE).
