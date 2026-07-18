# MCP-Zero on this registry: adopt the contract, reject the hierarchy

Measured against [router-blind-set.jsonl](router-blind-set.jsonl) — 120 prompts
written and labelled by agents with no access to this repo. Companion to
[router-eval-holdout.md](router-eval-holdout.md), whose numbers this reproduces
independently.

**Two findings, opposite directions:**

1. **Adopt:** having the model state its need in *capability space* instead of
   *task space* is worth **+8.2 points of top-3** and removes **11.5 points of
   miss**, with no cost to abstention. This is a `route()` contract change, not
   a retrieval change.
2. **Reject:** the two-stage hierarchy is worse in every configuration tested,
   including with the split query it is designed around, and it is unstable
   under registry churn in a way flat retrieval is not.

> **Correction.** An earlier revision of this file reported stage-1 recall of
> 62.3% and framed the work as testing MCP-Zero as a whole. Both were wrong. That
> figure came from a clustering built over a corpus that changed by one
> capability mid-session and does not reproduce (see
> [Result 4](#result-4--the-hierarchy-is-unstable-under-registry-churn)). And
> only one of MCP-Zero's three components had been tested — the contract, which
> turned out to be the part that works, had not.

## What MCP-Zero actually proposes

Three components ([arXiv 2506.01056](https://arxiv.org/abs/2506.01056)):

1. **Active tool request** — the model emits a structured statement of what it
   needs, `<tool_assistant>server: … tool: …</tool_assistant>`.
2. **Hierarchical semantic routing** — match the server intent against servers,
   then the tool intent against tools inside the top few.
3. **Iterative capability extension** — repeat mid-task to build a toolchain.

The headline claim is **"98% reduction in token consumption on APIBank while
maintaining high accuracy"** — a context-cost claim, not an accuracy-improvement
claim.

**Components 1 and 3 already exist here.** `route()` is an on-demand request the
model makes when it decides it needs something, and its contract already says to
call it once per distinct action; `session-ledger` handles repeat suppression.
The token saving is likewise already banked — `route()` returns ~4 candidates out
of 453 and has never injected the full tool set into context. MCP-Zero's baseline
is a client that dumps every schema upfront. This harness was never that client.

So the only unported piece was component 2 — plus one thing that turned out to
matter far more than the hierarchy: **which space the query is written in.**

## The mismatch that matters

MCP-Zero's query is in **capability space** — it names a *kind of tool* and an
*operation*:

```
server: container workload orchestration platform administration
tool:   adjust memory limits and add a readiness health probe
```

`route()`'s contract asks for **task space** — "only the positively requested
action and its direct object":

```
bump memory limits and add a readiness probe to the checkout deployment
```

The documents being searched are written in capability space: a skill's
description says what the skill *is for*. So MCP-Zero matches capability-space
against capability-space, while this harness matches task-space against
capability-space. **MCP-Zero's real mechanism is using the model as a translator
between the two spaces before retrieval runs.** The hierarchy is downstream of
that — splitting the request into `server:` and `tool:` is what creates two
levels to search in the first place.

## Method

`docs/router-blind-set.jsonl`: 120 prompts, 6 domains, 60 EN / 60 TH. Prompts
written by agents with no access to this repo; labels applied by *different*
agents given the capability list but never the router's output, told that "none"
is frequently correct; capability-space queries (`needServer`, `needTool`,
`need`) produced by a *third* set of agents who saw only the raw prompts and were
forbidden from naming products or inspecting any registry.

72 actionable (61 with an installed answer, 11 real requests nothing fits),
48 hard negatives. All three agent groups independently agreed on which prompts
were actionable — 120/120, no disagreements.

```
node core/router/router-cli.mjs blind --engine hybrid --field distilled
node core/router/router-cli.mjs blind --engine hybrid --field need
node core/router/router-cli.mjs blind --engine two-stage --field need --split
```

## Result 1 — capability-space query is the win

Flat router (`hybrid`), unchanged code, 61 answerable cases. Only the query
changes.

| | task space (`distilled`) | **capability space (`need`)** | Δ |
|---|---|---|---|
| top-1 | 29.5% | 26.2% | −3.3 |
| top-3 | 49.2% | **57.4%** | **+8.2** |
| top-5 | 59.0% | **67.2%** | **+8.2** |
| MRR | 0.456 | **0.521** | **+0.065** |
| miss | 41.0% | **29.5%** | **−11.5** |
| stage size | 4.20 | 5.56 | +1.36 |
| FP on discussion | 0% | **0%** | — |

The 11.5-point drop in miss matches, to the point, the "not retrievable at all"
bucket measured separately in Result 2. Capability-space phrasing recovers
exactly the population it was predicted to.

**The abstention gate survives.** The feared cost — that asking "what capability
do you need" would invite the model to invent one while the user is only
venting — did not appear: false positives on discussion stay at 0%, because a
non-actionable message yields no capability statement at all and `route()` is
never called. This is what makes the change safe to ship.

top-1 drops slightly. Capability-space queries are broader, so the right answer
more often arrives at rank 2–3 rather than rank 1 — the correct trade for a
channel that returns candidates for the model to choose among.

## Result 2 — where the misses actually live

Decomposition of the 41% miss on the task-space baseline, by running the lexical
channel with no bar and no k cap to see whether the answer is reachable at all:

| | share | meaning |
|---|---|---|
| returned in top-5 | 59.0% | works today |
| **in the ranking, below the bar / outside k** | **29.5%** | findable; the router discards it |
| **not retrievable at any rank** | **11.5%** | description shares no usable vocabulary |

The unreachable cases are unambiguous once you look at them: `react-performance`
sits at rank 90 for "virtualize a 3000-row table" (its description never says
*virtualize*), `design-system` at rank 122 for "dark mode via CSS variables",
`security-reviewer` at rank 124 for "find the committed secret key".

This is why the capability-space query helps and the hierarchy does not: the
query change attacks the 11.5%, and nothing about retrieval touches the 29.5%,
which is a *selection* problem.

## Result 3 — the hierarchy loses in every configuration

| config | query | top-1 | top-3 | top-5 | MRR | miss |
|---|---|---|---|---|---|---|
| **flat** | capability | **26.2%** | **57.4%** | **67.2%** | **0.521** | **29.5%** |
| **flat** | task | 29.5% | 49.2% | 59.0% | 0.456 | 41.0% |
| two-stage, top-5 | task | 13.1% | 24.6% | 24.6% | 0.219 | 75.4% |
| two-stage, top-5, **split** | capability | 9.8% | 24.6% | 24.6% | 0.199 | 75.4% |
| two-stage, full pool (control) | task | 29.5% | 49.2% | 59.0% | 0.456 | 41.0% |

The split query — MCP-Zero's actual contract, `server:` and `tool:` matched at
their own levels — is the **worst** result measured. The reason is visible in the
stage-1 numbers: an abstract domain phrase ("container workload orchestration
platform administration") sits further from a cluster of concrete skill
descriptions than the concrete task does. Stage-1 recall at top-5 is 72.1% for
`needServer` against 75.4% for the task-space query. The abstraction that helps
flat retrieval hurts centroid matching.

**The control settles the mechanism.** With `topFamilies` set to select every
family (full pool) and `familyStrength=0`, two-stage reproduces flat routing to
every digit. The implementation is not the problem: performance degrades
monotonically with how much of the corpus is withheld. On this registry,
narrowing is strictly a cost.

## Result 4 — the hierarchy is unstable under registry churn

Between two runs in a single session the installed capability count moved by one
(453 → 452). Nothing else changed. The clustering is deterministic given a fixed
corpus — seeded k-means — but the fingerprint changed, the clusters were rebuilt,
and:

| | before | after |
|---|---|---|
| stage-1 recall @ top-5 | 62.3% | 75.4% |
| family size min/max | 1 / 25 | 2 / 32 |
| **two-stage top-3** | **34.4%** | **24.6%** |
| **flat top-3** | **49.2%** | **49.2%** |

Flat retrieval is bit-identical across the change. Two-stage moved ten points. A
registry that gains and loses capabilities — this one did so unattended,
mid-session — reshuffles every cluster boundary and the router's behaviour with
it. That is disqualifying independently of the accuracy result, and it is why the
62.3% in the previous revision of this file should not be cited.

## Why it transfers badly, in one paragraph

MCP-Zero's server level is a fact about its data, authored by whoever built each
server: every tool inside `github` really is about GitHub, and a user thinking
"push my branch" is thinking about that same boundary. This registry has no such
level — install namespace is not it, since `ecc:` alone spans React review,
freight logistics and PubMed search — so it must be invented by clustering.
Embedding clusters group capabilities that are *worded* alike, which is not the
axis along which requests partition. Add that 453 is not 2,797, so the pool
reduction that pays for MCP-Zero's context saving buys nothing here, and the
hierarchy is all cost.

## A note on MCP-Zero's own evaluation

Its needle test (`experiment_mcptools.py`) builds the model's prompt by
substituting the *target tool's own description*:

```python
user_prompt = user_prompt_template.replace("{server_description}", server_description)
user_prompt = user_prompt.replace("{tool_description}", tool_description)
```

That is leave-one-out with the document's own vocabulary — the same easy mode
`core/router/loo-eval.mjs` implements and warns about. This registry scores
recall@1 **0.882** under those conditions and **0.295** on real user phrasing.
The paper never measures the paraphrase gap, which is the gap that decides
whether a router works for anyone but its author.

## What to do

1. **Ship the contract change.** Add a capability-space field to `route()`
   alongside the existing one rather than replacing it — the task-space query is
   what keeps false positives on discussion at 0%, and that property is worth
   more than the retrieval gain:
   ```
   route({ query: "<task space, as today>",          // governs whether to call at all
           need:  "<capability space, optional>" })  // governs what is retrieved
   ```
   Worth +8.2 top-3 and −11.5 miss on this set. If `need` proves unhelpful in the
   field it can be dropped with no other change.
2. **Fix selection, not retrieval.** `noiseOnUnanswerable` is **100%** in every
   configuration tested: on all 11 prompts that are genuine requests with nothing
   installed to answer them, the router returns something anyway. Combined with
   the 29.5% of answers that are found and then discarded, this is the larger
   prize, and neither the contract nor the hierarchy touches it. Result 4b of
   [router-eval-holdout.md](router-eval-holdout.md) already measured the fix at
   60.8%.
3. **Then description and trigger vocabulary.** Worth roughly the residual 8%
   once label-stretch is discounted — but only visible after (2), since improving
   a description moves a capability from "unreachable" into the bucket the bar
   discards anyway. Beware of harvesting trigger phrases from this blind set and
   then scoring against it; that is the self-confirmation loop that makes
   `docs/router-eval-set.jsonl` read 1.0.

`engine: "two-stage"` and `core/router/capability-family.mjs` stay in the tree,
off by default, only so these numbers can be re-derived. They are not a migration
path.
