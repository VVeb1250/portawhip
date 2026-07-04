# Router research: RAG, embeddings, and graph retrieval

Date: 2026-07-04

Purpose: decide whether to keep optimizing the current keyword router or pause
and design the next routing layer from retrieval research first.

## Local constraints from VISION.md and PLAN.md

- Precision beats recall. The default output must be silence (`[]`) below a
  confidence bar.
- No daemon unless a proven gap demands it.
- No hardcoded decision logic. Curated metadata is OK; bespoke if/else routing
  is the failure mode from v1.
- One core scorer must serve pull mode (`route()`) and future push adapters.
- Phase 4 already allows an optional embedding rerank, but the current evidence
  suggests a smaller Phase 2.5 should land before push mode so the hook does not
  inherit a weak retriever.

## Research takeaways

Capability routing is closer to tool retrieval than to simple keyword matching.
The relevant literature points to a retriever-first architecture:

- RAG works because the model can consult explicit, updateable external memory
  instead of relying only on parametric knowledge:
  https://arxiv.org/abs/2005.11401
- Gorilla shows that API/tool use improves when the model is paired with a
  document retriever, especially as API docs change:
  https://arxiv.org/abs/2305.15334
- ToolLLM scales tool use with a neural API retriever over 16k+ real APIs:
  https://arxiv.org/abs/2307.16789
- Tool retrieval remains hard because user instructions and tool descriptions
  are misaligned; iterative feedback from the usage model improves retrieval:
  https://aclanthology.org/2024.findings-emnlp.561/
- Dense-only retrieval is not enough for this repo. Capability names such as
  `database-migrations`, exact CLI names such as `ripgrep`, and phrases such as
  "zero-downtime migration" need sparse lexical matching too. RRF is a simple
  no-training way to fuse sparse and dense ranks:
  https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf
- BGE-M3 is interesting later because it supports dense, sparse, and
  multi-vector retrieval, plus multilingual prompts:
  https://arxiv.org/abs/2402.03216
- GraphRAG is useful when baseline RAG fails to connect related facts across a
  corpus:
  https://microsoft.github.io/graphrag/
- For tool routing specifically, Graph RAG-Tool Fusion argues that vector
  retrieval misses structured tool dependencies; graph traversal can recover
  dependent/neighbor tools:
  https://arxiv.org/abs/2502.07223

## Recommendation

Do not keep piling heuristics into `core/scorer.mjs` beyond obvious fixes.
Instead add **Phase 2.5: Hybrid Capability Retrieval** before Phase 3 push
adapters.

The router should become a conservative cascade:

1. Normalize the query into a short task summary.
2. Retrieve candidates with sparse lexical search over capability documents.
3. Retrieve candidates with dense embeddings when an embedding index exists.
4. Fuse ranks with RRF.
5. Expand only high-confidence candidates through a small capability graph.
6. Apply calibrated thresholds and return either top-k pointers or `[]`.

This keeps the current "silent by default" principle while improving recall for
phrases that do not exactly match hand-authored triggers.

## Capability document

Index one compact document per capability:

```text
id:
type:
pointer:
origin:
host/provider:
description:
triggers:
skill frontmatter:
headings:
related links:
examples:
negative hints:
```

The document should come from installed sources: `recipe.yaml`, MCP server
metadata, `agent-skill-manager list --json`, and skill frontmatter/headings.
Do not read full skill bodies into prompts; store them only for indexing.

## Capability graph

Use a project-local JSON graph first, not Neo4j.

Nodes:

- capability
- host
- provider/plugin
- topic/entity
- command/tool name

Edges:

- `same_provider`
- `installed_on`
- `related_skill`
- `mentions`
- `requires`
- `alternative_to`
- `used_after`
- `ignored_after`

Graph use should be bounded:

- Run graph expansion only after lexical/dense retrieval finds seed candidates.
- Boost direct dependency and related-skill neighbors.
- Penalize historically ignored neighbors.
- Never let graph expansion create a match when the base retriever returned no
  plausible seed.

## Evaluation gate

Create `docs/router-eval-set.jsonl` before implementation.

Metrics:

- precision@1 on should-route prompts
- recall@3 on should-route prompts
- MRR for ranked candidates
- abstain accuracy on should-not-route prompts
- false-positive count on old noisy-hook prompts
- average output token cost

Initial pass bar:

- 5/5 existing Phase 2 positive prompts correct at rank 1
- 3/3 existing negative prompts abstain
- 10 new hard negatives abstain
- no regression for curated `context7`, `ripgrep`, and `anthropic-skills`

## Implementation sequence

1. Fix live discovery reliability first. The current CLI path can silently lose
   auto-discovered skills if `agent-skill-manager` discovery fails, which makes
   pull/push behavior diverge.
2. Add the eval set and a CLI command such as `node core/router-cli.mjs eval`.
3. Add `core/capability-docs.mjs` to build compact documents from the registry.
4. Add sparse retrieval with an existing maintained JS library if possible.
5. Add optional embedding index behind config; if missing, degrade to sparse.
6. Add RRF fusion.
7. Add graph expansion as a small JSON adjacency layer.
8. Only then install push hooks.

## Avoid for now

- Pure embedding top-k as the push hook. It will route semantically plausible
  but operationally wrong skills.
- LLM classifier per prompt. It violates the current cost/latency posture.
- Neo4j or a GraphRAG daemon. The graph needed here is small and local.
- Training a custom retriever before there is feedback data.

