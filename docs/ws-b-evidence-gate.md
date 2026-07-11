# WS-B situation-state evidence gate

Date: 2026-07-11
Decision: **NO-GO — insufficient independent evidence**

The two known routing false positives are excluded from this decision.

## Anonymized observed data

The existing bounded feedback log contained:

- 9 total events: 3 route decisions and 6 suggestions;
- 2 push suggestions and 4 pull suggestions;
- 1 session represented in session-scoped events;
- 0 `used` events;
- 0 success, failure, blocker, completion, or tool-outcome events;
- 1 repeated capability/session pair, with two mentions — already covered by
  the existing interrupt budget;
- 0 observed suggestion-to-use conversions in either mode.

No raw prompt or query text was included in this analysis.

## Why this blocks the engine

There is no observed counterfactual where the same task needs a different
decision because a capability was already used, a blocker appeared, a tool
failed, readiness changed, or the task moved from “later” to “now.” There is
also no adoption signal to attribute. Building a state/policy engine from this
sample would encode imagined behavior rather than a proven gap.

## Revisit gate

Reconsider the first auto-observed-state slice only after the log contains:

1. multiple real sessions with stable session/request correlation;
2. observed capability use plus success/failure outcome;
3. at least one reproducible situation counterfactual not already solved by
   the interrupt budget;
4. an actionability/adoption diagnosis explaining why suggestions are used or
   ignored;
5. a held-out trajectory replay showing timing or duplicate-suppression gains
   without lowering opportunity recall and within the 2x cost ceiling.

Until then, WS-B implementation remains intentionally deferred.
