# WS-A mode differentiation — verification

Date: 2026-07-11

## Outcome

WS-A is implemented above the retrieval engines. `core/hybrid-router.mjs` and
the keyword scorer keep their candidate scores, ordering, tiers, and actions.

- Push is silent by default because a raw prompt has no reasoned intent signal.
- `PORTAWHIP_PUSH_MODE=legacy` is the explicit rollback path.
- Pull tool/instruction contracts ask the agent for only the positively
  requested action and direct object, excluding background, rejected, and
  negated candidate actions.
- Trigger-coverage evidence is attached after retrieval as advisory metadata.
  It records provenance, token-overlap method, coverage, and mode; it cannot
  gate eligibility by itself.
- Pull feedback no longer persists the reasoned task summary.
- Tracked AGENTS/CLAUDE/GEMINI instruction blocks are upgraded, and relinking
  an old marker block is tested as idempotent.

## Evidence

- Full unit/integration suite: `197/197` passed after the final mode-aware
  eval and feedback-isolation changes.
- Public hook tests cover both named raw-prompt false positives: silent output
  and no suggestion event.
- Public MCP tests cover two reasoned meta-discussion summaries (abstain) and
  one actionable import/sync summary (`portawhip` routes).
- Hybrid and keyword invariance tests deep-compare engine results after
  stripping only the additive `intentEvidence` field.
- Mode-aware eval separates delivery behavior from candidate-engine
  characterization. The two named false positives are `0/2` at delivery.
- Dense hybrid eval passed: precision@1, recall@3, MRR, and abstain accuracy
  are all `1.0`; false positives `0`. One mutable-corpus case was explicitly
  skipped because neither expected CLI (`markitdown`/`pandoc`) is installed.

## Known boundary

Reasoned-summary routing is a best-effort contract, not a semantic guarantee.
A summary that repeats merely discussed or negated capability-domain terms can
still retrieve those capabilities because WS-A deliberately adds no runtime
classifier and changes no retrieval engine. The instruction contract reduces
this failure mode by routing only the positively requested action. A stronger
guarantee requires a separately justified intent/state policy, not more
retrieval threshold tuning.
