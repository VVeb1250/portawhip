# Vision — portable-harness-v2

> This is the "why" and "destination" doc. `PLAN.md` is the current
> execution phase (Smart Capability Router, Step 2+). If they ever conflict,
> re-derive PLAN.md from this file — this one is the anchor.

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

**A thin, dynamic control-plane that loads capabilities (MCP / CLI / skills)
into whatever AI agent hosts + OS the user actually has, by delegating to
the best existing tool per capability type — and separately, a router that
surfaces the *right* capability at the *right* moment instead of dumping
everything into context.**

Two halves, built in this order:

1. **Loader** (done — Step 1): "load however, use anywhere." No install
   logic of our own.
2. **Router** (in progress — PLAN.md Phase 0-4): "surface the right thing at
   the right time." No routing logic reinvented where a host already does
   it natively.

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
| Tool interface — MCP | **add-mcp** (`neon-solutions/add-mcp`) | consumer-side installer, no dependency on the target server adopting any SDK; real cross-host config writer with reversible managed blocks; `detectGlobalAgents()` gives live host detection with zero hardcoding |
| Tool interface — non-MCP CLI | **mise** (`jdx/mise`) | cross-OS dev-tool version manager, single Rust binary, legit organic adoption (30k⭐ over 3.5y, not inflated) |
| Guides / skill content + cross-host delivery | **asm** (`agent-skill-manager`) for install/sync; **ECC** for content (detect-only, not owned) | asm is the actively-maintained one of 3 skill-sync candidates (openskills has more stars but 5.5mo silent — risk); ECC ships real, honestly-tiered (Native/Adapter-backed/Instruction-backed/Reference-only) cross-host skill content already |
| Memory | **ICM** | researched 11 alternatives (mem0, agentmemory, Letta, Zep, Graphiti, Cognee, txtai, Memori, SQLite-Memory, memoirs) — none beat it on the actual constraint set (no-daemon + CLI + local + cross-host + cheap adapter) simultaneously; the real defect (SQLite durability) was already fixed upstream |
| Suggestion timing (what to route, when) | **ours to own** — this is the actual gap nobody else fills well | see PLAN.md; this is the one genuinely-unsolved piece |
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
- Rejected: agent-connector (wrong side of the MCP relationship — built for
  authoring/distributing your own server, not consuming third-party ones),
  openskills (10.5k⭐ but 5.5 months silent — maintenance risk), 4 of 5
  Phase-0 gateway candidates (dead 11-13 months), `metamcp` (only
  actively-maintained gateway, but Docker-first web app, not an embeddable
  library — rejected for Phase 0, see docs/phase0-audit.md).

## 5. Decisions made and why (chronological, so the reasoning survives)

1. **Kill `router.py` (set-routing).** 0/10 in v1's own dogfood; researched
   and confirmed no external router library solves this class of problem
   either. Not attempted again in v2.
2. **`skill_router.py` hook: kill the always-on PUSH form, keep the idea as
   on-demand PULL.** Directly observed misfiring live in this project's own
   planning conversation. The underlying idea (suggest without injecting
   full content) is sound and is now the actual spec for the Phase 0-4
   router in PLAN.md — the fix is *timing/mode*, not the concept.
