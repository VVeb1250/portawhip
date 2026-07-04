# Hand-off — read this first

Order to read docs in: **this file** → `VISION.md` (why + destination, only
changes when direction changes) → `PLAN.md` (phase roadmap) → the
`docs/phase*-verify*.md` files (what was actually proven, with commands to
re-check it yourself).

## Where things actually stand (2026-07-04, end of session)

All 4 PLAN.md phases are now built and locally verified:

- **Step 1 (loader)**, **Phase 0 (router base)**, **Phase 1 (registry +
  scorer)**, **Phase 2 (pull-mode MCP server)**, **Phase 2.5 (hybrid
  retrieval)**: done, unchanged this session — see prior verify docs.
- **Phase 3 (push-mode Claude Code adapter)**: done, deliberately imperfect
  precision (see `docs/phase3-verify.md`). `adapters/claude-code/push-hook.mjs`
  + `scripts/install-push-hook.mjs`, installed live into
  `~/.claude/settings.json` (backed up first).
- **Phase 4 (feedback loop)**: done. `core/feedback.mjs` +
  `adapters/claude-code/feedback-mark-hook.mjs`, installed live into the
  same `settings.json` (`PostToolUse`). Dense embedding rerank not
  attempted (optional in plan, no proven gap).
- Per-project readiness gap (tools installed globally but needing local
  init, e.g. codegraph's `.codegraph/`): solved via optional
  `route.readyMarker`/`readyHint` fields, curated-entry-only, checked in
  push-hook.mjs against the caller's real per-invocation cwd. See the
  `codegraph` entry in `recipe.yaml` for the pattern to reuse for the next
  tool like this.

## Cross-host coverage — Codex closed most of this gap (2026-07-04, later same day)

Codex built a canonical multi-host layer: `adapters/hooks/universal-hook.mjs`
(one hook body, per-host payload shapes) + `scripts/link-hooks.mjs` /
`scripts/link-connectors.mjs` (status/install/remove, `--scope project|global`).
Verified live via `status --scope global`:

| layer | claude-code | claude-desktop | codex | cursor | gemini-cli | github-copilot-cli | vscode |
|---|---|---|---|---|---|---|---|
| harness-router MCP installed (pull-mode) | ✅ | ❌ (add-mcp reports missing) | ✅ | ✅ | ✅ | ✅ | ✅ |
| instruction block ("call route() first") | ✅ CLAUDE.md | mcp-only | ✅ AGENTS.md | mcp-only (no confirmed convention at global scope) | ❌ GEMINI.md not written yet | mcp-only | mcp-only |
| native push/feedback hook | ✅ | unsupported | ✅ | unsupported | ✅ | unsupported | unsupported |

Cursor/copilot-cli/vscode have no confirmed native hook lifecycle
(`docs/hook-sync-research.md`) — reported honestly as `unsupported`/
`mcp-only` rather than faked. This is believed final for those 3 unless a
future host update adds one; don't keep chasing it without new evidence.

**Found and fixed same day: duplicate hook firing.** My original
Phase 3/4 hooks (`adapters/claude-code/push-hook.mjs` +
`feedback-mark-hook.mjs`, global scope) and Codex's `universal-hook.mjs`
(installed project-scoped, inside this repo's own `.claude/settings.json`)
were BOTH active for claude-code when working in this repo — double
suggestions, double feedback-log entries. Resolved: removed my hooks from
global scope (`install-push-hook.mjs remove`), installed
`universal-hook.mjs` at global scope instead
(`link-hooks.mjs install --scope global` — now covers claude-code, codex,
gemini-cli everywhere, not just this repo), removed the now-redundant
project-scoped copy (`link-hooks.mjs remove --scope project`). All global
config writes backed up first (`link-hooks.mjs` itself has **no built-in
backup** — back up the 3 global paths manually before ever re-running
`install`/`remove --scope global`: `~/.claude/settings.json`,
`~/.codex/hooks.json`, `~/.gemini/settings.json`).
`adapters/claude-code/push-hook.mjs` and `feedback-mark-hook.mjs` are now
dead code (superseded by `universal-hook.mjs`) — not deleted yet, no
proven need to, but don't extend them further; extend `universal-hook.mjs`
instead.

Remaining real gap: `claude-desktop`'s MCP link itself reads `missing` (not
just the instruction layer) — unexplored, not just deprioritized.

## Known bugs found and fixed this session (don't reintroduce)

- **Hybrid engine loses recall on short single-trigger-word matches
  diluted by OR-combined generic query tokens** — e.g. "grep for TODO
  comments" scored ripgrep at 40 against a `hybridRecipeThreshold` of 130,
  because "todo"/"comments" matched unrelated auto-discovered docs harder
  than ripgrep's one real trigger ("grep"). Known, not fixed — deliberately
  deferred to real usage data via the Phase 4 feedback loop rather than
  another hand-tuned threshold (see `docs/phase3-verify.md`).
- **CLI usage-feedback matching used the wrong name.** `ripgrep`'s
  `source` field is the mise package name, not the invoked binary (`rg`) —
  Bash-command matching in `feedback-mark-hook.mjs` silently failed until
  the optional `route.binary` field was added. Check this for every new
  curated `cli`-type entry: does `source` match what's actually typed on
  the command line?

## How to sanity-check anything in this repo yourself

```bash
npm test                      # 16 unit tests, ~3s, mostly deterministic
npm run route:eval            # live eval against docs/router-eval-set.jsonl
npm run route:compare         # keyword vs hybrid engine side by side
npm run route -- --prompt "..."           # try any prompt against the live config
node scripts/install-push-hook.mjs status # what's actually installed right now
```

If a doc's claimed result and a fresh run disagree, trust the fresh run —
docs decay, live checks don't.
