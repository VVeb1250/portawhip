# Phase S1c verify — auto-sync on session start (decision D, reconciled)

Verified 2026-07-10 on this Windows machine.

## Decision (locked with owner)

Import and fan-out are split:

- **IMPORT (discovered -> canonical) is MANUAL** — `npm run import` (grouped
  display, auto-enrich on apply). The user chooses what becomes canonical.
- **FAN-OUT (canonical -> all hosts) is AUTO** — a session-start hook
  fire-and-forgets `scripts/auto-sync.mjs`, which runs the existing
  `sync-surfaces sync` lane for whatever is already canonical.

This reconciles the owner's two earlier statements ("user manually imports,
then it syncs to all hosts" and "auto fan-out"): the deliberate step stays
manual, the propagation is automatic. Crucially, the worker does NOT
auto-discover-and-import, so it can never pour hundreds of entries across
every host unbidden.

## Incident that drove the reconciliation (recorded honestly)

An earlier `auto-import.mjs` design ran discover+apply+fan-out on session
start. Testing the session-start hook live actually fired it: it wrote
`recipes/imported.yaml` (556 entries) and added 8 MCP servers to
`.agents/agents.json` before the fan-out step was killed. All of it was
reverted: imported.yaml removed, agents.json restored to just
`harness-router`, `.hp-state/auto-import.*` cleaned, worker killed. A partial
cross-host skill install from the interrupted fan-out could not be 100%
ruled out, but sync is idempotent/additive and reversible via each tool's
own uninstall. The lesson: auto-import (auto-writing canonical) is unsafe;
auto-sync (propagating only deliberate canonical) is safe. Hence this split.

## What shipped

- `scripts/auto-sync.mjs` — throttled + locked + logged + fail-open worker.
  Fans canonical out via `sync-surfaces sync`. No discover/import. Pure
  guards (`shouldRun`, `lockIsStale`) + injectable `fanOutImpl`.
- `core/config.mjs` — `autoSync: { enabled: true, throttleMinutes: 60 }`
  (replaces the removed `autoImport`).
- `adapters/hooks/universal-hook.mjs` — `session_start` event detaches
  `auto-sync.mjs` and returns instantly (unref).
- `core/hook-targets.mjs` + `hooks.manifest.yaml` — `session_start` logical
  hook (`auto-sync-on-start`), mapped to Claude Code `SessionStart` (the one
  host with a confirmed native event; fan-out from there reaches the rest).
  `LOGICAL_EVENT_TO_MANIFEST` makes the gemini description lookup generic.
- Removed: `scripts/auto-import.mjs` + its test.
- `scripts/auto-sync.test.mjs` (4) in `npm test`. Full suite 169/169.

## Observed

- `session_start` hook returns immediately (exit 0), detaching the worker.
- Worker unit guards: throttle + stale-lock verified; disabled config skips
  before acquiring a lock or touching fan-out.
- Post-cleanup state confirmed clean: no `.hp-state/auto-*`, no
  `recipes/imported.yaml`, `agents.json` back to `harness-router` only.
- Live fan-out is the existing `sync-surfaces sync` lane (proven in prior
  phases); not re-triggered here to avoid cross-host installs during the
  build. First real fan-out happens on the next session start (throttled 60m).

## Verify

- [x] import stays manual; worker only fans out canonical (no auto-import)
- [x] session-start hook is fire-and-forget (instant return, detached)
- [x] disabled config path is a clean no-op
- [x] the accidental 556-entry import fully reverted; tree clean
- [x] full suite 169/169
