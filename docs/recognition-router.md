# Recognition router: detailed architecture (2026-07-15 proposal)

Redesign of the routing pipeline around one thesis: **the router's job is
recall and staging; the final pick belongs to the model.** The router never
tries to out-judge the model — it builds a stage small enough to have no
distractors and complete enough to never miss, then gets out of the way.

Status: design, not yet built. Companion to
[router-intelligence.md](router-intelligence.md) (2026-07-09 trust-loop
overhaul) — everything there stays true; this layers on top of it.

## 1. The three failure modes

Every routing bug users actually feel is one of these:

- **F1 — miss.** The right capability exists but the threshold dropped it, or
  its doc never matched the query's vocabulary. The model proceeds bare-handed
  and the capability may as well not be installed. (The "bare-name = dead"
  finding: an entry whose doc is just its id is unreachable by any natural
  query.)
- **F2 — distraction.** Too many candidates, or wrong ones, reach the model.
  This is not a soft cost: shown-tool count measurably degrades the model's
  own selection accuracy (see §3, BoR numbers). Returning nearest-neighbors
  below real confidence is F2 in disguise.
- **F3 — fatigue.** The channel repeats itself or wastes the model's context,
  the model habituates, then *abandons the channel entirely* — stops calling
  `route()`, skims past push hints, and every capability behind the router
  goes dark at once. This is the worst failure because it is silent,
  compounding, and survives fixing F1/F2 later (trust doesn't come back on
  the next release). Clinical decision-support literature calls it alert
  fatigue; our own 2026-07-09 audit measured a 22/26 ignore rate — exactly
  that regime.

F1 and F2 trade off inside the retrieval stage. F3 is different: it is a
*presentation and etiquette* failure, and no retrieval quality fixes it.
Hence the architecture separates retrieval (stages R1–R4) from presentation
(stage R5) and gives presentation its own invariants (§7).

## 2. Design thesis

Why "shortlist + model recognition" can beat "dump everything":

A model given the full catalog does retrieval-by-attention: it reads every
description and recognizes the fit. That works because *recognition over rich
descriptions* is what models are good at — not because seeing 600 entries
helps. The catalog costs tokens every turn and the extra entries are pure
distractors. A router that reproduces the same recognition step on a 3–7
entry stage keeps the part that works and deletes the part that hurts.

So the split is:

| Concern | Owner | Optimized for |
|---|---|---|
| Don't miss (recall) | router stages R1–R3 | recall, cheap |
| Right-size the stage | router stage R4 | adaptive k |
| Don't annoy (presentation) | router stage R5 | token budget, dedup, tone |
| Final pick (precision) | the model, in-context | recognition over rich descs |
| Learn from outcomes | feedback loop R7 | trust calibration |

## 3. Evidence

- **Anthropic Tool Search Tool** (production, Nov 2025): deferring all tool
  definitions and letting the model search on demand — i.e. shortlist +
  recognition instead of upfront dump — improved MCP-eval accuracy for
  Opus 4 from 49% → 74% and Opus 4.5 from 79.5% → 88.1%, while cutting
  context ~85%. The dump was *hurting* accuracy, not just cost.
  <https://www.anthropic.com/engineering/advanced-tool-use>
- **Bits-over-Random / adaptive shortlist depth** (arXiv 2605.24660): shown
  tools act as distractors. Adaptive K≈2.2 gave 93.1% tool-selection accuracy
  vs 87.1% at fixed K=5 (Claude Sonnet 4.6); the ideal depth ranges ~2.5 on
  easy queries to ~6.9 on hard ones. Fixed k is wrong in both directions.
  <https://arxiv.org/html/2605.24660v1>
- **HippoRAG** (NeurIPS 2024): retrieval modeled on human memory —
  knowledge graph + Personalized PageRank as spreading activation — beats
  flat vector retrieval by up to 20% on multi-hop tasks. Validates the
  "route like a brain, not like a search box" framing of §4.
  <https://arxiv.org/abs/2405.14831>
- **Alert fatigue** (CDSS literature + our own 2026-07-09 audit, see
  router-intelligence.md): advisory channels with high override rates don't
  just waste the overridden alerts — the reader stops reading all of them.

## 4. Human-memory model (the intuition behind each stage)

People don't scan their full skill inventory per task; the mapping below is
what each mechanism buys us and where it lands in the pipeline:

