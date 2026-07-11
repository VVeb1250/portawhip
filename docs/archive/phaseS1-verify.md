# Phase S1 verify — import direction (hosts -> canonical)

Verified 2026-07-10 on this Windows machine.

## What shipped

- `scripts/import-surfaces.mjs` — `status|preview|apply`, same gate as
  sync-config (apply needs `--apply`). Diffs `discoverAll()` (what's
  installed across hosts) against what's already canonical (recipe/bundle/
  imported entries + `.agents/agents.json` mcp servers), proposes the gap.
  Default scope **cli+mcp**; skills/commands/agents need `--type` or
  `--include` (avoids a 300+ item preview — the noise this project exists to
  cut). CLI/skill/command/agent land in `recipes/imported.yaml`; MCP lands
  in `.agents/agents.json` mcp.servers (agents-dotdir fans out).
- `core/bundle-state.mjs` — `resolveRecipePaths` now always includes
  `recipes/imported.yaml`, ordered BEFORE the project's own recipe.yaml so
  hand-authored entries still win on id collision. Imported entries route
  only if discovery confirms they're still installed (buildIndex's existing
  fromBundle gate) — a stale import self-heals.
- Provenance: each imported entry carries `imported: { at, via }` (an extra
  key buildIndex ignores for routing) so a later forget/doctor can trace it.
- `scripts/import-surfaces.test.mjs` — 7 tests (pure functions), in `npm test`.
- npm scripts: `import`, `import:preview`.

## Observed (not asserted)

```
$ node scripts/import-surfaces.mjs status
discovered 582 across hosts; 21 already canonical
new candidates: 10
  -> recipes/imported.yaml: pipx:markitdown, rust
  -> .agents/agents.json mcp: fetch, exa, github, gortex, memory, node_repl,
     playwright, sequential-thinking
```

Scoped apply + idempotency + routing pickup:

```
$ node scripts/import-surfaces.mjs apply --apply --include pipx:markitdown
WROTE recipes/imported.yaml: +1 (pipx:markitdown)

# recipes/imported.yaml now holds a curated cli entry with route + provenance

$ node scripts/import-surfaces.mjs apply --apply --include pipx:markitdown
new candidates: 0   (nothing new — silence is a valid result)   <- idempotent

$ node core/router-cli.mjs list | grep markitdown
{"id":"pipx:markitdown","type":"cli",...}   <- one entry, now curated (not
                                                the bare auto:cli twin)
```

- Skills excluded by default (582 discovered, only 10 proposed): the
  no-bulk-skills guard holds without any per-skill blocklist.
- After apply, the item is "known" so re-apply proposes nothing (idempotent).
- After apply, the imported entry is picked up by the router as a curated
  entry — the bare auto-discovered twin is filtered out (import promotes
  bare -> curated), exactly the intended win.

The test artifact (`recipes/imported.yaml` with markitdown) was removed after
verification to leave a clean tree; the feature is covered by tests and this
observed run. A real import is one `apply --apply` away.

## Verify checklist (from plan)

- [x] preview finds a host-installed-but-uncurated capability (10 found)
- [x] apply of a selected item lands it in recipes/imported.yaml
- [x] re-run preview is empty for that item (idempotent)
- [x] router picks it up as curated (bare twin filtered)
- [~] fan-out to a second host: the lane is the existing `sync-surfaces sync`
  (mise/asm/agents-dotdir), proven in prior phases; not re-run destructively
  here to avoid cross-host installs during the build. `npm run sync-surfaces`
  is the command.
- [x] `npm test` includes import-surfaces.test.mjs (7/7 green)

## Decisions

- Default import scope cli+mcp (user was asked; chose the recommended
  low-noise default). Other surfaces are opt-in via selectors — and once the
  S2 command/agent lanes and S3 embedded-hook scanner land, they flow through
  this same import path as additional `--type` values.
- Host attribution: discovery dedups to id+source and does not reliably carry
  which host an item came from, so provenance records `via: discover:<type>`
  (honest about what's known) rather than a fabricated host name.
- MCP launch config isn't carried by discoverMcp (it dedups to id+source), so
  apply re-fetches config from add-mcp for just the servers being imported;
  a server with no recoverable launch config is skipped and reported, never
  written half-formed.