3. **Language: Node/TS for the loader, not Python (v1's language).** 4 of 5
   delegated tools are npm packages; gluing in the same runtime avoids
   cross-runtime subprocess overhead. (Router core in PLAN.md is intentionally
   left language-agnostic beyond "must interop.")
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
   review ("hard code มั้ยเนี่ย"). PLAN.md's own spec required these live in
   recipe header or a config file, not code. Fixed: `core/config.mjs` reads
   `router.config.yaml` (optional, same fallback values), `scorer.mjs` now
   takes threshold/k as required call args with no built-in default.
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
    `server/mcp-server.mjs` (still called plain `scorer.mjs`) — fixed via
    one shared `core/route-entry.mjs` used by both the CLI and the server;
    (b) live eval re-run showed 2 false positives on the exact
    old-hook-regression prompts the eval set exists to catch, and no
    threshold value could fix it (false positives scored *higher* than the
    weakest true positive) — fixed by improving the scoring itself
    (shared stopwords + idf-scaled single-word trigger credit in
    `core/sparse-retriever.mjs`), not by picking a bigger magic number; (c)
    `graphPath` had the same cwd-relative bug already fixed once for
    recipe.yaml — fixed the same way. See `docs/phase2.5-verify.md`'s
    "Correction" section for the full audit trail.

## 6. Current state (2026-07-04)

**Cross-host coverage: mostly closed, see `HANDOFF.md`'s table for the
current per-host matrix.** Codex built `adapters/hooks/universal-hook.mjs`
+ `scripts/link-hooks.mjs`/`link-connectors.mjs`, extending native push/
feedback hooks to claude-code, codex, and gemini-cli, with cursor/
copilot-cli/vscode/claude-desktop honestly reported as `unsupported`/
`mcp-only` (no confirmed native hook API). A duplicate-hook-firing bug
from two parallel implementations (mine, project-scoped Codex's) was found
and fixed same day — consolidated onto `universal-hook.mjs` at global
scope. `HANDOFF.md` has the exact commands used; don't rebuild any of
this without checking that table first.

- **Step 1 — Loader: done, proven live.** `recipe.yaml` + `scripts/load.mjs`
  + `scripts/hosts.mjs` + `scripts/doctor.mjs`. 3/3 real installs verified
  (MCP, CLI, skill), idempotent re-run verified, dynamic host detection
  verified (7 MCP hosts, 5 skill hosts found on this machine with zero
  hardcoded list), self-healing transport-mismatch retry verified.
- **Phase 0 — Router base decision: done.** Option B chosen and recorded
  (`docs/phase0-audit.md`).
- **Phase 1 — Registry + scorer core: done, proven.** `core/registry.mjs`
  (parses `recipe.yaml`'s `route:` blocks, fails loud on malformed ones,
  merges in `core/discover.mjs`'s live auto-discovery, caches normalized
  index at `.hp-state/route-index.json`), `core/scorer.mjs` (layer-1
  keyword/trigger match, per-origin abstain threshold), `core/config.mjs`
  + `router.config.yaml` (tunable, not hardcoded), `core/router-cli.mjs`
  (`route --prompt`, `list --type`). 9/9 unit tests green (7 curated-only +
  2 discovery-merge); manual check against this machine's real installed
  base (371 skills via asm, live MCP servers via add-mcp, CLI tools via
  mise): curated triggers fire correctly, real unrelated prompts abstain,
  no cross-host duplicate entries.
- **Phase 2 — Pull-mode MCP server: done, mostly proven** (see
  `docs/phase2-verify.md`). `server/mcp-server.mjs` exposes `route`/
  `list_all`; registered globally on 7 detected hosts via the recipe.yaml/
  loader path (dogfooded); `adapters/instructions/generate.mjs` installed
  an idempotent one-liner into the user's real `~/.claude/CLAUDE.md` and
  `~/.codex/AGENTS.md` (backed up first). Only the literal "fresh session
  calls route() unprompted" behavioral check is still open — needs
  observing in a real new session, not provable from within this one.
- **Phase 3 — Push-mode Claude Code adapter: done, precision bar
  deliberately deferred** (see `docs/phase3-verify.md`).
  `adapters/claude-code/push-hook.mjs` + `scripts/install-push-hook.mjs`;
  installed live into `~/.claude/settings.json` (backed up first) alongside
  the still-active old `skill-router.py` hook (not disabled yet — user
  choice, verify first). Hard requirement (silence on non-match) 5/5.
  Should-match eval only 3/5 clean; 2 known misses (pdf, literal "grep")
  logged as Phase 4 feedback-loop targets rather than hand-tuned now.
  OpenCode adapter: not started (stub only, no OpenCode detected on this
  machine yet).
- **Phase 4 — Feedback loop: done (usage weighting), embeddings not
  attempted** (see `docs/phase4-verify.md`). `core/feedback.mjs`
  (append-only JSONL, bounded ×0.5–×2.0 factor), wired into push-hook,
  router-cli, and mcp-server (not `eval`, kept deterministic). New
  `adapters/claude-code/feedback-mark-hook.mjs` (PostToolUse) resolves
  tool calls back to capability ids. Found and fixed a real bug in the
  same pass: `route.binary` field added because `ripgrep`'s mise `source`
  ("ripgrep") never matched its actual invoked command ("rg"). Demoed:
  an ignored suggestion drops below its threshold and stops appearing
  (observed in 2 ignores, not literally 5 — same mechanism, converges
  faster on this query). Dense embedding rerank (PLAN.md item 3):
  deliberately not attempted — optional in the plan, no proven gap yet
  that keyword+hybrid can't cover.
- **Explicitly not rebuilt / out of scope for now:** team-kernel,
  mutation/verification loop, multi-agent orchestration (all existed in v1
  with passing tests but no daily-use proof — revisit only if the loader+
  router prove themselves first and a specific gap demands it).

## 7. Destination check (how we'll know we're not lost)

If a future change doesn't map to one of these, question it before building:

- Does it reduce tokens or improve suggestion precision, measurably?
- Is it delegated to an existing, evidence-checked tool wherever possible?
- Is any new "list" pure data, with zero new decision logic bolted on?
- Was the gap actually observed (dogfooded), not just imagined?
- Does it still run without a daemon, or is the daemon a proven, not
  assumed, requirement?
