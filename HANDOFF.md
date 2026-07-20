# Hand-off — read this first

The living state of this repo. `VISION.md` says why the project exists and only
changes when direction changes; this file says what is actually true today and
changes whenever that does.

If a doc's claimed result and a fresh run disagree, **trust the fresh run**.
Docs decay; live checks don't.

---

## Current state (2026-07-21)

portawhip is **one control plane for collecting the tools, skills, MCP servers,
commands, agents and hooks your AI coding agents use, and keeping every host
aligned on them.** That is the whole job.

**Test suite: 242/242** (`npm test`), passing both with and without a capability
provider installed. That "both ways" matters — it is what stops the suite from
quietly depending on whatever happens to be on the developer's machine.

### The big change: the router left

Until 2026-07-21 this repo was two projects in one package: the collector, and a
retrieval router that decided which capability to surface. The router now ships
separately as **`portawhip-router`** (`E:\harness-router`, 25 commits, history
preserved via subtree split).

Why: the router's own held-out eval puts top-1 at 27.5%, and it dragged
`@huggingface/transformers` — a 500MB model download — into every portawhip
install. One unfinished half was taxing the finished one.

What replaced it is a **provider seam**. An optional package can contribute:

| Contribution | Export | Where it lands |
|---|---|---|
| Config keys | `configSchema` | `portawhip config`, the TUI settings tab |
| Instruction text | `connector` | Host instruction files, via rulesync |
| Hook behaviour | `hooks.onUserPrompt` / `.onPostTool` | `adapters/hooks/universal-hook.mjs` |
| Its own capability | `recipe` | The capability index |

Two invariants keep this honest, both enforced by tests:

1. **portawhip never imports a provider** — `core/state/provider-boundary.mjs`
   fails the build if any module does, and asserts the router is never a
   dependency.
2. **A missing provider is an absence; an installed-but-broken one is loud.**
   Silence on a genuine fault is the failure mode this project exists to avoid.

Installing the router flips settings from 2 keys to 19 and connector status from
`no-connector:10` to `linked:10`, with no other configuration.

### Where things live now

```
core/registry/     discovery, enrichment, the capability index
core/surface/      host targets, ownership ledger, coverage matrix
core/state/        config schema, provider seam, bundle selection
core/fixtures/     test-provider.mjs — how portawhip tests the seam
adapters/hooks/    one hook body, many hosts
adapters/instructions/  idempotent marker-block writer (connector-agnostic)
scripts/link/      connector + hook status (read-only)
scripts/sync/      import, reconcile, auto-sync
scripts/experiments/    executable research harnesses, not part of the product
docs/harness/      design docs for the collection half
docs/archive/      historical records — see its README for what is still true
```

**Public API.** Consumers bind to the `exports` map, not deep paths:
`portawhip/registry`, `/registry/docs`, `/registry/kind`, `/registry/enrich`,
`/state/config`, `/state/stack-detect`, `/state/bundle-state`. Pinned by
`core/public-api.test.mjs` — adding to it widens what we promise to keep
working; removing from it is a breaking change.

---

## Known gaps and things that will bite you

- **Editing host config from PowerShell 5.1 will corrupt it.**
  `Set-Content -Encoding utf8` writes a **BOM**, which makes
  `~/.codex/config.toml` unparseable (`Unknown character "65279"`) and is
  invisible in a diff. Learned by doing it: the repair script is
  `scripts/experiments/` territory — write bytes directly
  (`[IO.File]::WriteAllText`, or Python `open(path,"wb")`), never
  `Set-Content -Encoding utf8`. Also note paths inside JSON/TOML are
  **backslash-escaped**, so a naive find/replace on `E:\...` silently matches
  nothing while still rewriting the file.
  The five global registrations (`~/.claude.json`, `~/.codex/config.toml`,
  `~/.cursor/mcp.json`, `~/.gemini/settings.json`,
  `%APPDATA%/Code/User/mcp.json`) were repointed at the router package on
  2026-07-21 and all five parse.
