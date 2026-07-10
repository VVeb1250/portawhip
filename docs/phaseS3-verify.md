# Phase S3 verify — embedded-hook inventory (mode B: scan only)

Verified 2026-07-10 on this Windows machine.

## Scope (decision B)

Scan + inventory embedded hooks only. NO linking, NO execution. The goal is
to make visible what runs on lifecycle events from inside installed skills/
plugins, so a later per-item-approved link step (S3 full) has concrete
targets — and only if a proven need appears (proven-gap before scope).

## What shipped

- `core/discover-hooks.mjs` — walks plugin/skill roots for `hooks.json`,
  parses the standard Claude Code hook shape (`hooks.<Event>[].hooks[]`),
  extracts each `type:"command"` hook with id/package/host/event/matcher +
  a truncated command preview (full source path kept). Pure parser
  (`parseEmbeddedHooks`, `classifyHookPath`, `summarizeEmbeddedHooks`)
  separated from the fs walk; malformed files are skipped, nothing executes.
- `scripts/embedded-hooks.mjs` + `npm run hooks:embedded` — read-only
  inventory view (`--json` supported).
- `surface-matrix.yaml` / `core/surface-matrix.mjs` — hook-embedded READ cell
  now `covered` (probe `discover embeddedHooks`); WRITE stays `missing` with
  a note that linking is deferred (mode B). doctor + inventory pick it up.
- `core/discover-hooks.test.mjs` — 4 tests. Full suite 182/182.

## Observed (not asserted)

`node scripts/embedded-hooks.mjs`, live on this machine:

```
embedded hooks: 30 (active 30, templates 0)
by host: {"claude-code":29,"codex":1}
by package: {"ecc":17,"caveman":1,"security-guidance":5,"ralph-loop":1,
             "learning-output-style":1,"hookify":4,"explanatory-output-style":1}
```

- Real embedded hooks exist and were invisible before: 30 across 7 packages,
  on events PreToolUse/UserPromptSubmit/PostToolUse/SessionStart/Stop, several
  with matchers (Bash, Write, Edit|Write, …). ecc alone ships 17.
- Command bodies are surfaced verbatim (truncated) — e.g. ecc's
  `node -e "…CLAUDE_PLUGIN_ROOT resolver…" node scripts/hooks/pre-bash-dispatcher.js`
  — exactly what a human must read before ever choosing to activate one.
- Matrix (`doctor --heavy`): `Hooks (embedded in skills/plugins)` read:
  **covered(30)** write: **missing** (honestly still an attention item — the
  inventory exists, linking does not).

## Verify

- [x] scanner finds real embedded hooks on this machine (30, 7 packages)
- [x] command bodies shown for human review (preview + source path)
- [x] nothing linked or executed — read-only inventory
- [x] matrix hook-embedded read covered; write honestly still missing
- [x] full suite 182/182

## Why this is mode B (not full linking)

Linking an embedded hook means running a third-party command on lifecycle
events — a real trust boundary. Mode B stops at making them visible so the
decision to activate any of them is a deliberate, informed, per-item choice
later (or never). The write/link lane is intentionally left `missing` until a
concrete need is observed.