| Human mechanism | What it does | Pipeline stage |
|---|---|---|
| Recognition over recall | picking from seen options beats generating from nothing | R6 (model pick) |
| Limited attention | more options = worse choices | R4 (adaptive k) |
| Spreading activation / priming | related context pre-activates neighbors | R2 (PPR on capability graph) |
| Habit strength (ACT-R base-level) | recently/frequently used → surfaces first | R3 (activation) |
| Working memory | you don't re-tell yourself what you just heard | R5 (session working-set) |
| Deliberate search (System 2) | when unsure, you go look | pull mode, iterative |
| Prospective memory | "when X happens, do Y" | push hooks (exists) |
| Metacognition | knowing that you don't know | abstain (exists) |
| Exception memory | "…but never when Z" | negative triggers, checked at R6 |

## 5. Pipeline

```
query + context
  R0 intake      prompt hygiene, synthetic-prompt filter          (exists)
  R1 recall      sparse triggers + dense embeddings, RRF, lanes   (exists — retune for recall)
  R2 spread      personalized PageRank over capability graph      (extend graphBoost)
  R3 activate    × base-level activation from usage history       (extend factors)
  R4 gate        adaptive k from score distribution               (extend peakedness gate)
  R5 emit        session-aware output compiler                    (NEW)
  R6 recognize   model picks / abstains, in-context               (contract change)
  R7 feedback    outcomes → activation update                     (exists — feedback.mjs)
```

### R1 — recall (exists: scorer.mjs, dense-embedder.mjs, hybrid-router.mjs)

Unchanged mechanics; changed tuning target. Today's thresholds serve
precision because the router's output *is* the verdict. Once R4–R6 exist,
R1's only job is "the right answer is somewhere in the candidate pool" —
thresholds loosen, and precision is recovered downstream by the gate and the
model. Prerequisite (biggest single lever, no code): every entry's doc
upgraded from a bare description to a **trigger-spec** — positive trigger
phrases in the vocabulary of real requests, plus negative "skip when …"
clauses. Retrieval only sees the positive side; the negative side rides along
to R6 where the model can honor conditionals embeddings can't encode.

### R2 — spread (extends graphBoost, hybrid-router.mjs)

Replace the flat `graphBoost` constant with Personalized PageRank over the
existing capability graph, HippoRAG-style: source nodes = R1 hits **plus
ambient context** (project stack via stack-detect, capabilities used earlier
this session), a few damped iterations, scores added as a boost channel.
This is what lets "trace callers of this function" activate `codegraph` even
when no trigger literally matches — a neighbor it co-occurs with did.

### R3 — activate (extends factors / computeFactors)

Today's trust factor is a streak-based 0.5×–2.0× multiplier. Extend toward
ACT-R base-level activation: `B_i = ln Σ t_j^{-d}` over the capability's use
timestamps — frequency and recency in one term with natural decay. Habitual
capabilities float; stale ones sink back to neutral instead of holding a
permanently earned boost. Feed from the same feedback log; respect the same
credit rules (pull = boost-only) established 2026-07-09.

### R4 — gate (extends the peakedness gate)

Today peakedness answers "is the top hit clearly ahead?" (ratio 1.05).
Generalize to choosing **k per query** from the score distribution:

- one dominant hit → emit 1 (direct answer, model just confirms)
- a cluster of comparable scores → emit the cluster, cap ~5 (recognition set)
- flat/low everywhere → emit 0 (abstain) — never pad to k with weak hits

This is the BoR result operationalized: depth follows ambiguity. The
existing `k` config becomes a ceiling, not a target.

### R5 — emit (NEW: session-aware output compiler)

The anti-fatigue layer. Everything R4 passes goes through a per-session
working-set ledger before serialization. Per capability, the ledger tracks
`{firstSuggestedTurn, timesSuggested, used, lastState}` and the compiler
picks an output state:

| State | When | Output shape | ~tokens |
|---|---|---|---|
| `fresh` | first suggestion this session | id, kind, one-line how_to_use, pointer, trigger-spec essentials | 40–80 |
| `reuse` | suggested before, or already used this session, and relevant again | `{id, state:"in_context", note:"already available — reuse it"}` | 10–15 |
| `mute` | suggested ≥2× this session, never used | omitted from output entirely | 0 |

Rules:

- The full payload for a capability is emitted **at most once per session.**
  Every later surfacing is a `reuse` nudge or silence. (This is the "don't
  re-tell the model what's already in its context" rule — repetition doesn't
  just waste tokens, it trains the reader to skim.)
- `mute` is **presentation-only.** On pull, a muted capability logs nothing
  negative (pull stays boost-only per the 2026-07-09 rules); the mute exists
  to protect the channel, not to punish the capability.
- A `used` capability that matches again is a `reuse` — this is the cheap
  "you already have this loaded, use it again" reminder, not a re-pitch.
