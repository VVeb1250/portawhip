# Archive

Historical records. Nothing here is current, and nothing here should be used to
decide how the code works today — read [HANDOFF.md](../../HANDOFF.md) for that.

They are kept because they show what was measured and why a decision went the
way it did. A verification log that says "this was checked on this date, on this
machine, and here is what it printed" is worth more later than a summary of it.

| File | Date | What it is | Still true? |
|---|---|---|---|
| [phaseS0-verify.md](phaseS0-verify.md) | 2026-07-10 | Surface coverage matrix, first run on Windows | Superseded by [docs/host-support.md](../host-support.md) |
| [phaseS1-verify.md](phaseS1-verify.md) | 2026-07-10 | Import direction: hosts → canonical | Mechanism still current; paths have moved |
| [phaseS1b-verify.md](phaseS1b-verify.md) | 2026-07-10 | CLI enrichment ladder, auto-enrich on import | Mechanism still current |
| [phaseS1c-verify.md](phaseS1c-verify.md) | 2026-07-10 | Auto-sync on session start | Still current; `autoSync` is off by default |
| [phaseS2-verify.md](phaseS2-verify.md) | 2026-07-10 | Commands and agents lanes | Still current |
| [phaseS3-verify.md](phaseS3-verify.md) | 2026-07-10 | Embedded-hook inventory, scan-only | Still current — portawhip never activates third-party embedded hooks |
| [phaseS4-verify.md](phaseS4-verify.md) | 2026-07-10 | Host widening + support matrix | Superseded by [docs/host-support.md](../host-support.md) |
| [status-2026-07-15.md](status-2026-07-15.md) | 2026-07-15 | Release checklist snapshot | **Stale.** Predates the router extraction; test counts and file lists no longer match |

## Moved out

The router's own history left with the router. Phases 0–4, the WS-A/WS-B
records, and the original router plan now live in the `portawhip-router`
repository under `docs/archive/`, alongside the code they describe.
