# Router intelligence: design rationale (2026-07-09 overhaul)

Why the push/pull split, trust-loop credit rules, and prompt hygiene work the
way they do — so the next tuning round doesn't have to re-derive it.

## The audit that triggered this

`.hp-state/feedback/events.jsonl` on 2026-07-09: suggested=26, used=4 (2 of
those the router marking itself). Looked like an 85% miss rate. Digging in
found the number was unmeasurable, not just bad:

- 21/26 suggested events fired on `<task-notification>` XML blobs —
  background-task completion notices arriving through the same
  UserPromptSubmit channel as human typing. Every one resolved as "ignored"
  in `computeFactors`, decaying genuinely good capabilities on noise.
- `resolveId` had no branch for the `Skill` or `Agent` tools — how the
  majority of suggestions (352 skills + 90 agents vs 11 mcp + 11 cli in the
  index) actually get acted on. Skill/agent usage never logged `used`, so
  boost never fired and the hit rate was measured with one eye shut.
- MCP `route()` results never entered the loop at all (only an aggregate
  `type:"route"` event), so pull-mode relevance earned nothing.

Lesson, stated once for future tuning rounds: **fix measurement before
tuning anything.** Every threshold decision made against the pre-hygiene log
was tuning deaf.

## Push vs pull are different products

**Push** (UserPromptSubmit injection) is an unsolicited interruption.
Clinical decision-support systems established the failure mode: alert
fatigue. Systems with ~90% override rates don't just waste the overridden
alerts — clinicians stop reading *all* alerts, killing the channel. Our
22/26 ignore rate was in exactly that regime. An advisory channel's asset is
trust, and every wrong interruption spends it.

**Pull** (MCP `route()`) is a solicited lookup. The caller asked; generous
recall is correct, and unused candidates are normal operation, not failure.

Hence the asymmetry, all introduced 2026-07-09:

| | Push | Pull |
|---|---|---|
| Precision bar | `pushMinConfidence` (0.75) or required-tier | route thresholds only |
| Repeat policy | full → terse → silent (`pushMaxMentionsPerSession`) | n/a (caller-driven) |
| Ignored outcome | counts as decay | **no outcome** (boost-only) |
| Used outcome | boost | boost |

The 0.75 gate was verified live, not swept blind: genuine matches score
calibrated confidence 1.0; diffuse vocabulary shotguns (three ids tied at
0.59 on "look up react hooks documentation") sit well under it. 0.75 lands
mid-plateau between those clusters.

## Trust-loop credit rules (computeFactors)

Streak-based 0.5x–2.0x factor, unchanged mechanically. What changed is what
counts as an outcome:

1. `suggested` with a synthetic prompt (see `core/prompt-hygiene.mjs`) —
   **skipped entirely**, read-side, so the append-only log retroactively
   cleans itself without a rewrite.
2. `suggested` with `source:"pull"` followed by `used` — hit (boost).
3. `suggested` with `source:"pull"` never used — **no outcome.** Punishing
   unclicked pull results would recreate the noise-decay bug one layer up.
4. Push `suggested` never used — miss (decay). The model definitely saw an
   unsolicited injection; not acting on it is real negative signal.
5. Phantom suggestions eliminated: the hook now logs `suggested` only for
   ids actually rendered, not hits the char budget dropped.

## Prompt hygiene contract

`isSyntheticPrompt` (core/prompt-hygiene.mjs) is shared by the push hook
(skip routing) and computeFactors (skip historical noise). It matches known
harness wrappers by prefix plus a generic whole-payload XML-element shape, so
new wrapper types don't each need a release. If a new harness channel starts
leaking synthetic payloads that don't look like XML, extend the predicate —
both consumers pick it up together.

## What signal to collect before the next tuning round

Run 1–2 weeks on clean data, then read:

- **Hit rate per capability** — `used`-after-suggested over rendered
  suggestions only. This is now a real number; before hygiene it wasn't.
- **Decayed-but-relevant** — capabilities repeatedly suggested at high
  confidence and never adopted. These are candidates for *escalation up the
  adoption ladder* (see below), not for more suggesting.
- **Pull-to-used conversions** — validates whether route() output ordering
  matches what actually gets acted on.

## The adoption ladder (deferred, designed)

Getting a model to use a capability instead of its trained instinct is the
same problem as getting a person to adopt a new tool. Mechanisms, weakest to
strongest:

1. Static docs (CLAUDE.md mention) — forgotten mid-task.
2. Push suggestion with exact invocation syntax — what this router does;
   bare pointers were verified live to never get acted on (actionDirective's
   origin comment).
3. Post-hoc nudge — postTool's "you just did X by hand, tool Y covers it."
4. PreToolUse interception (RTK-style rewrite/deny-with-reason) — changes
   the default instead of asking for cooperation. Only appropriate for 1:1
   instinct replacements (grep→rg), and must stay fail-open.
5. Removing the old path — brittle; avoid.

First-use experience gates everything: a capability that is slow or broken
on first invocation (the 67–108s dense cold-load fixed in f99b4df) teaches
the model within one session to avoid it. Keep first-use fast before asking
for adoption.

The trust loop's decayed-but-relevant list is the input that decides which
capabilities earn escalation from rung 2 to rung 4.
