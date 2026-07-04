# Hand-off — read this first

Order to read docs in: **this file** → `VISION.md` (why + destination, only
changes when direction changes) → `PLAN.md` (phase roadmap) → the
`docs/phase*-verify*.md` files (what was actually proven, with commands to
re-check it yourself).

## Published (2026-07-04, later same day)

Repo is live at **https://github.com/VVeb1250/portawhip** (public, MIT
license, topics: mcp/mcp-server/ai-agents/agent-tools/developer-tools/
claude-code/cli/nodejs/context-management/tool-router). `package.json`
renamed `portable-harness-v2` → `portawhip` to match. The old predecessor
repo `VVeb1250/portable-harness` (v1, diagnosed broken — see VISION.md §0)
was flipped from public to private to avoid confusion with this one; its
own archives (`port-a-whip-archive`, `-V3`) were already private,
untouched. Secret-scanned twice (pre- and post-visibility-flip) — no
tokens/keys found, only the intentional copyright name in `LICENSE`/
`package.json`.

## Known open gap, not yet decided (2026-07-04) — auto-discovered CLI entries have zero "made for agent" vetting

`core/discover.mjs`'s `discoverCli()` turns **every** mise-tracked CLI tool
on the machine into a routable capability — trigger is just the bare tool
name, description is the literal string `"CLI tool: <name>"`. No signal
anywhere distinguishes "built/documented for non-interactive agent use"
from "some unrelated dev tool the user happens to have installed" — no
such metadata exists in mise or anywhere else industry-wide, so this
can't be solved by reading better metadata.

Two distinct risks this raises, deliberately not conflated:
- **Security**: low. The router only ever emits a text suggestion into
  context — it does not execute anything. Actually running a suggested
  CLI still goes through the host's own permission gate (e.g. Bash tool
  approval). A bad suggestion costs context/noise, not an unsafe action.
- **Functional**: real but currently latent. An interactive-only CLI
  (waits on stdin, no `--json`/non-interactive mode) could hang if an
  agent trusted "CLI tool: X" enough to invoke it non-interactively. Only
  1 CLI is currently auto-discovered on this machine (`ripgrep`, which is
  also curated), so this hasn't bitten yet — but it will as soon as more
  mise-tracked tools exist here.

Discussed options, **none implemented yet, no decision made**:
- Exclude `origin: "auto:cli"` entries from routing entirely (still show
  in `list_all`), require promotion to a curated `recipe.yaml` entry
  (human review) before an auto-discovered CLI becomes suggestible —
  mirrors the `pdf`/`codegraph` curated-override pattern already in use.
  Leaning direction, not committed.
- User's own framing: "ค่อนข้างปัญหาโลกแตก" (open-ended problem) —
  explicitly deferred, come back to it later rather than force a fix now.

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
`adapters/claude-code/push-hook.mjs`, `feedback-mark-hook.mjs`, and
`scripts/install-push-hook.mjs` were deleted (2026-07-04, later same day) —
fully superseded by `universal-hook.mjs` + `link-hooks.mjs`, confirmed no
other references except historical mentions in this file and
`docs/phase3/4-verify.md` (left as-is, they're a record of what was true
at the time). `core/registry.mjs`'s `route.binary` comment updated to
point at the current consumer.

**`claude-desktop`'s MCP link reads `missing` — root cause found, not
fixable here.** `add-mcp`'s `listInstalledServers({agents:["claude-desktop"]})`
finds the config file (`%APPDATA%\Claude\claude_desktop_config.json`) but
it has **no `mcpServers` key at all** — this machine's Claude Desktop is
running a newer "Cowork"-style config schema, not the classic
`{"mcpServers": {...}}` format `add-mcp` reads. `servers: []` for every
agent, not just harness-router — nothing has ever been installed there via
add-mcp, unrelated to this project. This is an upstream `add-mcp`/Claude
Desktop version mismatch, not our bug — matches "delegate, don't rebuild":
we don't own add-mcp's config-format detection. No further action here
unless add-mcp ships support for the newer schema.

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

## Gap review (2026-07-04, later same day) — what was found and closed

User asked "ขาดอะไรมั้ย" (what's missing) after the cross-host consolidation.
Found and fixed:

- **Zero automated tests for the newest, most side-effecting code.**
  `core/feedback.mjs`, `adapters/hooks/universal-hook.mjs`,
  `scripts/link-hooks.mjs`, `scripts/link-connectors.mjs` had only manual
  stdin smoke tests. Added `core/feedback.test.mjs` (temp-dir isolated),
  `scripts/link-hooks.test.mjs` + `scripts/link-connectors.test.mjs`
  (temp-file isolated, exercise the real install/remove/status logic), and
  `adapters/hooks/universal-hook.test.mjs` (subprocess, real recipe.yaml —
  clears its own `.hp-state/feedback` before/after each test). 39/39 total
  now (`npm test` runs all 5 files).
- **`link-hooks.mjs` and `link-connectors.mjs` ran `main()` unconditionally
  at module load** — importing either for testing would have silently
  mutated real global config. Both now guard `main()` behind the same
  `isMain` check `adapters/instructions/generate.mjs` already used, and
  export their pure logic (`installJsonHooks`/`removeJsonHooks`/
  `statusJsonHooks`, `applyTarget`) for the new tests to call directly
  against temp paths.
- **`.hp-state/feedback/events.jsonl` had no rotation** — would grow
  forever under real use. `core/feedback.mjs` now checks file size (no
  read) on every append and prunes to the most recent 5000 events once it
  crosses ~512KB — cheap on the common path, only pays a full read+rewrite
  the rare time it's actually needed.
- **`scripts/doctor.mjs` only checked Step 1's 3 backends** (context7/
  ripgrep/pdf), never updated as the router/hooks/connectors layers were
  built. Added 3 more live-probed checks (router registry, native hooks,
  instruction connectors) — same "shell out to the real command, don't
  reimplement" style as the original 3.
- **`PLAN.md` read as an open roadmap** with no closing note — risk of a
  future session re-planning finished work. Added a status banner at the
  top pointing to this file.

**Not actually fixed, only assessed — be honest about this:** "verify on
macOS/Linux" cannot be done from this session (this machine is Windows).
What was checked instead: `cross-spawn` is already used everywhere a
shell/`.cmd` distinction would matter (Step 1 lesson), and no code path
was found using Windows-only APIs or path syntax outside `node:path`'s
`join`. That is a static-review confidence level, not a live cross-OS
proof — don't upgrade this to "verified" until someone actually runs it on
a Mac or Linux box.

## How to sanity-check anything in this repo yourself

```bash
npm test                      # 39 unit/integration tests, ~5s
npm run route:eval            # live eval against docs/router-eval-set.jsonl
npm run route:compare         # keyword vs hybrid engine side by side
npm run route -- --prompt "..."           # try any prompt against the live config
node scripts/install-push-hook.mjs status # what's actually installed right now
```

If a doc's claimed result and a fresh run disagree, trust the fresh run —
docs decay, live checks don't.