- **portawhip's own hook is not in canonical.** `.rulesync/hooks.json` is
  `{"version":1,"hooks":{}}`, so `.claude/settings.json` is `{}` and
  project-scope hooks read `missing`. The universal hook was never seeded into
  the canonical source. Known, deliberately deferred — it needs its own change.
- **`sync check` reports 4 of 43 targets drifting.** Pre-existing, and none of
  it is caused by the extraction. The drift is real: files rulesync owns have
  been edited by other tools since it last wrote them.
- **Cross-OS unverified.** Built and tested on Windows only. POSIX-safety was
  static-reviewed (`cross-spawn` throughout, no Windows-only APIs outside
  `node:path`) but never live-run on macOS or Linux. Do not promote this to
  "verified" without a real run.
- **`claude-desktop` MCP reads `missing`.** Its config uses a newer
  "Cowork"-style schema `add-mcp` cannot read (no `mcpServers` key). Upstream
  mismatch, not our bug; nothing was ever installed there.
- **Auto-discovered CLI entries have no agent-ready vetting.** `discoverCli()`
  makes every mise-tracked CLI routable by bare name, with no metadata
  separating "built for non-interactive agent use" from a random dev tool.
  Security risk is low (the router only emits text; execution still hits the
  host's permission gate); functional risk is real but latent — an
  interactive-only CLI could hang. Leaning toward excluding `origin:"auto:cli"`
  from routing until promoted to a curated entry. **Not decided.**

## Safety rules learned the hard way

- **Back up before any global hook or connector write.** `link-hooks.mjs` has
  **no built-in backup**. Copy `~/.claude/settings.json`, `~/.codex/hooks.json`,
  `~/.gemini/settings.json` first.
- **Backup-before-delete applies to manual cleanup too.** A reflex
  `rm -f .hp-state/feedback/events.jsonl` once destroyed the real, gitignored
  feedback log. Look before you delete.
- **One writer per target file.** Overlapping total-ownership writers oscillate
  forever — proven live, and the reason rulesync is the sole fan-out writer.
  Surgical writers may share a file; total-ownership writers may not.
- **A curated `cli` entry's `source` can differ from the invoked binary**
  (`ripgrep` vs `rg`). Set `route.binary`, or feedback matching silently never
  fires.

## Sanity-check anything yourself

```bash
npm test                      # 242/242, ~35s
npm run doctor                # unified status across backends + per-host detail
npm run tui -- --summary      # non-interactive inventory summary
npm run import                # installed but not yet canonical (preview-gated)
npm run sync:check            # canonical vs each host, no writes
npm run surface:sync:check    # same, surface lane
npm run hooks:embedded        # hooks bundled inside skills/plugins (inventory only)
node scripts/link/link-hooks.mjs status --scope global
node scripts/link/link-connectors.mjs status --scope global
```

To check the seam specifically:

```bash
PORTAWHIP_DISABLE_PROVIDERS=all npm run tui -- --summary   # bare install
npm test                                                    # must pass either way
```

Routing commands (`route`, `route:eval`) moved to the router repo.

## Where to read more

| Question | File |
|---|---|
| Why does this project exist? | [VISION.md](VISION.md) |
| What does it do, as a user? | [README.md](README.md) |
| Which hosts support which surfaces? | [docs/host-support.md](docs/host-support.md) |
| Why is rulesync the only writer? | [docs/harness/writer-consolidation-plan.md](docs/harness/writer-consolidation-plan.md) |
| How does bidirectional sync work? | [docs/harness/sync-connector-plan.md](docs/harness/sync-connector-plan.md) |
| What was tried and rejected? | [docs/archive/README.md](docs/archive/README.md) |
| How good is the router, honestly? | the `portawhip-router` repo, `docs/router-next.md` |
