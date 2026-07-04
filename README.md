# portawhip

A thin, dynamic control plane for AI agent hosts (Claude Code, Codex, Gemini
CLI, Cursor, ...): a **tools collector** that installs capabilities by
delegating to existing, actively-maintained tools, and a **router** that
surfaces the right capability at the right moment instead of loading
everything into context up front.

Two halves:

1. **Loader** — declare a capability once in `recipe.yaml`, it gets
   dispatched to whichever backend already solves that install problem well
   (`add-mcp` for MCP servers, `mise` for CLI tools, `agent-skill-manager`
   for skills). No install logic of its own, no hardcoded host list.
2. **Router** — a hybrid keyword/lexical retrieval engine over both curated
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
npm test                  # 39 unit/integration tests
```

Or let a connected agent host call the `harness-router` MCP server's
`route(query)` / `list_all(type?)` tools directly.

## Status

All 4 planned phases (loader → registry/scorer → pull-mode → push-mode →
feedback loop) are built and locally verified. Read
[`HANDOFF.md`](HANDOFF.md) for the current, living state — known gaps,
bugs found and fixed, and what's honestly still unverified (e.g. this was
built and tested on Windows only; POSIX-safety was reviewed statically,
not live-verified on macOS/Linux).

## License

MIT — see [`LICENSE`](LICENSE).
