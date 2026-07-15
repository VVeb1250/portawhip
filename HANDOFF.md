# Hand-off — read this first

Order to read docs in: **this file** → `VISION.md` (why + destination, only
changes when direction changes) → `PLAN.md` + `docs/sync-connector-plan.md` +
`docs/writer-consolidation-plan.md` (the three now-complete roadmaps) → the
per-phase verify logs in `docs/archive/` (what was actually proven, with
commands to re-check it yourself). For anything before the current-state block,
see the compact history section below plus `git log` — and trust a fresh
`ls`/run over any command or path an older doc cites, since the 2026-07-11
refactor moved most module paths (map in the current-state block).

## Current state — read this first (2026-07-15)

Everything in the compact history below still holds as history; five waves
landed after the 2026-07-04/07 baseline. Full suite now **268/268** (`npm test`,
verified 2026-07-15); `npm run route:eval` clean (all metrics 1.0, falsePositive 0).

- **Router intelligence overhaul (2026-07-09, `docs/router-intelligence.md`).**
  A feedback-log audit found the hit rate was *unmeasurable*: 21/26
  "suggestions" fired on `<task-notification>` synthetic blobs and `resolveId`
  had no Skill/Agent branch, so boost never fired. Fixed: `core/router/
  prompt-hygiene.mjs` skips synthetic prompts read-side; Skill/Agent usage
  attributed. **Push/pull made asymmetric** — push has a hard
  `pushMinConfidence` gate + full→terse→silent repeat budget; pull keeps recall
  and unused results earn **no decay**. Lesson: *fix measurement before tuning.*
- **Sync connector S0–S4 (2026-07-10, `docs/sync-connector-plan.md`).**
  Bidirectional surface sync (import → canonical → fan-out), **no new
  reconciler**. 3 capability types → 7 surfaces. Host set → 11-row matrix via
  `core/surface/extra-hosts.mjs` (Pi, Amp), presence-gated. CLI auto-enriched
  on import. Matrix + reason per gap: `docs/host-support.md`.
- **Mode differentiation WS-A (2026-07-11).** Push **silent by default**
  (`PORTAWHIP_PUSH_MODE=legacy` = rollback); pull contracts ask for only the
  *positively requested action + direct object*. `intentEvidence` is advisory,
  can't gate. Engines unchanged. WS-B stateful-policy engine evaluated and
  **NO-GO** on the evidence (`docs/archive/ws-b-evidence-gate.md`).
