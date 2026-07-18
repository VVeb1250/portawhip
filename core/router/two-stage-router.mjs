// MCP-Zero-style two-stage retrieval (arXiv 2506.01056), ported onto this
// registry. Stage 1 picks semantic families (core/router/capability-family.mjs);
// stage 2 runs the existing, calibrated hybrid router over ONLY the members of
// those families.
//
// What is ported and what is deliberately not:
//
// - Ported: the hierarchy (coarse domain match, then fine match inside it) and
//   the split query — MCP-Zero has the model state a `server:` intent and a
//   `tool:` intent separately, and matches each at its own level. That split is
//   the actual mechanism; a single query used at both levels is a degenerate
//   case of it, supported here so the change can be measured before the route()
//   contract changes.
//
// - NOT ported: MCP-Zero's rerank, `(server_score * tool_score) * max(server_score,
//   tool_score)`. Both of its inputs are cosine similarities on one 0..1 scale.
//   Here stage 2 is minisearch, whose scores run in the hundreds and are what
//   every threshold in router.config.yaml is calibrated against. Multiplying a
//   cosine into that would silently invalidate hybridThreshold/recipeThreshold/
//   toolThreshold at once. The family score enters through `factors` instead —
//   the seam the router already uses for multiplicative per-capability
//   adjustment — so every existing bar keeps meaning what it was measured to
//   mean.
//
// The honest risk, stated up front: restricting the pool can only LOSE
// capabilities relative to flat retrieval. If a family match is wrong, the
// right answer is now unreachable at any threshold. That is the trade MCP-Zero
// takes deliberately, and `twoStageUnion` exists to measure the alternative
// rather than to hide the cost.

import { buildCapabilityDocs } from "../registry/capability-docs.mjs";
import { buildFamilies, matchFamilies } from "./capability-family.mjs";
import { routeHybrid } from "./hybrid-router.mjs";

function restrictIndex(index, allowedIds) {
  return { ...index, entries: index.entries.filter((entry) => allowedIds.has(entry.id)) };
}

// Family score -> multiplicative factor on stage-2 scores. Deliberately gentle:
// the family stage has already done its real work by choosing the pool, and a
// steep boost here would let a confident-but-wrong family override the lexical
// evidence inside it. Range is roughly 0.85..1.15 across the cosine band these
// centroids actually produce.
function familyFactor(score, { strength = 0.3 } = {}) {
  return 1 + (score - 0.5) * strength;
}

export async function routeTwoStage(index, prompt, options = {}) {
  const {
    topFamilies = 5,
    familyCount = null,
    familyPath = ".hp-state/capability-families.json",
    twoStageUnion = false,
    familyStrength = 0.3,
    serverQuery = null,
    toolQuery = null,
    denseBlock = true,
    factors = null,
  } = options;

  const stage1Query = serverQuery ?? prompt;
  const stage2Query = toolQuery ?? prompt;

  const docs = buildCapabilityDocs(index);
  const families = await buildFamilies(docs, {
    path: familyPath,
    k: familyCount,
    block: denseBlock,
  });

  // Dense unavailable, cold, or clustering failed: there is no stage 1, so run
  // exactly what shipped. Two-stage must never be worse than flat by virtue of
  // its own dependencies being missing.
  if (!families) return routeHybrid(index, stage2Query, options);

  const matched = await matchFamilies(families, stage1Query, { topFamilies, block: denseBlock });
  if (matched.length === 0) return routeHybrid(index, stage2Query, options);

  const allowed = new Set();
  const familyScoreById = new Map();
  for (const family of matched) {
    for (const id of family.members) {
      allowed.add(id);
      // A capability can only be in one family by construction, but guard
      // anyway and keep the best score if that ever stops being true.
      const previous = familyScoreById.get(id) ?? -Infinity;
      if (family.score > previous) familyScoreById.set(id, family.score);
    }
  }
  if (allowed.size === 0) return routeHybrid(index, stage2Query, options);

  const stageFactors = new Map(factors ?? []);
  for (const [id, score] of familyScoreById) {
    const base = stageFactors.get(id) ?? 1.0;
    stageFactors.set(id, base * familyFactor(score, { strength: familyStrength }));
  }

  const staged = await routeHybrid(restrictIndex(index, allowed), stage2Query, {
    ...options,
    factors: stageFactors,
  });

  if (!twoStageUnion) {
    return staged.map((hit) => ({
      ...hit,
      engine: "two-stage",
      familyScore: Number((familyScoreById.get(hit.id) ?? 0).toFixed(4)),
    }));
  }

  // Union mode: keep everything the staged pass found, then top up from flat
  // retrieval. Measures how much recall pure restriction costs — if the union
  // scores materially better than the restricted run, the family stage is
  // dropping real answers and the restriction is not paying for itself.
  const flat = await routeHybrid(index, stage2Query, options);
  const seen = new Set(staged.map((hit) => hit.id));
  const topUp = flat.filter((hit) => !seen.has(hit.id));
  return [...staged, ...topUp].map((hit) => ({
    ...hit,
    engine: seen.has(hit.id) ? "two-stage" : "two-stage-union",
    familyScore: Number((familyScoreById.get(hit.id) ?? 0).toFixed(4)),
  }));
}
