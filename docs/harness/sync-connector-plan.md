# Plan — Sync-Connector Refocus (Phase S0–S4)

> Status: **DONE — phases S0–S4 shipped 2026-07-10** (per-phase logs
> `docs/archive/phaseS0-verify.md` … `phaseS4-verify.md`; `HANDOFF.md` holds
> the living summary). Successor execution phase after the router phases
> (the router's Phase 0–4, done — now in the portawhip-router repo under
> docs/archive/); anchor is VISION.md §1. This plan closed
> the gap between that vision and the former install/push-only reality.
> **Superseded on the mechanism:** this plan's canonical store + fan-out used
> `.agents/` + `@agents-dev/cli`; the later writer-consolidation refactor
> (`docs/writer-consolidation-plan.md`, locked 2026-07-13) replaced that with
> **rulesync as the sole fan-out writer** (canonical `.rulesync/`) and retired
> `@agents-dev`. The *direction* (import → canonical → fan-out, no new
> reconciler) still holds; only the backing writer changed. Module paths cited
> below predate the 2026-07-11 refactor (`core/*`, `scripts/*` → subfolders) —
> trust a fresh `ls`.

## Problem statement

The original vision: **read dot-AI config from anywhere (.claude / .codex /
.gemini / .cursor / plugins), and sync every surface — tools, skills,
commands, agents, hooks (including hooks embedded inside skills/plugins/MCP
packages) — so they are usable across all hosts.**

Current reality (audited 2026-07-10):

| surface | read (import) | write (sync out) | gap |
|---|---|---|---|
| MCP servers | `discoverMcp` (router index only) | load.mjs/add-mcp + agents-dotdir | import not wired to sync |
| CLI tools | `discoverCli` (router index only) | load.mjs/mise | import not wired to sync |
| skills | `discoverSkills` (router index only) | asm via load/sync-surfaces | import not wired to sync; bulk apply gated |
| commands (slash) | `discoverCommands` — **plugin roots only** | **none** (ai-config-sync has no commands area) | whole write lane missing |
| agents (subagent defs) | `discoverAgents` — **plugin roots only** | ai-config-sync (claude↔codex only) | host-native dirs unread; >2-host write missing |
| hooks (declared) | hooks.manifest.yaml (curated) | link-hooks (3 native hosts) | OK, honest unsupported elsewhere |
| hooks (embedded in skills/plugins) | **none** | **none** | invisible entirely |
| instructions | ai-config-sync (claude↔codex) | ai-config-sync + link-connectors | hosts beyond claude/codex partial |

Direction gap: everything flows recipe.yaml → hosts. `core/discover.mjs`
already reads installed state from every host, but its output feeds only the
router index, never sync. "Found in one host → usable in all hosts" has no
path today.

## Design decision: bidirectional = import → canonical → fan-out