- **Writer consolidation (LOCKED 2026-07-13, `docs/writer-consolidation-plan.md`)
  — the biggest change since.** The real disease was **many backends writing
  the same host files → drift** (proven: a live drift *war* between
  ai-config-sync and @agents-dev on one Codex target, hashes never converged).
  Decision Fork A: **rulesync = sole fan-out writer, both scopes**, canonical
  `.rulesync/`. `@agents-dev/cli` **retired**; `ai-config-sync` → migration
  only; `add-mcp` keeps its read/union side (rulesync import can't union across
  hosts); `mise` kept; `asm` → skill long-tail; **`link-hooks` keeps the hooks
  key** (rulesync's hooks feature is non-functional for claudecode — live-tested,
  3 schemas, empty output). Cross-scope dedup via **derived** scope
  (`core/surface/scope-derive.mjs`), never a hand list. Rule to keep: one writer
  per target file; total-ownership writers never coexist, surgical ones may.
  `rulesync.jsonc` targets are a scoped 12-host list — **never `*`** (unscoped
  writes ~35 files for tools you don't have).
- **Auto-sync live, watchdog not built (Phase 5, 2026-07-14).**
  `scripts/sync/auto-sync.mjs` fires fire-and-forget from SessionStart
  (lock+throttle+log), propagating only already-canonical entries. Project
  scope only; global apply still manual. Watchdog (Phase 6) deliberately
  deferred behind a proven-gap gate (a standing test asserts no watchdog exists).
- **Refactor path-map (2026-07-11).** `core/` → `router/ registry/ surface/
  state/`; `scripts/` → `link/ sync/`. `core/router-cli.mjs` →
  `core/router/router-cli.mjs`; `scripts/link-*.mjs` → `scripts/link/…`;
  `scripts/{import,sync}-surfaces.mjs` / `sync-config.mjs` → `scripts/sync/…`;
  `core/feedback.mjs` → `core/state/feedback.mjs`; `core/discover.mjs` →
  `core/registry/discover.mjs`. `load.mjs`/`hosts.mjs`/`doctor.mjs`/`tui.mjs`
  stayed at `scripts/` root. Old phase-verify docs moved under `docs/archive/`.
  Prefer `npm run <alias>` — see the sanity-check block near the end of this file.

## Earlier history (2026-07-04 → 07-06) + still-live carve-outs

The full narrative of the 07-04 launch (public repo, MIT), the cross-host hook
consolidation, and the 07-06 push-precision / dense-retrieval work lives in
`git log` and `docs/archive/phase*-verify.md`; `docs/router-intelligence.md` +
`docs/host-support.md` carry the parts still current. Don't re-derive from the
old prose — it predates the 07-11 refactor and the writer consolidation. What
still matters, distilled:

- **Back up before any global hook write.** `link-hooks.mjs` has **no built-in
  backup**; manually copy `~/.claude/settings.json`, `~/.codex/hooks.json`,
  `~/.gemini/settings.json` before `install`/`remove --scope global`.
- **Backup-before-delete applies to manual cleanup too**, not just code paths —
  a reflex `rm -f .hp-state/feedback/events.jsonl` once destroyed the real
  (gitignored) feedback log. Look before you delete.
- **Cross-OS unverified.** Built/tested on Windows only; POSIX-safety was
  static-reviewed (`cross-spawn` everywhere, no Windows-only APIs outside
  `node:path`), never live-run on macOS/Linux — don't upgrade to "verified"
  without a real run.
- **`claude-desktop` MCP reads `missing`** — its config uses a newer
  "Cowork"-style schema `add-mcp` doesn't read (no `mcpServers` key). Upstream
  add-mcp/Claude-Desktop mismatch, not our bug; nothing was ever installed there.
- **Open, undecided — auto-discovered CLI entries have no "agent-ready" vetting.**
  `discoverCli()` makes every mise-tracked CLI routable by bare name; no metadata
  distinguishes "built for non-interactive agent use" from a random dev tool.
  Security risk low (router only emits text; execution still hits the host's own
  permission gate); functional risk real-but-latent (an interactive-only CLI
  could hang if invoked non-interactively). Import-time enrichment (07-10)
  improved triggers but did not add the vetting gate. Leaning: exclude
  `origin:"auto:cli"` from routing until promoted to a curated entry — not committed.
- **Regression guards (don't reintroduce):** (a) the hybrid engine can lose
  recall on a short single-trigger match diluted by generic query tokens ("grep
  for TODO" under-scored ripgrep) — deferred to feedback data, not hand-tuned;
  (b) a curated `cli` entry's `source` (mise package name) can differ from the
  invoked binary (`ripgrep` vs `rg`) — set `route.binary` so feedback matching works.

## How to sanity-check anything in this repo yourself

```bash
npm test                      # unit/integration tests (268/268), ~35s
npm run route:eval            # live eval against docs/router-eval-set.jsonl
npm run route:compare         # keyword vs hybrid engine side by side
npm run route -- --prompt "..."                        # try any prompt against the live config
npm run doctor                                         # unified status across all backends + per-host detail
npm run import                                         # what's installed but not yet canonical (preview-gated)
npm run surface:sync:check                             # canonical vs each host, no writes
npm run hooks:embedded                                 # inventory hooks bundled inside skills/plugins
node scripts/link/link-hooks.mjs status --scope global      # native hooks, per host
node scripts/link/link-connectors.mjs status --scope global # instruction connectors, per host
```

> Note: the old `scripts/install-push-hook.mjs` was deleted (superseded by
> `adapters/hooks/universal-hook.mjs` + `scripts/link/link-hooks.mjs`); use the
> `doctor` / `link-*` status commands above. The `link-*` scripts moved under
> `scripts/link/` in the 2026-07-11 refactor; steady-state fan-out is now
> `rulesync` (see the current-state block at the top).

If a doc's claimed result and a fresh run disagree, trust the fresh run —
docs decay, live checks don't.
