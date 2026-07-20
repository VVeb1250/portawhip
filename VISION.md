# Vision — portable-harness-v2

> This is the "why" and "destination" doc — it changes only when direction
> changes. `HANDOFF.md` owns the living current state. The execution roadmaps
> (`docs/harness/sync-connector-plan.md` for surface sync,
> `docs/harness/writer-consolidation-plan.md` for the single-writer refactor)
> are complete; read them for the reasoning, not the current status. If they
> ever conflict, re-derive the roadmaps from this file — this one is the anchor.

## 0. Where this came from

Predecessor: `E:\portable-harness` ("paw"). Self-diagnosed broken
(`docs/STATUS.md` in that repo) before this project started:

- **router.py (set-routing): 0/10** in its own dogfood test — could not be
  fixed, no external library solves it either (researched, confirmed).
- **ICM memory: SQLite corruption**, no WAL/backup/repair — data loss.
- **`sets.json`: 3,618 lines hardcoded registry**, 40 Python modules
  (`team_kernel.py`, `mutation.py`, `verification.py`, `memory_mesh.py`,
  `decision_mirror.py`, `voice.py`, ...) — scope grew far past what was ever
  proven useful daily.
- **Health checks overclaimed**: doctor said tools were "healthy" when not
  even installed (`lychee`/`hurl`).
- **The old `skill-router.py` hook is still installed and running live** on
  this machine (`.claude/hooks/skill-router.py`, `.codex/hooks/skill-router.py`)
  — and it misfired constantly *during this very project's own planning
  conversation* (suggested `finance-billing-ops`, `homelab-pihole-dns`,
  `unified-notifications-ops` while discussing harness architecture — zero
  relevant hits). This is not a hypothetical failure mode; it was observed
  directly, live, as evidence.

Owner's read on why v1 failed (verbatim intent): "ไม่เห็นผล ซับซ้อนแบบ
hardcode และ scope กว้างเกิน ที่ทำมาก็พัง แถมรู้สึกว่ามีคนทำแล้วอีก" — no
visible results, hardcoded complexity, scope too broad, it broke, and it
duplicates things that already exist elsewhere.

## 1. One-sentence destination

**A thin, dynamic control-plane that collects the capabilities a user's AI
agents already have, across whatever hosts and OS they actually run — importing
what is installed in any one host and fanning it out to all of them (MCP, CLI,
skills, commands, agents, instructions, hooks), by delegating to the best
existing tool per surface.**

That is one job, not two. **Collect once, plug in anywhere.** Declare a
capability once in `recipe.yaml`/`.rulesync/` and fan it out, *and* import what
is already installed in any detected host → a canonical store → back out to
every other host, across seven surfaces (instructions, MCP, skills, commands,
agents, native hooks; embedded hooks inventory-only — a trust boundary). No
install/sync engine of our own; delegated to add-mcp / mise / asm / **rulesync**
(the sole fan-out writer, both project and global scope).

### What is not in this repo, and why

Deciding *which* capability to surface for a given task — retrieval, ranking,
abstain — was the second half of this project until 2026-07-21. It now ships
separately as **`portawhip-router`**.

The split was not a change of ambition; it was an admission about maturity. The
collection half works and is worth installing. The routing half is live research
whose own held-out eval puts top-1 at 27.5%, and it drags a 500MB embedding
model behind it. Keeping the two in one package meant every user paid for the
unfinished half, and every measurement of the finished half was entangled with
it.

What replaced it is a **provider seam**: an optional package can contribute
config keys, an instruction connector, hook behaviour, and its own recipe
entries, all resolved at runtime. portawhip never imports a provider, and a
provider that is not installed is an absence rather than an error. The router is
the first consumer of that seam; it should not be the last.

This is the "delegate, don't rebuild" principle applied to ourselves: if a
capability is not ours to own, it should not be in our package.