- Ledger storage: the MCP server is already a fresh process per session, so
  pull keeps an in-process Map. Push hooks spawn per event, so the push side
  keeps its existing on-disk `sessionSuggestedCounts` mechanism; step 6 in §9
  unifies both onto one session-ledger module keyed by the host's session id
  (fall back to process-lifetime when no id is available).

### R6 — recognize (contract change, not code)

`route()`'s result stops being a verdict and becomes a **recognition set**:

- exactly one `fresh` hit → same compact answer as today (fast path — the
  System-1 case, nothing to deliberate)
- 2–5 candidates → each carries enough trigger-spec (positive + negative
  clauses, ≤2 lines) for the model to pick in-context; the payload says
  "candidates — pick or ignore," never "use this"
- abstain → today's `{status:"empty", reason}` stays; near-misses remain
  available under `explain` for debugging, not in the default payload

### R7 — feedback (exists)

Unchanged credit rules. New signals worth logging for §8's metrics:
`reuse`-state emissions (did the model act on a reuse nudge?) and per-session
`route()` call counts (the abandonment early-warning).

## 6. Push vs pull (unchanged asymmetry, restated)

Everything in §5 applies to both channels, but the bars stay asymmetric per
router-intelligence.md: push interrupts, so it emits only `fresh` hits above
`pushMinConfidence` (0.75) or required-tier, and its repeat ladder
(full → terse → silent) is subsumed by the R5 states (fresh → reuse → mute).
Pull is solicited, so it is recall-generous and never converts non-use into
decay. The R5 ledger is shared so a capability pushed at turn 1 and pulled at
turn 9 correctly arrives as `reuse`, not as a second full pitch.

## 7. Router etiquette invariants

The F3 contract. These are non-negotiable properties of the output channel,
enforceable by tests over the emit layer:

- **E1 — silence is a valid output.** Abstain over guess, always. (VISION.md
  principle, already load-bearing in scorer.mjs.)
- **E2 — never repeat a full payload within a session.** Fresh once, then
  reuse-nudges or silence. Testable: no `(session, id, fresh)` twice.
