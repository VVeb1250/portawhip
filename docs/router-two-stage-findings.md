# Two-stage retrieval (MCP-Zero) on this registry: measured, negative

**Verdict: do not adopt.** Hierarchical two-stage retrieval costs 14.8 points of
top-3 at the paper's own settings, and every point of the loss is caused by the
narrowing itself, not by the implementation. The code is kept behind
`engine: "two-stage"` (off by default) so this result stays reproducible.

Companion to [router-eval-holdout.md](router-eval-holdout.md), whose numbers
this work reproduces independently, and [recognition-router.md](recognition-router.md),
whose F1/F2/F3 vocabulary it uses.

## What was tested

[MCP-Zero](https://arxiv.org/abs/2506.01056) (arXiv 2506.01056) gets its recall
from searching a hierarchy instead of a flat pool: match the SERVER first (308
of them), then only the tools inside the top 5 — 2,797 tools narrowed to ~45
candidates. The model states its need as two separate intents, `server:` and
`tool:`, and each is matched at its own level.

The port is in `core/router/two-stage-router.mjs` and `core/router/capability-family.mjs`.

One thing had to be invented. MCP-Zero's hierarchy is **given by its data** — an
MCP tool belongs to exactly one server, stated in the registry. This registry has
no such level. Install namespace is not a substitute: `ecc:` alone carries 300+
skills spanning React review, freight logistics and PubMed search. So stage 1
clusters the capabilities' own embeddings (seeded k-means over BGE-M3 vectors,
deterministic so an A/B is meaningful) into 50 semantic families of ~8 members.

MCP-Zero's rerank, `(server_score * tool_score) * max(server_score, tool_score)`,
was deliberately **not** ported. Both of its inputs are cosines on one 0..1
scale. Here stage 2 is minisearch, whose scores run in the hundreds and are what
every threshold in `router.config.yaml` is calibrated against. The family score
enters through `factors` instead — the multiplicative seam the router already
has — so the existing bars keep meaning what they were measured to mean.

## How it was measured

Not with `docs/router-eval-set.jsonl`. That set reports precision@1, recall@3,
MRR and abstain accuracy all at 1.0 — 38 cases, written by the router's author,
over the author's own capabilities. It cannot referee a retrieval change because
it has no headroom to show one.

`docs/router-blind-set.jsonl` (new) follows the holdout method: 120 prompts over
6 domains, 60 EN / 60 TH, written by agents with **no access to this repo**, then
labelled by **different** agents who were given the capability list but never the
router's output and were told "none" is frequently the correct label. 72
actionable, 48 hard negatives that reuse the actionable prompts' vocabulary. Of
the 72, 61 have an installed answer and 11 are real requests nothing installed
fits.

It reproduces the holdout closely enough to trust: **top-3 49.2% here vs 49%
there; top-1 29.5% vs 27.5%.**

```
node core/router/router-cli.mjs blind                  # both engines
node core/router/router-cli.mjs blind --engine hybrid
node core/router/router-cli.mjs loo                    # leave-one-out, no labels
```

## Result 1 — at the paper's settings it is a clear regression

Pull path, distilled queries, 61 answerable cases.

| | flat (`hybrid`) | two-stage, top-5 |
|---|---|---|
| top-1 | **29.5%** | 21.3% |
| top-3 | **49.2%** | 34.4% |
| top-5 | **59.0%** | 34.4% |
| MRR | **0.456** | 0.303 |
| miss | **41.0%** | 65.6% |
| stage size | 4.20 | 2.34 |
| noise on unanswerable | 100% | 54.5% |

The noise column is the only one that improves, and it improves for an
uninteresting reason: two-stage returns roughly half as many candidates. Raising
a threshold buys the same thing without a clustering build and a dense model
call.

## Result 2 — stage 1 is the ceiling, and it is too low

Share of answerable cases whose labelled capability is anywhere inside the
selected families — the hard ceiling on anything stage 2 can do:

| topFamilies | stage-1 recall | pool |
|---|---|---|
| 1 | 24.6% | 13/453 |
| 3 | 54.1% | 39/453 |
| **5** (paper's setting) | **62.3%** | 63/453 |
| 10 | 83.6% | 123/453 |
| 20 | 98.4% | 232/453 |
| 30 | 100% | 326/453 |

At the paper's setting, 37.7% of the answers are discarded before stage 2 runs
at all. And the ceiling that buys — 62.3% — is barely above what flat retrieval
already delivers at top-3 (49.2%). There is no headroom to win.

Reaching a safe stage-1 recall costs the narrowing. 98.4% requires keeping
232 of 453 capabilities; 100% requires 326. At that point nothing has been
narrowed, and the dense model call and clustering build have bought nothing.

## Result 3 — the control: the loss IS the narrowing

`topFamilies=50` selects every family, so the pool is the full corpus.
`familyStrength=0` disables the score factor. Two-stage then reduces to flat
routing with extra steps, and it should be bit-identical. It is:

| topFamilies | pool | top-1 | top-3 | top-5 | MRR | miss |
|---|---|---|---|---|---|---|
| 5 | 63/453 (14%) | 21.3% | 34.4% | 34.4% | 0.303 | 40 |
| 30 | 326/453 (72%) | 24.6% | 42.6% | 54.1% | 0.403 | 28 |
| **50** | **453/453 (100%)** | **29.5%** | **49.2%** | **59.0%** | **0.456** | **25** |
| flat `hybrid` | 453/453 | 29.5% | 49.2% | 59.0% | 0.456 | 25 |

The last two rows match to every digit. So the implementation is not the
problem: with no restriction it is exactly the baseline. Performance then
degrades **monotonically with how much of the corpus is withheld**. On this
registry, narrowing is strictly a cost.

## Why it works there and not here

MCP-Zero's server level is a fact about its data, authored by the people who
built each server: every tool inside `github` really is about GitHub. Its stage 1
is therefore matching against a boundary that a user's phrasing genuinely
respects — "push my branch" is about GitHub in the same sense the server is.

An embedding cluster is a boundary drawn by cosine geometry over 453 short
descriptions. It groups things that are *worded* alike, which is not the same as
things a user's request will *reach for* together. The clusters are real — they
are coherent to read — they simply are not the axis along which requests
partition. So the narrowing throws away the answer 37.7% of the time at the
setting that would actually narrow anything.

A corpus of 453 is also not 2,797. MCP-Zero's 98% pool reduction is worth real
distraction savings; cutting 453 to 232 is not, especially when the top-5 the
model actually sees is unchanged either way.

## What the same measurements say to do instead

The blind set diagnoses the two failures worth attacking, and neither is a
hierarchy problem:

1. **Abstention, not retrieval.** `noiseOnUnanswerable` is **100%** — on all 11
   prompts that are genuine requests with no installed answer, the router
   returns something anyway. That is the noise a user actually feels on the pull
   path, and no amount of retrieval work touches it. The router has no "nothing
   fits" signal; it always returns its top-k above the bar.

2. **Paraphrase, not pool size.** `loo` (leave-one-out, each capability queried
   with its own description) scores recall@1 0.882 / recall@3 0.900 over 442
   capabilities. Given the document's own vocabulary the router finds it almost
   every time; given a user's words it finds it 49% of the time. The gap is
   wording, not corpus size or ranking machinery.

`falsePositiveOnDiscussion` is **0%** on the pull path in every configuration
tested, which confirms the holdout's finding that the assistant's distillation
gate already solves group-B abstention. Raw prompts are a different story — 79%
fire rate — but those are the push hook's problem, not `route()`'s.

Result 4b of [router-eval-holdout.md](router-eval-holdout.md) already measured
the intervention that addresses both: hand the model 5 candidates at a low bar
and let it pick — 60.8% hit rate and 20/20 noise rejected. That remains unbuilt,
and it is worth more than anything retrieval-side until it exists.

## Reproducing

```
node core/router/router-cli.mjs blind --engine hybrid
node core/router/router-cli.mjs blind --engine two-stage
node core/router/router-cli.mjs blind --engine two-stage --topFamilies 50 --familyStrength 0   # control
```

The family cache (`.hp-state/capability-families.json`) rebuilds automatically
when the capability set changes. Two-stage degrades to flat routing whenever the
dense model is unavailable, so it is never worse than baseline by virtue of its
own dependencies being missing.