## 2. Non-negotiable principles (the anti-repeat-v1 rules)

- **Delegate, don't rebuild.** Every capability type gets mapped to an
  existing, actively-maintained tool before we write a line of install/route
  logic ourselves. We only own the thin glue between them.
- **Hardcoding data is fine; hardcoding decision logic is not.** A recipe
  list (which bundle has which tools) is data — allowed. A router that
  decides set-routing by static if/else rules — not allowed (that's what
  killed v1's `router.py`).
- **Live-probe, never overclaim.** Health/doctor checks must actually run
  the thing and observe the result, not assert a cached/static status.
  (v1's `lychee`/`hurl` overclaim bug is the cautionary tale.)
- **No daemon unless a proven gap demands it.** CLI/library-first. A
  background service is the last resort, not the default (this is why
  Phase 0 picked "pointer-only" over embedding the Docker-based `metamcp`
  gateway — see §5).
- **Proven-gap before adding scope.** Don't add a capability, a wrapper, or
  a phase because it seems useful — add it because a specific, observed gap
  demands it. (v1's team-kernel/mutation/verification grew this way and
  were never dogfooded into daily use.)
- **Cross-host, cross-OS by detection, not by list.** Never hardcode "these
  are our 2 supported hosts." Ask the actual backend tool what it detects
  on this machine, every run.
- **Silence is a valid, expected output.** A router/suggester that has
  nothing confident to say must say nothing — not a low-confidence guess.
  (Directly answers the noisy-hook failure mode observed live in-session.)

## 3. Ownership map (who owns what)

Mapped against the general "harness = 7 components" framing (agent loop,
tool interface, guides, sensors/verification, memory/context, permissions,
orchestration):

| component | owner | why |
|---|---|---|
| Agent loop | the host itself (Claude Code / Codex / Gemini / ...) | not ours to build |
| Cross-host fan-out — instructions / rules / commands / subagents / MCP config, both scopes | **rulesync** (`dyoshikawa/rulesync`), sole writer | one writer per target file is non-negotiable (overlapping total-ownership writers oscillate — proven, §5 #19); rulesync is the only candidate that does both project **and** global scope, all surface features, idempotent, and stays surgical on shared config (`~/.claude.json` keeps `projects`/`userID`). Canonical source = `.rulesync/`; every host file is generated output |
| Tool interface — MCP (read side) | **add-mcp** (`neon-solutions/add-mcp`) | its write role is retired (rulesync owns fan-out), but it stays for **discovery/import**: `listInstalledServers()` unions MCP servers across all detected hosts, which `rulesync import` can't do. `detectGlobalAgents()` also gives live host detection with zero hardcoding |
| Tool interface — non-MCP CLI | **mise** (`jdx/mise`) | cross-OS dev-tool version manager, single Rust binary, legit organic adoption (30k⭐ over 3.5y, not inflated); no host-config overlap, so kept as-is |
| Guides / skill content | **asm** (`agent-skill-manager`) for long-tail skill hosts; **ECC** for content (detect-only, not owned) | rulesync's `--targets` covers most skill hosts; asm fills the long tail it doesn't. ECC ships real, honestly-tiered cross-host skill content already |
| Config migration / import | **ai-config-sync-manager** | migration/import only, never a steady-state writer (that role went to rulesync) |
| Native hooks key | **`scripts/link/link-hooks.mjs`** (ours) | rulesync's `hooks` feature is non-functional for claudecode (live-tested); link-hooks is a surgical writer on that one disjoint region of a file rulesync otherwise owns — the coexistence rule (surgical writers may share; total-ownership writers may not) |
| Host detection | **add-mcp** primary + `core/surface/extra-hosts.mjs` supplement | add-mcp catalogues mainstream hosts; a presence-checked probe covers newer ones it hasn't (Pi, Amp). Still detection, never a hardcoded support list |
| Memory | **ICM** | researched 11 alternatives (mem0, agentmemory, Letta, Zep, Graphiti, Cognee, txtai, Memori, SQLite-Memory, memoirs) — none beat it on the actual constraint set (no-daemon + CLI + local + cross-host + cheap adapter) simultaneously; the real defect (SQLite durability) was already fixed upstream |
| Suggestion timing (what to route, when) | **`portawhip-router`** — a separate package since 2026-07-21, plugged in through the provider seam | still the one genuinely-unsolved piece, and still nobody else fills it well; extracted so its unfinished state stops being everyone's problem (§1) |
| Permissions / guardrails | host-native hooks + existing security CLIs (nah/gitleaks/osv-scanner, inherited from v1's registry) | not re-litigated in this project yet |
| Orchestration (multi-agent team) | **deprioritized**, not rebuilt | v1's `team_kernel.py`/`mutation.py` had passing tests but zero daily-use proof; out of scope until the loader+router prove themselves first |

## 4. External stack, with the evidence that earned each pick

Every one of these was chosen after checking real GitHub metadata (age,
push recency, star trajectory sanity — not just star count, since inflated
repos exist: ECC's own 224k★/34k forks in 5.5 months was flagged as
statistically implausible and NOT used as a quality signal for its own
routing claims) and, where possible, actually running the tool:

- **add-mcp** — ⭐242, TS, verified live: installed a real MCP server
  (context7) into `~/.claude.json` and `~/.codex/config.toml` in Step 1.
- **mise** — ⭐30,321, Rust, created 2023 (organic ~24★/day over 3.5y),
  verified live: installed ripgrep cross-platform via scoop-provided binary.
- **asm** — ⭐687, TS, pushed same day as evaluation (most active of 3 skill
  candidates), verified live: installed the `pdf` skill from
  `anthropics/skills` into both Claude Code and Codex skill dirs, and it
  showed up as an available skill in this session immediately after.
- **ICM** — existing, already fixed upstream (WAL+backup+`icm repair`,
  landed 2026-07-01 in the predecessor repo).
- **ECC** — already installed on this machine; used for skill *content*
  only, detect-first, not owned or rebuilt.
- **rulesync** (`dyoshikawa/rulesync`) — the sole cross-host fan-out writer,
  added in the writer-consolidation refactor. Won a live 3-way head-to-head
  (2026-07-13, `docs/harness/writer-consolidation-plan.md`) against `@agents-dev/cli`
  and `ai-config-sync-manager`: does both scopes (the others were
  project-only), broader features, idempotent, surgical on shared config.
  Targets are a scoped 12-host list (`rulesync.jsonc`), never `*` — an
  unscoped run writes ~35 files for tools you don't even have. v9.6.3 was
  active 2 days before the test (single maintainer — a watched risk).
- **Supplementary host detection** — `core/surface/extra-hosts.mjs`
  presence-probes hosts add-mcp hasn't catalogued yet (Pi, Amp), each entry
  citing its doc source. The live host set is an 11-row matrix
  (`docs/host-support.md`); every unsupported cell carries a concrete reason.
- **Retired: `@agents-dev/cli`** — was the original pick for the `.agents/`
  fan-out, but it is project-only (can't do global), its MCP ingestion was
  fiddly, and it injects default servers on init. rulesync dominated it on
  every tested axis, so it was dropped as a writer (see §5 #19).
- Rejected: agent-connector (wrong side of the MCP relationship — built for
  authoring/distributing your own server, not consuming third-party ones),
  openskills (10.5k⭐ but 5.5 months silent — maintenance risk), 4 of 5
  Phase-0 gateway candidates (dead 11-13 months), `metamcp` (only
  actively-maintained gateway, but Docker-first web app, not an embeddable
  library — rejected for Phase 0, see docs/archive/phase0-audit.md).

## 5. Decisions made and why (chronological, so the reasoning survives)

1. **Kill `router.py` (set-routing).** 0/10 in v1's own dogfood; researched
   and confirmed no external router library solves this class of problem
   either. Not attempted again in v2.
2. **`skill_router.py` hook: kill the always-on PUSH form, keep the idea as
   on-demand PULL.** Directly observed misfiring live in this project's own
   planning conversation. The underlying idea (suggest without injecting
   full content) is sound and became the spec for the router — the fix is
   *timing/mode*, not the concept. Push is now silent by default (WS-A), and
   the router itself lives in `portawhip-router`.
3. **Language: Node/TS for the loader, not Python (v1's language).** 4 of 5
   delegated tools are npm packages; gluing in the same runtime avoids
   cross-runtime subprocess overhead. (The router was left language-agnostic
   beyond "must interop" — which is part of why it could be extracted cleanly.)
4. **`cross-spawn` over hand-rolled `shell:true`/`.cmd` detection.** Hit a
   real Windows `EINVAL` bug spawning `.cmd` files directly, and a real
   command-injection lint (unescaped args through `shell:true`) — fixed with
   the standard library for this exact problem instead of a bespoke hack.
5. **No hardcoded host list anywhere in the loader.** `hosts.mjs` asks
   add-mcp's `detectGlobalAgents()` and asm's `config show` for the live
   truth every run. The only static table is an 11-entry id-translation map
   between the two tools' naming (`claude-code` ↔ `claude`) — necessary glue
   data, not decision logic.
6. **Self-healing retry over a hardcoded capability matrix.** When add-mcp
   rejected a batch install because Claude Desktop doesn't support remote/
   http transport, the fix reads *add-mcp's own error text* to narrow the
   retry — not a matrix we maintain ourselves.
7. **Phase 0 gateway decision: B (pointer-only), not A (embed metamcp).**
   No candidate was embeddable + maintained + Windows-clean simultaneously;
   the token-bloat problem A would solve is already handled natively by
   Claude Code's own tool deferral (observed working throughout this
   project), and duplicating that for other hosts is an unproven-gap bet
   until Codex/Gemini's own behavior is checked.
8. **Threshold/k moved out of scorer.mjs into `router.config.yaml`.** First
   Phase 1 draft hardcoded `threshold=1, k=5` as JS defaults — caught on
   review ("hard code มั้ยเนี่ย"). The spec required these live in a recipe
   header or a config file, not code. Fixed: config is read from
   `router.config.yaml` (optional, same fallback values) and `scorer.mjs`
   takes threshold/k as required call args with no built-in default. Those
   keys now reach the config system as a schema fragment the router provider
   contributes, so they exist only when the router is installed.
9. **Registry auto-discovers installed capabilities, not just recipe.yaml's
   3 curated entries.** Same review flagged that recipe.yaml itself was a
   hand-typed list — "ไม่ว่าโหลดจากไหนก็ลิงค์กัน" (link whatever's loaded,
   regardless of source). `core/discover.mjs` now pulls live state from the
   same backends Step 1 already uses (`add-mcp.listInstalledServers()`,
   `asm list --json`, `mise ls --json`) and merges it into the index;
   curated entries win on id collision. Keyword triggers for auto entries
   are inferred from each skill's own description text (a stopword-filtered
   frequency extraction, `core/discover.mjs`'s `extractKeywords`).
   Consequence, caught by testing against the real machine (371 installed
   skills): threshold=1 let a single generic shared word ("write", common
   across many skill descriptions) fire on "write a poem about the ocean" —
   the exact noise failure this project exists to avoid. Fix: two
   thresholds, not one — `recipeThreshold=1` for curated/deliberate
   triggers, `threshold=2` for auto-inferred ones (`router.config.yaml`).
   Also fixed a real dedup bug: the same skill installed identically across
   multiple hosts (e.g. `pdf` in Claude Code + Codex + Cursor) was appearing
   as 3 separate entries — now first-seen-wins per id, matching the pattern
   already used for MCP server discovery.
10. **Claude Code never called `route()` in Phase 2's live test (0/8);
    Codex did (8/8).** Root cause, confirmed live in-session: Claude Code
    defers MCP tool schemas behind `ToolSearch` until looked up by name;
    the CLAUDE.md instruction never told the model to do that lookup first,
    so the tool sat undiscovered. Codex has no such deferral, so the same
    plain instruction worked there unmodified. Fix: `adapters/instructions/
    generate.mjs` now has a Claude-Code-specific block that names the
    `ToolSearch` step explicitly; AGENTS.md keeps the plain wording (already
    proven 8/8). Still needs a fresh-session live re-check — can't be proven
    from within a running session.
11. **User explicitly commissioned Phase 2.5 (hybrid retrieval)**, wanting a
    precise router with visible results after v1's high-noise failure — not
    scope creep, a deliberate ask. But the delivered version had 3 real
    bugs, found by audit: (a) never wired into the actually-deployed
    the router's MCP server (still called plain `scorer.mjs`) — fixed via
    one shared `core/route-entry.mjs` used by both the CLI and the server;
    (b) live eval re-run showed 2 false positives on the exact
    old-hook-regression prompts the eval set exists to catch, and no
    threshold value could fix it (false positives scored *higher* than the
    weakest true positive) — fixed by improving the scoring itself
    (shared stopwords + idf-scaled single-word trigger credit in
    `core/sparse-retriever.mjs`), not by picking a bigger magic number; (c)
    `graphPath` had the same cwd-relative bug already fixed once for
    recipe.yaml — fixed the same way. See `docs/archive/phase2.5-verify.md`'s
    "Correction" section for the full audit trail.
12. **Dense semantic retrieval added as a second, additive channel
    (2026-07-06).** Tuning the lexical channel alone hit a proven wall (a real
    paraphrase miss scored *below* a false positive it was tensioned against —
    no single threshold fixes both). the router's `dense-embedder.mjs` runs
    BAAI/bge-m3 via `@huggingface/transformers` (MIT, 100+ languages incl.
    Thai, self-downloading, zero setup), fused through the same lane/peakedness
    gate. On by default for MCP server + CLI; the push hook opts out (a fresh
    subprocess per prompt can't amortize a 500MB+ model load).
13. **Push and pull are different products — asymmetric by design
    (2026-07-09).** A feedback-log audit found the hit rate was *unmeasurable*,
    not just bad: 21/26 "suggestions" fired on `<task-notification>` synthetic
    blobs, and `resolveId` had no branch for the Skill/Agent tools. Lesson
    banked: **fix measurement before tuning.** Push (unsolicited interruption)
    now has a hard precision gate + a full→terse→silent per-session repeat
    budget; pull (solicited `route()`) keeps generous recall and unused results
    earn **no decay** (boost-only). See the router repo's `docs/router-intelligence.md`.
14. **Second vision-half activated: bidirectional surface sync (S0–S4,
    2026-07-10).** Until now everything flowed `recipe.yaml → hosts`
    (install/push only). Built as import → canonical → fan-out with **no new
    reconciler**. Surface coverage widened from 3 capability types to 7. (The
    first cut used `.agents/` + `@agents-dev/cli` as the canonical fan-out;
    both were later superseded by rulesync — see #19.) See
    `docs/harness/sync-connector-plan.md`.
15. **Host widening by presence-probe, not by list (2026-07-10).**
    `core/surface/extra-hosts.mjs` adds Pi and Amp as evidence-cited data
    behind a presence gate, kept in a separate `extraHosts` bucket. Inert until
    such a host is installed (neither is here — documented-but-dogfood-pending,
    honest per the live-probe rule). Full matrix: `docs/host-support.md`.
16. **Push/pull mode differentiation above the engines (WS-A, 2026-07-11).**
    A raw prompt carries no reasoned intent, so **push is silent by default**
    (`PORTAWHIP_PUSH_MODE=legacy` is the rollback). Pull contracts ask the
    agent for only the *positively requested action + direct object* —
    excluding background, merely-mentioned, rejected, negated candidates (the
    wording now in the managed instruction blocks). Engines unchanged
    (invariance-tested). See `docs/archive/ws-a-mode-differentiation-verify.md`.
17. **Stateful situation/policy engine: evidence gate → NO-GO, deferred
    (WS-B, 2026-07-11).** Routing differently based on what was already used /
    blockers / readiness was gated against the feedback log and *rejected*:
    too few `used` events, zero observed counterfactuals — it would encode
    imagined behavior, not a proven gap. Proven-gap-before-scope doing its job.
    Revisit gate recorded: `docs/archive/ws-b-evidence-gate.md`.
18. **Structural refactor into concern subfolders (2026-07-11).** `core/` →
    `router/ registry/ surface/ state/`; `scripts/` → `link/ sync/` + root
    hubs. No behavior change. Any path cited in earlier items of this section
    or in `docs/archive/` predates this move. It was also what made the
    2026-07-21 extraction (#20) mechanical rather than surgical: by then the
    router was already one directory.
19. **Writer consolidation — one writer per target file (LOCKED 2026-07-13,
    the biggest recent decision).** The real architectural disease was **many
    backends writing the same host files → drift.** Proven live: on one shared
    Codex MCP target, `ai-config-sync`'s marker block and `@agents-dev`'s
    total-file regen fought forever (hashes never converged — a drift *war*).
    A 3-way head-to-head (`docs/harness/writer-consolidation-plan.md`) picked **Fork A:
    `rulesync` as the sole fan-out writer, both scopes.** Distilled rule: the
    disease is specifically **total-ownership writers** (regenerate whole files,
    "do not edit manually") — surgical mergers (add-mcp, marker-block, rulesync
    on shared config) coexist fine; never mix a total-ownership writer with any
    other on one file. Consequences: `@agents-dev/cli` retired; `ai-config-sync`
    → migration-only; `add-mcp` keeps its read/union side; `mise` kept; `asm`
    → skill long-tail; `link-hooks` keeps the hooks key (rulesync's hooks
    feature is non-functional for claudecode). Cross-scope dedup is solved by a
    **derived** scope (`core/surface/scope-derive.mjs`) — project-bound config
    forced to project, portable config scoped by where it's discovered — never
    a hand-maintained list (that would be hardcoded decision logic again).
20. **Auto fan-out live, watchdog deliberately not built (Phase 5 done
    2026-07-14).** `scripts/sync/auto-sync.mjs` (lock+throttle+log) fires
    fire-and-forget from the SessionStart hook, propagating only already-
    canonical entries (never auto-discovers — that's what an earlier design got
    wrong, pouring hundreds of entries across every host). Enabled at project
    scope; global stays manual (no auto-apply gate cleared there). Two gaps
    rulesync doesn't cover (no `plugins` feature; no embedded-hooks-in-skills
    lane) → strategy is **contribute upstream, never add a 3rd sync dep**
    (a separate writer on shared dirs = the drift disease again).

21. **Router extracted to its own package (2026-07-21).** The two halves in §1
    became one package plus a seam. Trigger: the held-out eval put router top-1
    at 27.5%, and shipping it meant every portawhip install pulled a 500MB
    embedding model for an unfinished capability. Rather than hide that, the
    router became `portawhip-router` and portawhip grew a **provider seam** —
    an optional package contributes config keys, an instruction connector, hook
    behaviour and recipe entries, all resolved at runtime, never imported.
    Two invariants keep it honest, both enforced by tests: portawhip may not
    import a provider (`core/state/provider-boundary.mjs`), and portawhip's own
    suite passes identically with and without one installed. A missing provider
    is an absence; an installed-but-broken one is loud. This is
    "delegate, don't rebuild" turned on ourselves.

## 6. Current state (2026-07-21)

The collection half is built and locally verified on this Windows machine.
**`HANDOFF.md` is the living state doc — read it for known gaps, bugs found
and fixed, and what's honestly still unverified. This is the high-altitude
summary only.** Full suite: **242/242** (`npm test`), passing both with and
without a capability provider installed.

Load + sync:

- **Step 1 loader: done, proven live.** `recipe.yaml` + `scripts/load.mjs` +
  `scripts/hosts.mjs` + `scripts/doctor.mjs`. Real MCP/CLI/skill installs,
  idempotent re-run, dynamic host detection (zero hardcoded list),
  self-healing transport-mismatch retry — all verified.
- **Sync connector (S0–S4): done.** Bidirectional surface sync across 7
  surfaces and an 11-host matrix. `npm run import` (manual, preview-gated) →
  canonical → `npm run surface:sync` fan-out. CLI entries auto-enriched on
  import (mise → package registry → tldr → `--help`, no LLM). Embedded hooks
  inventoried, never auto-linked (`npm run hooks:embedded`).
- **Writer consolidation: done, the current architecture.** **rulesync is the
  sole fan-out writer** for both project and global scope, from a canonical
  `.rulesync/`. `@agents-dev/cli` retired; `ai-config-sync` migration-only;
  `add-mcp` read/union side kept; `link-hooks` keeps the hooks key. Scope is
  derived per server (`scope-derive.mjs`), not hand-listed. Auto fan-out fires
  from SessionStart at project scope (throttled, propagates only already-
  canonical entries); global apply stays manual. See
  `docs/harness/writer-consolidation-plan.md`.

Routing — now `portawhip-router`, kept here for the history:

- **Phase 0–2 (base decision B, registry+scorer, pull-mode MCP server):
  done.** The router's MCP server exposes `route`/`list_all`, registered on
  detected hosts; instruction blocks fanned out (now via rulesync) into the
  hosts' context files, idempotent.
- **Phase 2.5 + Phase 4 item 3 (hybrid + dense retrieval): done.** Sparse
  lexical + dense bge-m3, fused through per-lane peakedness/abstain gates;
  calibrated confidence, not a single magic threshold.
- **Phase 3–4 (push + feedback loop): done.** Cross-host push/feedback via one
  `adapters/hooks/universal-hook.mjs` + `scripts/link/link-hooks.mjs`
  (claude-code, codex, gemini-cli native; others honestly `unsupported`/
  `mcp-only`). Trust-loop hygiene + push/pull asymmetry (2026-07-09);
  silent-by-default push (2026-07-11). Feedback JSONL bounded/rotated. The
  WS-B stateful-policy escalation is evidence-gated NO-GO — deferred.
- **Deliberately still open:** the "fresh session calls `route()` unprompted"
  behavioral check can't be proven from inside a running session; global
  auto-apply gate not cleared; push-precision runs on clean feedback data
  before the next tuning round (the router repo's `docs/router-intelligence.md`).

- **Explicitly not rebuilt / out of scope:** team-kernel, mutation/
  verification loop, multi-agent orchestration (existed in v1 with passing
  tests but no daily-use proof), the WS-B situation-state policy engine (gated
  off), and any 3rd sync dependency for rulesync's two gaps (plugins,
  embedded-hooks) — the plan is to contribute those upstream instead.

## 7. Destination check (how we'll know we're not lost)

If a future change doesn't map to one of these, question it before building:

- Does it reduce tokens or improve suggestion precision, measurably?
- Is it delegated to an existing, evidence-checked tool wherever possible?
- Is any new "list" pure data, with zero new decision logic bolted on?
- Was the gap actually observed (dogfooded), not just imagined?
- Does it still run without a daemon, or is the daemon a proven, not
  assumed, requirement?
