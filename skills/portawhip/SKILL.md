---
name: portawhip
description: >-
  Manage portawhip's cross-host capability sync — import newly-installed
  tools/skills/MCP/commands/agents into the shared canonical set, enrich them,
  check coverage, and fan them out to every AI host. Use when the user wants to
  import a capability, share tools across Claude Code / Codex / Gemini / Cursor,
  check what's synced, see the surface coverage matrix, or run/inspect the
  loader, router, connectors, or hooks.
---

# portawhip — cross-host capability manager

portawhip loads capabilities into whatever AI hosts + OS the user has, and
routes the right one at the right moment. Two directions:

- **import** (manual): promote a capability that's installed *somewhere* into
  the shared canonical set (`recipes/imported.yaml` for CLI/skill/command/
  agent, `.agents/agents.json` for MCP). Auto-enriched so it routes on natural
  phrasing, not just its own name.
- **fan-out** (automatic on session start, or manual): push canonical
  capabilities out to every detected host.

Run everything from the repo root. All commands are safe to preview first;
nothing installs or writes across hosts without an explicit apply/sync.

## Import a newly-installed capability

```bash
npm run import                 # grouped status: what's installed but not yet canonical
npm run import:preview         # same, framed as a plan
# apply — narrow by surface or pick one; hand-curated recipe.yaml always wins:
node scripts/import-surfaces.mjs apply --apply --type cli,mcp
node scripts/import-surfaces.mjs apply --apply --include skill:pdf
```

- Default view groups by surface (cli / mcp / skill / command / agent) with
  real counts; large groups are sampled with an import hint. Nothing hidden.
- CLI entries are auto-enriched on apply (mise registry → package registry →
  tldr → --help). A CLI that can't be enriched at all is held back.
- Import is idempotent: re-running proposes only what's genuinely new.

## Fan out to all hosts

```bash
npm run sync-surfaces sync     # push canonical -> every detected host (idempotent)
npm run sync-surfaces check    # dry-run: what would change
```

Session start also fires this automatically in the background (throttled) via
the auto-sync hook — see `router.config.yaml`'s `autoSync`. It only ever
propagates already-canonical entries, never auto-imports.

## Check coverage and health

```bash
npm run doctor                 # unified status + surface coverage matrix (light)
node scripts/doctor.mjs --heavy   # matrix with full discovery counts
npm run surface                # detailed inventory (capabilities/hooks/connectors)
npm run tui -- --summary       # one-screen attention summary
```

The surface matrix (`surface-matrix.yaml` + `core/surface-matrix.mjs`) shows,
per surface, whether the read (import) and write (fan-out) lanes are covered,
missing, or partial — live-probed, not asserted.

## Routing (surface the right capability at the right time)

```bash
node core/router-cli.mjs route --prompt "..."   # what would route for a prompt
node core/router-cli.mjs list                   # everything in the index
node core/router-cli.mjs enrich                 # refresh tool descriptions/triggers
```

## Notes

- Removing an imported entry (`forget`) is not built yet — edit
  `recipes/imported.yaml` / `.agents/agents.json` by hand for now.
- Design + rationale: `VISION.md`, `docs/sync-connector-plan.md`, and the
  `docs/phaseS*-verify.md` records.
