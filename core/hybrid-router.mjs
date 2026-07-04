import { buildCapabilityDocs } from "./capability-docs.mjs";
import { expandWithGraph, loadCapabilityGraph } from "./capability-graph.mjs";
import { capabilityKind, matchesSuggestKind } from "./capability-kind.mjs";
import { reciprocalRankFusion } from "./fusion.mjs";
import { sparseRetrieve } from "./sparse-retriever.mjs";

function formatResult(item) {
  const doc = item.doc;
  return {
    id: doc.id,
    type: doc.type,
    kind: capabilityKind(doc.type),
    score: Number((item.score ?? item.rrfScore ?? 0).toFixed(4)),
    how_to_use: doc.description,
    pointer: doc.pointer,
    origin: doc.origin,
    readyMarker: doc.readyMarker ?? null,
    readyHint: doc.readyHint ?? null,
    engine: "hybrid",
    graphBoosted: item.graphBoosted === true || undefined,
    graphSource: item.graphSource,
    graphEdgeType: item.graphEdgeType,
  };
}

export function routeHybrid(
  index,
  prompt,
  {
    threshold = 2,
    hybridThreshold,
    hybridRecipeThreshold,
    hybridToolThreshold,
    graphPath = null,
    graphBoost = 0.25,
    k = 5,
    suggest = "any",
    factors = null,
  } = {},
) {
  const docs = buildCapabilityDocs(index);
  const autoBar = hybridThreshold ?? threshold;
  // Curated (recipe.yaml) entries need their own, much lower bar — same
  // rationale as scorer.mjs's recipeThreshold split. Confirmed empirically:
  // generic domain vocabulary ("architecture", "patterns") that's common
  // across hundreds of auto-discovered skill docs can score higher than a
  // curated entry's genuine match (react-patterns/vue-patterns out-scoring
  // ripgrep/context7 on unrelated prompts) — no single global threshold
  // separates "real auto-discovered match" from "generic-vocabulary noise"
  // AND "real curated match" at the same time.
  const recipeBar = hybridRecipeThreshold ?? Math.min(autoBar, 130);
  // Auto-discovered MCP/CLI tool entries are a third bucket, not "skills
  // with a lower bar" — their documents are just a bare name (add-mcp/mise
  // give no description), so they have almost no text to accumulate a false
  // match from generic vocabulary in the first place. Verified against the
  // full negative eval set: no mcp/cli-type entry ever scored above 0 as a
  // false positive, while real matches (bare tool name against a prompt
  // naming that tool) score far below the skill-noise ceiling that forces
  // autoBar so high. Reusing autoBar for them was silently dropping real
  // "use <tool>" matches (exa/github/playwright tools).
  const toolBar = hybridToolThreshold ?? Math.min(autoBar, 80);
  const minScore = Math.min(autoBar, recipeBar, toolBar);
  const sparse = sparseRetrieve(docs, prompt, { k: Math.max(k * 4, 20), minScore });
  if (sparse.length === 0) return [];

  const graph = loadCapabilityGraph(graphPath);
  const expanded = expandWithGraph(sparse, docs, graph, { boost: graphBoost }).map((candidate) => ({
    ...candidate,
    score: candidate.score * (factors?.get(candidate.doc.id) ?? 1.0),
  }));
  const filtered = expanded.filter((candidate) => {
    const isTool = candidate.doc.type === "mcp" || candidate.doc.type === "cli";
    const bar = candidate.doc.origin === "recipe" ? recipeBar : isTool ? toolBar : autoBar;
    return candidate.score >= bar && matchesSuggestKind(candidate.doc.type, suggest);
  });
  if (filtered.length === 0) return [];

  // Phase 2.5 starts with one retrieval channel. Keeping fusion in the path
  // makes dense embeddings and bounded graph expansion additive later.
  const fused = reciprocalRankFusion([filtered]).slice(0, k);
  return fused.map(formatResult);
}
