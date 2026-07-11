# Phase S2 verify — commands + agents lanes

Verified 2026-07-10 on this Windows machine.

## What shipped

**Read (import) — host-native command/agent dirs**
- `core/discover.mjs`: `markdownFilesUnder` now starts in-segment when the
  root's basename IS the segment, so a host-native leaf dir (e.g.
  `~/.claude/commands`) is read directly, not just segment dirs nested in
  plugin trees. New `defaultCommandRoots()` / `defaultAgentRoots()` data
  catalogs add `~/.claude/{commands,agents}` + project `.claude/{…}` on top
  of the plugin roots. `discoverCommands`/`discoverAgents` use them.
- `core/discover-surface.test.mjs` — 4 tests (leaf-dir read, nested
  segment-walk still works, catalog contents).

**Write (fan-out) — managed-copy lane (decision A)**
- `core/surface-copy-targets.mjs` — data catalog of per-host command/agent
  dirs + format. Claude Code + Codex = markdown; gemini-cli marked
  `unsupported` (TOML/unknown, not fed a .md that wouldn't load).
- `scripts/link-surfaces.mjs` — `status|install|remove`, link-hooks pattern.
  Copies each canonical command/agent `.md` into every markdown host's dir
  with an injected `<!-- portawhip-managed: <id> -->` marker (idempotent
  install, precise remove). The file already under one host's dir is its
  `source`, never copied back onto itself. Pure helpers
  (`canonicalSurfaceEntries`, `isSourceDir`, `withMarker`, `isManaged`)
  exported + tested; `collectSurfaceLinks` takes an injectable targets
  catalog so the full install→remove roundtrip is tested against temp dirs,
  never real host dirs.
- `scripts/sync-surfaces.mjs` — new `commands+agents` lane runs
  link-surfaces on `sync` (install) and `check` (status). So both manual
  `sync-surfaces sync` and the session-start auto-sync fan these out.
- `surface-matrix.yaml` — command + agent write cells now point at
  link-surfaces (were `missing`/`partial`).
- `scripts/link-surfaces.test.mjs` — 5 tests incl. the temp-catalog
  install→remove roundtrip.

## Observed (not asserted)

- Host-native discovery: `discoverCommands` 137 → **139**, `discoverAgents`
  90 → **93** — exactly the `~/.claude/commands` (2) + `~/.claude/agents` (3)
  user dirs now read.
- Codex has a real `~/.codex/agents/` dir (confirmed live); catalog targets
  it + `~/.codex/prompts` for commands.
- Matrix (`node scripts/doctor.mjs`): `Slash commands` read: covered(139)
  write: **covered**; `Subagent defs` read: covered(93) write: **covered**
  (were missing/partial in S0).
- `sync-surfaces check` now lists a third lane `commands+agents`.
- `link-surfaces status` with nothing canonical = `0 target(s)` — silent
  until the user imports a command/agent (import stays manual, S1c).
- Full suite **178/178** (run singly; note: the universal-hook feedback
  test shares `.hp-state/feedback` and flakes if two `npm test` runs overlap
  — run the suite one at a time).

## Verify

- [x] host-native commands/agents discovered (read lane), +2/+3 live
- [x] managed-copy install→remove roundtrip (write lane) — temp-catalog test
- [x] source host never copied onto itself; gemini reported unsupported
- [x] wired into sync-surfaces (manual + auto-sync fan these out)
- [x] matrix command/agent write now covered
- [x] full suite 178/178

## Notes / decisions

- Decision A (one managed-copy lane for both commands + agents to md hosts)
  chosen over delegating agents to ai-config-sync — one mechanism, uniform,
  VISION "don't build a second architecture."
- v1 is frontmatter-passthrough copy only; no cross-host format translation.
  Gemini (TOML commands) is honestly `unsupported`, not silently mangled.
- Concurrency lesson recorded: never run `npm test` twice concurrently — the
  universal-hook integration test snapshots/restores the shared repo
  `.hp-state/feedback`, so overlapping runs corrupt each other (a false
  1-test failure was traced to exactly this, not a regression).