No new reconciler (VISION §2: delegate, don't rebuild). Bidirectional sync is
composed from two existing halves plus one new one:

- **Import (new):** read installed state per host → write to canonical store.
- **Canonical store (exists):** project `.agents/` dir (fan-out via
  `@agents-dev/cli`, already a sync-config backend) + `recipes/*.yaml`
  fragments for surfaces `.agents/` doesn't model.
- **Fan-out (exists):** sync-surfaces lanes (agents-dotdir, asm, mise,
  add-mcp), link-hooks, link-connectors, ai-config-sync.

All apply paths stay preview-gated (`status` → `preview` → `--apply`),
matching sync-config.mjs's existing safety model. No daemon; `watch` stays
opt-in polling as today.

## Phase S0 — Surface matrix as data + honest coverage report

Goal: make the gap measurable before closing it (VISION §2: live-probe,
never overclaim).

- `core/surface-matrix.mjs` + `surface-matrix.yaml`: pure data. Rows =
  7 surfaces above; columns = direction (read/write) × scope
  (project/global); cell = owning backend id or `unsupported`/`missing`.
  Host axis stays dynamic — resolved at runtime from `detectHosts()`, never
  a hardcoded host list. Per-host surface *paths* (e.g. `~/.claude/commands`)
  are data in the same catalog style as `core/connector-targets.mjs`.
- `scripts/doctor.mjs` + `surface-inventory.mjs` gain a matrix section:
  each cell live-probed (backend present? path exists? count found?), not
  asserted.
- TUI summary shows `missing` cells as attention items.

Verify (docs/phaseS0-verify.md): doctor output on this machine shows the
matrix with real counts; every `missing` cell in the table above appears;
no cell claims support without a passing probe.

## Phase S1 — Import direction (hosts → canonical)

Goal: the heart of the original vision — read what exists anywhere, make it
shareable.

- `scripts/import-surfaces.mjs` (`status|preview|apply`, same gate pattern
  as sync-config): consumes `discoverAll()` output, diffs against the
  registry's curated entries + `.agents/` content, and proposes additions:
  - MCP servers → `.agents/agents.json` mcp block (agents-dotdir fans out).
  - Skills → `.agents/skills/` (or asm install set) — item-selector only,
    honoring the existing "no bulk skills apply" block.
  - CLI tools → `recipes/imported.yaml` route entries (mise lane).
- Dedup via existing `mergeRawEntries`/first-seen-wins logic — no new merge
  rules. Curated entries always win (existing registry invariant).
- Provenance recorded per imported entry (`origin: import:<host>`), so a
  later `forget`/remove is possible and doctor can report where things came
  from.
- Explicitly *not* auto-apply: import proposes, user applies. Silence valid —
  nothing new found → empty preview, exit 0.

Verify: on this machine, `import-surfaces preview` finds a known
host-installed-but-uncurated capability (there are hundreds); apply of one
selected item lands it in `.agents/`/recipe; `sync-surfaces sync` then
installs it to a second host; re-run preview is empty for that item
(idempotent).

### S1 direction change (locked 2026-07-10)

Decided with the owner, supersedes the manual-approval framing above:

- **Auto fan-out all surfaces**, not manual per-item approval. Rationale the
  owner is right on: a large canonical index does NOT cost context — route()
  gates what gets injected, so index size is free. The real cost of fanning
  out is (a) actual install time/failures per host and (b) router precision
  dilution from bare, only-match-their-own-name entries.
- **The gate becomes a quality bar, not a human click: enrich, then
  fan-out.** A discovered capability is auto-promoted into canonical +
  fanned to all hosts *once it has usable triggers* (real natural-language
  match surface). Anything that cannot be enriched at all is held back —
  that's the anti-junk gate, replacing manual approval.
- **Auto-enrich on import.** `promote` = turn a bare `auto:*` entry (matches
  only its literal name) into an enriched entry (matches natural phrasing).
  Import runs the enrichment ladder inline so imported entries are useful,
  not dead weight.
- **Display:** preview/status group candidates BY surface with real counts;
  nothing is hidden. Small groups (cli/mcp) list every id; large groups
  (skill/command/agent) show count + a sample + how to list/import fully.
  The old `DEFAULT_TYPES = [cli, mcp]` type-suppression is dropped.
- **Build order consequence:** S1b enrichment ships BEFORE auto fan-out,
  because fan-out depends on enrichment being the gate.

### S1b — CLI dependency edges + frictionless CLI everywhere (proposed 2026-07-10)

Premise: a CLI binary is **machine-scoped, not host-scoped** — once it
resolves on PATH, every AI host on the machine shares it automatically. So
the problem is not "sync CLI between hosts"; it is four narrower failures:
(1) a skill silently depends on a binary nobody tracked, (2) the binary
doesn't resolve from the non-interactive shell hosts actually spawn,
(3) a new machine starts empty, (4) keeping installs current is manual.

Four pieces, all reusing existing machinery:

1. **`requires:` edges (data).** Recipe/`.agents` entries gain
   `requires: ["cli:rtk"]`. Sources in priority order: curated field;
   import-time inference from SKILL.md text (install commands / binary
   names — conservative, **propose-only into preview, never auto-applied**).
   Stored as a dependency edge type in the existing capability graph.
   Import (S1) bundles a skill's missing CLI deps into the same preview,
   so one approval lands skill + deps together.
   **No hardcoded skill→CLI table and no inference decision-rule in code:**
   the edge is data read from what the skill itself declares (SKILL.md
   install lines / binary names), surfaced as a preview proposal the user
   approves — not a mapping we author or a rule that auto-decides. If a
   scan of this machine finds zero skills carrying a recognizable install
   line, the inference lane is not built at all (proven-gap even inside
   S1b — start from curated `requires:` only).
2. **Binary ready-probe.** Today `readyMarker` is file-existence only
   (adapters/hooks/universal-hook.mjs). Add a probe kind for `requires`:
   resolve the binary from a non-interactive shell (`where`/`which` first,
   `mise ls` second) — a scoop/npm-g/cargo install counts as satisfied
   (detection, not forced re-install via mise). Route/push results for a
   capability with unmet deps carry the exact fix command as `readyHint`
   instead of routing silently to a dead skill.
3. **One-command heal: `doctor --fix-cli`.** Doctor lists unmet CLI deps
   (probe, not assert); `--fix-cli` installs all of them via mise in one
   gated pass. User cost: one command, not one install per tool.
4. **Auto-sync without a daemon.** (a) existing `surface:watch` already
   re-runs the CLI lane on recipe/`.agents` change; (b) session-start
   check in universal-hook compares registry-declared deps vs a cached
   probe result and prints a one-line hint ("run `npm run doctor -- --fix-cli`")
   on drift — hint only, never auto-install inside a session (slow +
   surprising); (c) new machine = `npm run load` as today, complete because
   imported entries live in the repo.

5. **CLI enrichment ladder (no-LLM).** A CLI binary has no `tools/list`, so
   auto:cli entries stay bare-name and dead on natural queries. Full
   research in docs/cli-enrichment-research.md. Deterministic extraction,
   embeddings only for matching:
   - **identity:** `mise registry` maps short name → `backend:package`
     (verified 968 entries; resolves the ecosystem-hint gap that forced
     enrich.mjs to drop npm-view — `rust` now visibly `core:` not `npm:`).
   - **describe (ladder, all sources author/maintainer-written):**
     package-registry JSON (npm/PyPI/crates.io/GitHub, description+keywords,
     one cached fetch) → tldr-pages archive (offline `tldr.zip`, one-liner +
     natural-language example lines) → existing `--help` first line +
     subcommand harvest → existing `pip show`.
   - **triggers:** name + subcommands + registry keywords + tldr example
     lines. **matching:** existing dense-embedder.mjs embeds the harvested
     text (embedding = match layer, not extraction — stays deterministic).
   - **residue:** `LLM(name)` opt-in flag only, cached, expected near-zero
     (every binary answers `--help`; custom tools rtk/icm enrich from
     `--help` + subcommand harvest with no registry presence).
   - Per-field provenance (`source: tldr|npm|help|…`) so a wrong
     description is traceable and evictable (the npm-view lesson).
   This runs at enrich time (`router-cli enrich`), never inside route() —
   same rule enrich.mjs already enforces.

Out of scope here (proven-gap deferred): per-tool version pins /
`mise.toml` sync, per-CLI dotfile config sync. Fig specs / carapace
completion data (Fig repo archived 2025-03, carapace format Go-embedded —
tier-2, revisit only if Findings 1–3 leave a proven gap).

Verify: a skill with a declared dep imports as skill+CLI in one preview;
`doctor` flags a deliberately-missing binary and `--fix-cli` resolves it;
route() on a dep-missing capability shows the fix hint; probe passes for a
binary installed via scoop (non-mise) without reinstalling.

## Phase S2 — Commands + agents lanes

Goal: close the two fully-missing surfaces.

- **Read:** extend `discoverCommands`/`discoverAgents` roots beyond plugin
  cache to host-native dirs from the S0 path catalog (`~/.claude/commands`,
  `~/.claude/agents`, project `.claude/{commands,agents}`, `~/.codex/prompts`,
  gemini/cursor equivalents — each path verified against host docs at build
  time and recorded in the catalog with a source link, same style as
  docs/connector-research.md).
- **Write:** delegate first (VISION §2). Check per backend what actually
  ships: ai-config-sync claims agents for claude↔codex; agents-dotdir may
  model neither. Where no backend supports a cell, use the link-hooks
  pattern: managed copy with manifest + `link-* status/install/remove`,
  rendered per host dir — or mark the cell `unsupported` honestly. No
  format translation beyond frontmatter passthrough in v1 of this lane;
  host-incompatible definitions are reported, not silently mangled.
- Imported commands/agents also flow into S1's import path (they're just
  two more surfaces once the lanes exist).

