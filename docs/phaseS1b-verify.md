# Phase S1b verify — CLI enrichment ladder + auto-enrich on import

Verified 2026-07-10 on this Windows machine.

## What shipped

- `core/cli-enrich.mjs` — the no-LLM enrichment ladder. Pure parsers
  (`parseMiseRegistry`, `pickBackend`, `packageMetaUrl`, `parsePackageMeta`,
  `tldrUrls`, `parseTldr`, `parseSubcommands`, `buildCliEnrichment`) + guarded
  IO (`miseRegistryMap`, `fetchJsonGuarded`, `fetchTextGuarded`,
  `enrichCliLadder`). identity: mise registry -> backend:package; describe:
  package-registry JSON (npm/PyPI/crates.io/GitHub) -> tldr raw markdown ->
  `--help` first line + subcommand harvest -> `pip show`. Fail-open at every
  rung.
- `core/enrich.mjs` — `runEnrichment` now uses `enrichCliLadder` (legacy
  sync `enrichCli` kept behind `cliLadder:false`). Cycle with cli-enrich.mjs
  is call-time only (function exports), verified loads clean.
- `scripts/import-surfaces.mjs` — auto-enriches CLI candidates inline on
  apply (promote bare -> useful); grouped display (all surfaces, real counts,
  small groups full / large groups sampled + import hint); the enrich ladder
  is the quality gate — a still-bare CLI is held back, not fanned out.
  Dropped the old `DEFAULT_TYPES` type-suppression.
- Tests: `core/cli-enrich.test.mjs` (11), `scripts/import-surfaces.test.mjs`
  (+6 = 13). Full suite 165/165.

## Observed (not asserted)

Ladder, live:

```
$ enrichCliLadder(['ripgrep','rtk'])
ripgrep  desc: "...line-oriented search tool that recursively searches ...
                respecting gitignore rules..."   (source: crates/GitHub package)
         trig: ripgrep | egrep | grep | pattern | regex | search |
               command-line-utilities | text-processing
rtk      desc: "CLI proxy that reduces LLM token consumption by 60-90%..."
         trig: rtk | rtk ls | rtk tree | rtk read | rtk git | rtk gh | ...
                (subcommands harvested from --help; rtk is NOT in mise registry)
```

Grouped import status, live (nothing hidden):

```
new candidates: 565
  agent (90): ... , … +84       import all: --type agent | one: --include agent:<id>
  cli (2): pipx:markitdown, rust
  command (117): ... , … +111    import all: --type command | ...
  mcp (8): fetch, exa, github, gortex, memory, node_repl, playwright, sequential-thinking
  skill (348): ... , … +342      import all: --type skill | ...
```

Auto-enrich on apply (scoped), then cleaned:

```
$ import apply --apply --include pipx:markitdown
WROTE recipes/imported.yaml: +1 (pipx:markitdown)
# entry got real description "Utility tool for converting various files to
# Markdown" + trigger "markitdown" (was bare); provenance enriched.description=pip
```

## Verify

- [x] CLI enriched from deterministic sources, no LLM (ripgrep via
  crates/GitHub; rtk via --help subcommands — a tool in no registry)
- [x] enrichment produces natural-language triggers (search/grep/regex, not
  just the literal name)
- [x] anti-junk gate: a bare, un-enrichable CLI returns null (held back)
- [x] import auto-enriches on apply; imported CLI is no longer bare
- [x] grouped display shows every surface with real counts, nothing hidden
- [x] full suite 165/165

## Notes

- Ladder degrades gracefully: markitdown (installed via pipx, not in mise
  registry) skipped the package/tldr rungs and still enriched from `pip show`.
- Network (package registry + tldr) runs at enrich time only (never on the
  route hot path) and is cached in `.hp-state/tool-descriptions.json`, matching
  enrich.mjs's existing discipline. Injected + guarded for tests.
- rtk resolved a real package description without a wrong-package collision —
  the mise-registry identity step is what makes that safe (per research doc).

## Still open (next decision, not built)

Auto fan-out TRIGGER: import auto-enriches, but WHAT invokes import + sync
automatically (session-start hook? surface:watch? explicit command only?) is
the remaining locked-plan decision. Flagged to owner before building.
