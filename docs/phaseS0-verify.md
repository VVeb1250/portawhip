# Phase S0 verify — surface coverage matrix

Verified 2026-07-10 on this Windows machine.

## What shipped

- `surface-matrix.yaml` — pure data: per-surface read/write lane owner or
  declared gap (missing/partial/unsupported). Host axis stays dynamic (not
  listed here); probe descriptors are data interpreted by the collector.
- `core/surface-matrix.mjs` — `loadSurfaceMatrix` + `collectSurfaceMatrix`.
  Live-probes every declared owner (command resolves / discover.mjs count /
  link-hooks / link-connectors); declared gaps report verbatim, no probe.
- `scripts/doctor.mjs` — matrix section (light by default, `--heavy` for
  full mcp/skill counts) + `--json` includes `matrix`.
- `core/surface-inventory.mjs` — includes heavy `surfaceMatrix` +
  `summary.surfaceAttention`.
- `scripts/tui.mjs --summary` — surfaces gaps as an attention item.
- `core/surface-matrix.test.mjs` — 5 tests, added to `npm test`.

## Observed (not asserted)

`node scripts/doctor.mjs` matrix section, live on this machine:

```
MCP servers                        read: declared             write: covered
CLI tools                          read: covered(11)          write: covered
Skills                             read: declared             write: covered
Slash commands                     read: covered(137)         write: missing
Subagent defs                      read: covered(90)          write: partial
Hooks (declared)                   read: covered              write: covered(6)
Hooks (embedded in skills/plugins) read: missing              write: missing
Instructions / router link         read: covered              write: covered(10)

Attention (no lane / backend missing): command, hook-embedded
```

- Every `missing` cell from the plan's gap table appears: `command` write,
  `hook-embedded` read+write. `agent` write shows `partial` (ai-config-sync
  claude<->codex only), as declared.
- Counts are real: 137 commands + 90 agents discovered from plugin roots,
  11 CLI tools from mise. These are the read-side numbers Phase S1/S2 will
  route into sync.
- No cell claims support without a passing probe: `backend-missing` would
  show if a declared backend command failed to resolve; none did here.

## Verify checklist (from plan)

- [x] doctor output shows the matrix with real counts
- [x] every `missing` cell in the plan table appears
- [x] no cell claims support without a passing probe (live-probe, not assert)
- [x] `npm test` includes surface-matrix.test.mjs (5/5 green)

## Notes / decisions

- Light vs heavy: mcp/skill read probes are `heavy` (add-mcp network +
  asm shell-out). `doctor` runs light so it stays fast; `doctor --heavy`
  and `surface-inventory` run full counts. Same discipline as enrich.mjs
  (heavy discovery never on the hot path).
- One bug found + fixed during build: a direction with `owner` set *and* a
  declared `gap` but no probe was falling through to "unknown probe kind" →
  `backend-missing`. Now a declared gap wins as the honest status (the
  `agent` write partial case). Covered by a regression test.
