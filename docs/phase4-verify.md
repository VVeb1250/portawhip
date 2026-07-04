# Phase 4 verify — feedback loop

## What was built

- `core/feedback.mjs` — append-only JSONL log (`.hp-state/feedback/events.jsonl`),
  never rewritten in place (avoids concurrent-write corruption between the
  push-hook and the PostToolUse hook). `computeFactors(root)` resolves each
  `suggested` event against the next `used` event for the same capability
  id, tracks the trailing hit/miss streak, and returns a bounded
  `×0.5 .. ×2.0` factor per id (PLAN.md spec).
- `adapters/claude-code/push-hook.mjs` now logs a `suggested` event per
  emitted candidate and applies `computeFactors()` to the score before the
  threshold check (so decay/boost can actually change what clears the bar,
  not just cosmetic reordering).
- `adapters/claude-code/feedback-mark-hook.mjs` — new PostToolUse hook.
  Reads the cached route index (not a full rebuild — this fires on every
  tool call) and resolves the tool just used back to a capability id:
  `mcp__<id>__*` → direct match; `Read` → file path contains a skill's
  `path`; `Bash` → command contains the cli entry's `route.binary` (new
  optional field — see below) or `source`.
- `route.binary` (optional, `core/registry.mjs`) — real bug found during
  this phase's own smoke test: `ripgrep`'s `source` is the mise package
  name, not the invoked binary (`rg`). Bash-usage matching was silently
  failing for every cli entry until this was added. `recipe.yaml`'s
  `ripgrep` entry now has `binary: rg`.
- `router-cli.mjs route` and `server/mcp-server.mjs`'s `route` tool also
  apply `computeFactors()` for ranking consistency. `router-cli.mjs eval`
  deliberately does NOT — it must stay deterministic against the fixed
  eval set, unaffected by live usage history.
- `scripts/install-push-hook.mjs` extended to install/remove/detect both
  hooks (`UserPromptSubmit` push-hook, `PostToolUse` feedback-mark-hook) in
  one settings.json, same backup-first/never-silently-touch-old-hook
  contract as Phase 3.

## Simplifications, stated up front

- Correlation is **per capability id, not scoped to one session** — a
  `used` event for X counts as a hit for whatever the oldest unresolved
  `suggested` event for X was, regardless of which session logged either
  side. Accepted for this phase; revisit only if cross-session bleed is
  actually observed producing a wrong weight.
- No dense embeddings (PLAN.md Phase 4 item 3) — marked "optional" in the
  plan, and adding a local embedding model is new-dependency scope this
  project's own principles gate on a proven gap first. Not attempted.

## Eval — end-to-end demo

```
rm .hp-state/feedback/events.jsonl
5x: echo '{"prompt":"search codebase for the word foo"}' | push-hook.mjs   # never mark used
```

Result: `ripgrep` stopped being suggested after the **2nd** ignored
suggestion (hybrid score × 0.7 factor dropped it below `hybridRecipeThreshold`),
not the 5th. This converges faster than the PLAN.md phrasing ("ignored 5x
in a row") implies, because `ripgrep`'s score on this exact query sits
close to its bar to begin with — the decay didn't need 5 steps to push it
under. This is the mechanism working, not a bug: PLAN.md's literal exit
criteria ("visibly drops rank... a capability ignored 5x in a row") is
satisfied a step early rather than exactly at step 5.

Used-path also verified directly:
```
suggested(ripgrep) -> Bash "rg foo" -> feedback-mark-hook logs used
computeFactors() -> ripgrep: 1.2 (used-streak boost)
```

`node --test core/router.test.mjs`: 16/16 still green (feedback wiring is
additive, `factors` defaults to `null`/no-op everywhere it's not passed).

## Exit criteria status

- Feedback JSONL populates during real use: done, verified via direct
  stdin smoke test (push-hook + feedback-mark-hook).
- Capability ignored repeatedly visibly drops rank/disappears: done,
  observed in 2 steps rather than 5 (see note above).
- Not yet installed into the user's real `~/.claude/settings.json`
  (`PostToolUse` group) — pending explicit confirmation, same as Phase 3's
  global-config-write gate.