- **E3 — declarative, never imperative.** "X exists; does Y; skip when Z" —
  the router informs, the model decides. No "you MUST", no scolding after a
  decline. An unused suggestion is data for R7, never grounds to re-suggest
  louder (that's the nagging→reactance spiral).
- **E4 — hard output budget.** Push injection ≤ ~150 tokens; pull response
  ≤ k_adaptive entries × ≤2-line descs. Budget overruns drop lowest-scoring
  candidates, never compress descriptions into mush.
- **E5 — push is precision-first, pull is recall-first.** (2026-07-09,
  unchanged.)
- **E6 — interrupt only at boundaries.** Push fires on user_prompt only —
  never mid-task-flow where switching cost exceeds hint value. (Already
  true; stated so it survives future channel additions.)
- **E7 — the channel measures its own health.** Follow-rate, repeat-rate,
  and abandonment (§8) are first-class metrics, reviewed before any
  retrieval tuning. A router that can't tell it's being ignored is already
  dead — it just doesn't know it yet.
- **E8 — cheap to call, cheap to ignore.** Pull latency stays interactive
  (dense never blocks; sparse-first answer), and ignoring any suggestion
  costs the model zero tokens of justification.

## 8. Metrics and rollout gates

Extend router-eval + feedback log; all measured offline/shadow first:

| Metric | Definition | Healthy | Alarm |
|---|---|---|---|
| follow-rate | suggested → used within N turns, per channel | rising | falling while suggestions rise |
| repeat-rate | `(session, id)` suggested full-size >1× | ~0 by construction | >0 (E2 regression) |
| abandonment | `route()` calls per session, trend across sessions | stable/rising | monotone decline — the model is giving up on the channel |
| stage size | mean/median emitted k | ~1–3 | drift toward ceiling k |
| token cost | tokens per emission, per channel | within E4 budget | creep |
| miss audit | tasks where a fitting capability existed but never surfaced | rare, explained | recurring same-capability misses (doc problem, fix trigger-spec) |

Rollout: every stage lands behind the eval harness first
(`router-eval.mjs`, regression tests in
`router-precision-regressions.test.mjs` style), compared against the current
pipeline on the same query set. Live tuning waits for the trust-loop
clean-data window (1–2 weeks of post-hygiene signal per the 2026-07-09
overhaul) — R3/R4 especially must not be tuned against pre-hygiene logs.

## 9. Build order

Leverage-ordered; each step ships alone:

1. **Trigger-spec docs** (registry/enrich path). Positive phrases + negative
   clauses for every entry. No architecture change; raises R1 recall and
   gives R6 its material. The single biggest lever.
2. **R5 emit layer + E-invariant tests** (route-entry.mjs + new
   session-ledger module). Fresh/reuse/mute states on pull; fold push's
   existing mention ladder onto the same states. This is the direct fix for
   the two reported top problems (context re-dump; fatigue→abandonment).
3. **R6 contract** (route-entry.mjs compactRouteResult + tool description in
   mcp-server.mjs). Recognition-set payloads; "candidates, not commands."
4. **R4 adaptive k** (hybrid-router.mjs, generalize gateLane/peakedness).
5. **R2 PPR spread** (new module + hybrid-router boost channel).
6. **Unified session ledger** (push + pull on one store keyed by session id).
7. **R3 ACT-R activation** (feedback.mjs computeFactors) — last, because it
   needs the clean-data window and benefits from ledger signals (step 6).

## 10. Implementation handoff notes

For an implementer starting cold: read this doc, then
[router-intelligence.md](router-intelligence.md) (credit rules you must not
break) and VISION.md ("silence is a valid output"). Conventions: tests are
`node:test` files named `*.test.mjs` next to the module; config knobs live in
`router.config.yaml` (loaded via `core/state/config.mjs`); session/feedback
state lives under `.hp-state/`. The MCP server is published
(github.com/VVeb1250/portawhip) — **every payload change must be additive,
never a rename or removal.**

### Concrete payload shapes

Entry doc after step 1 (additive fields on `route`):

```yaml
route:
  description: "Codebase knowledge graph for symbols, callers, call paths."
  triggers: ["codegraph", "call paths", "who calls", "trace callers"]
  skipWhen: ["plain text search", "non-code documents"]   # NEW, optional
```

Pull response, recognition set (2–5 candidates):

```json
{
  "status": "success",
  "mode": "candidates",
  "note": "candidates — pick what fits, ignoring all is fine",
  "results": [
    { "id": "codegraph", "kind": "tool", "state": "fresh",
      "how_to_use": "Trace callers/callees over the indexed graph.",
      "skip_when": "plain text search", "pointer": "codegraph" },
    { "id": "ripgrep", "kind": "tool", "state": "reuse",
      "note": "already available this session — reuse it" }
  ]
}
```

Single dominant hit keeps today's compact shape (plus `state: "fresh"`).
Abstain keeps today's `{status:"empty", reason}` exactly. `mute` entries are
simply absent. All new keys (`mode`, `state`, `note`, `skip_when`) are
additive.

### Acceptance criteria per build step

1. **Trigger-spec docs** — every registry entry has ≥3 positive triggers in
   request vocabulary; `skipWhen` parses and survives discovery/enrich;
   existing `router-precision-regressions.test.mjs` still green; add one
   regression: a query matching a `skipWhen` phrase still *retrieves* the
   entry (negative clauses are R6 material, they must not filter R1).
2. **R5 emit layer** — new `core/router/session-ledger.mjs` +
   tests proving: (a) same id never serialized `fresh` twice per ledger
   lifetime; (b) second hit serializes as `reuse` ≤ ~15 tokens; (c) 2×
   suggested-unused → absent; (d) `mute` writes **no** feedback event on
   pull; (e) ledger reads `used` events from the feedback log so a
   capability used via hook arrives as `reuse` on the next pull.
3. **R6 contract** — `compactRouteResult` emits the shapes above; MCP tool
   description updated to say results are candidates, not commands (E3
   wording); all existing callers (router-cli, mcp-server, push hook) still
   pass their tests unchanged.
4. **R4 adaptive k** — eval harness shows emitted-k distribution ~1–3 median
   on the existing query set with no recall loss vs baseline (miss audit
   §8); `k` from config acts as ceiling only.
5. **R2 PPR** — behind a config flag, off by default; eval-harness A/B
   against `graphBoost` before flipping.
6. **Unified ledger** — push `sessionSuggestedCounts` and pull ledger read
   the same store keyed by host session id; fallback = process lifetime.
7. **R3 ACT-R activation** — only after the clean-data window; offline
   comparison against streak factors on logged outcomes before going live.

## 11. Open questions

- Session id on pull: MCP tool calls don't carry the host session id today;
  process-lifetime ≈ session holds for Claude Code but not for a long-lived
  daemon deployment. Revisit if the server ever daemonizes.
- Reuse-nudge efficacy: does a 10-token `reuse` line actually change model
  behavior vs silence? Needs an A/B on the eval harness before it earns its
  tokens (E7 applies to our own features too).
- Dense model quality: MiniLM-class CLS embeddings are the current dense
  channel; a better small embedder lifts R1 recall but is deliberately *not*
  on the critical path — doc quality (step 1) dominates encoder quality at
  this corpus size.
