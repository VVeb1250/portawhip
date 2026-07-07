# Intent-gate bake-off (2026-07-07)

## Why

Stage 1 of the router re-architecture (decision layer, not a search engine)
was framed as "add an intent gate": decide whether a prompt is a capability
**request** vs talk **about** the capability domain (research / reflect /
meta), and abstain on the latter. Motivating live false positive found this
session:

```
"research MCP availability and live precision for dynamic tools and skills
 and future agents"  ->  build-mcp-server, build-mcp-app  (confidence 1)
```

Before building a gate, we compared the candidate mechanisms empirically
rather than picking one by intuition. **The headline result: the cheapest
mechanism won, and no dedicated intent gate was built.**

## Mechanisms compared

- **B — vocab-fix.** Not an intent classifier at all: add the capability
  system's own vocabulary (`mcp`, `cli`, `capability` - joining the
  already-present `tool`/`skill`/`agent`/`hook`/`router`) to
  `core/hybrid-router.mjs`'s `BROAD_TERMS`. A candidate matched ONLY through
  these words is suppressed by the existing `weakKeywordOnly` mechanism.
  Model-free, works on every tier.
- **C — heuristic gate.** Multilingual (EN+TH) keyword lists for
  request-markers ("use", "run", "convert", "ใช้", "แปลง"...) vs meta-markers
  ("research", "reflect", "how does", "วิจัย", "อธิบาย"...). Model-free.
- **D — dense-anchor zero-shot.** Embed the prompt with BGE-M3, cosine to a
  set of anchor phrases for "request" vs "meta" intent (EN+TH), classify by
  which set is closer. Needs the model (MCP/CLI tier only), ~48ms/query.

## Method

A labeled EN+TH prompt set (route vs abstain), split into a **tuned** portion
(seen while authoring the heuristic markers / dense anchors) and a
**held-out** portion. The held-out accuracy is the only number worth trusting
- the tuned number flatters whatever was tuned to it. A third, **fresh**
validation set (topics unrelated to any anchor: compression, deployment,
translation, GC, monorepos, unix history...) was written *after* freezing the
dense anchors, to catch overfitting the first held-out set couldn't.

## Results

| mechanism | all | held-out | fresh held-out | FP | miss | Thai | speed |
|---|---|---|---|---|---|---|---|
| **B — vocab-fix** | 81% | **73%** | (n/a - retrieval-level) | 3 | 2 | 82% | free, all tiers |
| C — heuristic | 78% | **45%** | - | 2 | 4 | 82% | ~0ms |
| D — dense-anchor (cls, sparse anchors) | 78% | **55%** | - | 6 | 0 | 73% | 48ms/q |
| D2 — dense-anchor (mean pool, rich anchors) | 100%* | 100%* | **83%** | 0-2 | 0-1 | good | 48ms/q, MCP/CLI only |

\* D2's 100% on the first held-out set was partly overfit - the anchors were
written knowing that set's failures. On a genuinely fresh set it scored 83%,
still clearly ahead of B but not flawless. The remaining errors are on
inherently ambiguous prompts ("walk me through the history of unix", "เล่า
ประวัติ rust" - informational content in imperative phrasing).

### What each result taught us

- **The heuristic's 100%-on-tuned collapsed to 45% held-out.** Keyword lists
  do not generalize and are structurally English-biased. Dead end.
- **First dense-anchor (cls pooling, terse anchors) was noisy** - 6 FP,
  classing meta as request. Anchors too coarse.
- **Mean pooling + many diverse anchors (D2) fixed it** - clean margin
  separation (routes positive, meta negative), 83% on fresh data.
- **B, which does not classify intent at all, is the most robust cheap
  option** - it fixes the actual mechanical cause (meta-vocabulary retrieval
  noise) instead of guessing abstract intent, and generalizes better than the
  tuned heuristic. Consistent with ToolRet
  (https://arxiv.org/abs/2503.01763): embedding models underperform at
  aligning query intent with tools.

## Decision

**Ship B. Do not build a dedicated intent gate yet** (prove-the-gap
discipline - VISION.md). B fixes the one real, deterministic live FP, keeps
`router-cli eval` at precision@1 / recall@3 / abstain-accuracy all 1.0, works
model-free on every tier (including the push hook, which cannot load a model),
and beat both dedicated gates on held-out data.

D2 is a **proven, ready-to-integrate design held in reserve.** Revisit it when
real usage surfaces false positives that B does not catch - at which point the
integration is turnkey: it beat B on fresh data (83% vs 73%), generalizes, and
is multilingual. Integration notes for that day:

- MCP/CLI tier only (needs BGE-M3 warm - reuse `warmDense` from
  `core/dense-embedder.mjs`). The push hook keeps B alone.
- Use it as a **safe gate, not a hard one**: tune the decision margin so it
  never abstains on a real request (miss=0; at margin -0.04 it caught clear
  meta with zero false-abstains), and let retrieval + B handle the rest.
  A false "abstain" that blocks a genuine request is worse than a pass-through.
- Mean pooling, normalized. The winning anchor sets:

Request anchors (EN+TH):
```
convert this file to another format
run the test suite on my project
take a screenshot of this page
search the web for information
extract the data from this document
open the browser and click the button
download and install the dependencies
แปลงไฟล์นี้เป็นอีกฟอร์แมต / รันเทสในโปรเจกต์ / ถ่ายภาพหน้าจอหน้านี้ / ค้นเว็บหาข้อมูล
```

Meta anchors (EN+TH):
```
how does this system work internally
reflect on and evaluate this design decision
compare two different approaches or options
is this design a good idea or not
this component seems slow or broken lately
explain the concept behind this technique
what is the difference between these two things
research and analyze a topic to understand it
ระบบนี้ทำงานภายในยังไง / วิเคราะห์และประเมินการออกแบบนี้ / เปรียบเทียบสองแนวทางว่าอันไหนดีกว่า /
อธิบายแนวคิดเบื้องหลังเทคนิคนี้ / อยากรู้ความต่างระหว่างสองสิ่งนี้
```
