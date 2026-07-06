import { buildCapabilityDocs } from "./capability-docs.mjs";
import { expandWithGraph, loadCapabilityGraph } from "./capability-graph.mjs";
import { capabilityKind, matchesSuggestKind } from "./capability-kind.mjs";
import { actionAlignmentFactor } from "./concept-vector.mjs";
import { reciprocalRankFusion } from "./fusion.mjs";
import { sparseRetrieve } from "./sparse-retriever.mjs";

const BROAD_TERMS = new Set([
  "agent",
  "architecture",
  "automation",
  "build",
  "code",
  "coding",
  "context",
  "debug",
  "design",
  "develop",
  "engineering",
  "framework",
  "hook",
  "implement",
  "integration",
  "pattern",
  "project",
  "route",
  "router",
  "skill",
  "test",
  "tool",
  "workflow",
  // core/enrich.mjs (router-cli enrich) seeds MCP tool triggers from a
  // server's own tools/list — sub-tool names conventionally follow a
  // verb_noun pattern (push_files, create_pull_request, list_issues), so
  // these generic CRUD verbs are now real trigger tokens for almost every
  // enriched MCP tool. Found live: "compare push and pull routing modes for
  // an agent harness" (a router-architecture question) matched github
  // through "push"/"pull" alone with zero other overlap. Same
  // weakKeywordOnly mechanism as the rest of this list — only suppresses a
  // candidate when EVERY matched term is generic; a query that also shares
  // a tool-specific word (e.g. "push files to my github repo") still
  // passes untouched.
  "push",
  "pull",
  "create",
  "get",
  "list",
  "update",
  "search",
  "fetch",
  "add",
  "remove",
  "delete",
]);

// A lane where the top match barely beats the runner-up is diffuse-vocabulary
// noise, not a genuine pick — verified against docs/router-eval-set.jsonl's
// one remaining false positive: "what context signals should a router
// observe before injecting a skill" scores example-skill and
// skill-development within 0.3% of each other (both lit up by the same
// generic "router"/"skill"/"injecting" words), while every real match in the
// set has a clear top pick with no close runner-up. A lane with only one
// surviving candidate is never penalized (nothing to be tied with).
function dropIfDiffuse(laneCandidates, ratio) {
  if (laneCandidates.length < 2) return laneCandidates;
  const sorted = [...laneCandidates].sort((a, b) => b.score - a.score);
  const [top, runnerUp] = sorted;
  if (runnerUp.score <= 0 || top.score / runnerUp.score >= ratio) return laneCandidates;
  return [];
}

function compactReason(item) {
  const terms = (item.terms ?? []).slice(0, 5);
  if (item.graphBoosted) {
    return `graph-related to ${item.graphSource}`;
  }
  if (terms.length > 0) {
    return `matched ${terms.join(", ")} in ${Object.keys(item.match ?? {}).slice(0, 3).join(", ") || "capability text"}`;
  }
  return "matched capability text";
}

function classifyCandidate(item, bar) {
  const score = item.score ?? item.rrfScore ?? 0;
  const confidence = bar > 0 ? Math.min(1, score / bar) : 1;
  const terms = item.terms ?? [];
  const specificTerms = terms.filter((term) => !BROAD_TERMS.has(term));
  const weakKeywordOnly = terms.length > 0 && specificTerms.length === 0 && item.doc?.origin !== "recipe";

  if (score >= bar && !weakKeywordOnly) {
    return {
      tier: confidence >= 1 && item.doc?.origin === "recipe" ? "required" : "recommended",
      confidence,
      action: item.doc?.action ?? (item.doc?.type === "skill" ? "read_skill" : "use_capability"),
    };
  }

  return {
    tier: weakKeywordOnly ? "irrelevant_but_keyword_matched" : "weak_match",
    confidence,
    action: "ignore_by_default",
  };
}

function formatResult(item, bar) {
  const doc = item.doc;
  const classification = classifyCandidate(item, bar);
  return {
    id: doc.id,
    type: doc.type,
    kind: capabilityKind(doc.type),
    score: Number((item.score ?? item.rrfScore ?? 0).toFixed(4)),
    tier: classification.tier,
    confidence: Number(classification.confidence.toFixed(2)),
    why: compactReason(item),
    action: classification.action,
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
    includeWeak = false,
    peakednessRatio = 1.05,
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
    score:
      candidate.score *
      (factors?.get(candidate.doc.id) ?? 1.0) *
      actionAlignmentFactor(candidate.doc, prompt),
  }));
  const candidates = expanded
    .filter((candidate) => matchesSuggestKind(candidate.doc.type, suggest))
    .map((candidate) => {
      const isTool = candidate.doc.type === "mcp" || candidate.doc.type === "cli";
      const bar = candidate.doc.origin === "recipe" ? recipeBar : isTool ? toolBar : autoBar;
      return { ...candidate, bar };
    });
  const filtered = candidates.filter((candidate) => {
    const isTool = candidate.doc.type === "mcp" || candidate.doc.type === "cli";
    const bar = candidate.doc.origin === "recipe" ? recipeBar : isTool ? toolBar : autoBar;
    return candidate.score >= bar && classifyCandidate(candidate, bar).tier !== "irrelevant_but_keyword_matched";
  });
  if (filtered.length === 0) {
    if (!includeWeak) return [];
    return candidates.slice(0, k).map((candidate) => formatResult(candidate, candidate.bar));
  }

  // Phase 2.5 starts with one retrieval channel (core/concept-vector.mjs's
  // actionAlignmentFactor is folded into the score above, not fused as a
  // second ranking — see that file for why). Keeping fusion in the path
  // makes dense embeddings and bounded graph expansion additive later.
  //
  // Tools and skills get their own reserved k slots, not one shared slice.
  // Found live: real callers (push hook, MCP route tool, router-cli route)
  // all call with suggest:"any", so a query where BOTH a skill and a tool
  // are genuinely relevant used to have them compete for the same k slots
  // — a strong skill match could silently crowd a real tool match (or vice
  // versa) out of the result entirely, even though a task usually wants
  // both side by side (the tool to do it, the skill for how to do it well).
  const lanes = new Map();
  for (const candidate of filtered) {
    const kind = capabilityKind(candidate.doc.type);
    if (!lanes.has(kind)) lanes.set(kind, []);
    lanes.get(kind).push(candidate);
  }
  const laneWinners = [...lanes.values()].flatMap((laneCandidates) =>
    reciprocalRankFusion([dropIfDiffuse(laneCandidates, peakednessRatio)]).slice(0, k),
  );
  const fused = laneWinners.sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0) || a.doc.id.localeCompare(b.doc.id),
  );
  const routed = fused.map((item) => formatResult(item, item.bar));
  if (!includeWeak || routed.length >= k) return routed;

  const routedIds = new Set(routed.map((item) => item.id));
  const weak = candidates
    .filter((candidate) => !routedIds.has(candidate.doc.id))
    .slice(0, k - routed.length)
    .map((candidate) => formatResult(candidate, candidate.bar));
  return [...routed, ...weak];
}