Verify: a command + an agent defined once in `.agents/` (or canonical dir)
appear and are invocable in ≥2 hosts on this machine; unsupported hosts
show `unsupported`, not a broken copy; router index picks both up via
existing discovery.

## Phase S3 — Embedded-hooks extraction

Goal: hooks buried inside skills/plugins/MCP packages become visible and
linkable.

- Scanner (`core/discover.mjs` extension): walk plugin cache + skill dirs
  for hook declarations (`hooks/hooks.json`, plugin manifest hook blocks,
  settings-fragment files shipped inside packages). Inventory only in the
  first pass — id, source package, target lifecycle event, command body.
- Surface in S0 matrix + doctor: "N embedded hooks found, M linked, K
  unsupported-host".
- Linking: map each embedded hook's event through the existing
  `hooks.manifest.yaml` logical-event model and `universal-hook.mjs`
  adapter — reuse, don't add a second hook runner. Hosts without native
  hook APIs stay `unsupported` per docs/hook-sync-research.md.
- Trust boundary: embedded hooks execute third-party commands; apply
  requires per-item selection (like skills), never bulk, and preview shows
  the exact command body.

Verify: scanner finds ≥1 real embedded hook on this machine (ECC plugins
ship them); linking one makes it fire in a second host's native lifecycle;
unlinking removes it cleanly; nothing auto-applies.

## Phase S4 — Host-coverage widening (proven-gap only)

Goal: extend beyond claude↔codex where a real gap is observed, not assumed.

- Use S0 matrix after S1–S3 land: every remaining `missing`/`unsupported`
  cell gets either (a) an upstream backend that covers it, evidence-checked
  like VISION §4, (b) a thin managed-copy lane, or (c) a recorded
  won't-do with reason.
- Candidate order from current matrix: gemini-cli (has hooks + GEMINI.md
  already linked), cursor (rules + AGENTS.md, mcp-only hooks), copilot/
  vscode (instructions only).
- No work in this phase without a dogfooded miss (VISION §2: proven-gap
  before adding scope).

Verify: matrix has zero unexplained cells — every cell is supported,
delegated, or documented won't-do.

## Cross-cutting rules

- Every phase adds its tests to the `npm test` list and a
  `docs/phaseS<N>-verify.md` with observed (not asserted) results.
- No new decision logic in data files; no daemon; abstain/empty output is a
  valid result everywhere.
- Router work is frozen during S0–S2 except bug fixes — trust-loop data
  needs 1–2 weeks of clean signal anyway (memory: router-trust-loop-hygiene).
- VISION.md §6
  gains a "Phase S" entry per completed phase.
