import { tokenize } from "./tokenize.mjs";

function coverageFor(trigger, queryTokens) {
  const triggerTokens = [...new Set(tokenize(trigger))];
  if (triggerTokens.length === 0) return { matchedCount: 0, totalCount: 0, coverage: 0 };
  const matchedCount = triggerTokens.filter((token) => queryTokens.has(token)).length;
  return {
    matchedCount,
    totalCount: triggerTokens.length,
    coverage: matchedCount / triggerTokens.length,
  };
}

// Authored trigger coverage is useful evidence, but the characterization
// spikes proved it cannot decide intent: a topical false positive and a real
// request can have the same coverage signature. Keep it compact, provenance-
// tagged, and explicitly advisory so downstream policy cannot mistake it for
// an eligibility gate.
export function triggerCoverageEvidence(triggers, query, { source = "unknown" } = {}) {
  const queryTokens = new Set(tokenize(query));
  let best = { matchedCount: 0, totalCount: 0, coverage: 0 };

  for (const trigger of Array.isArray(triggers) ? triggers : []) {
    const current = coverageFor(trigger, queryTokens);
    if (
      current.coverage > best.coverage ||
      (current.coverage === best.coverage && current.matchedCount > best.matchedCount)
    ) {
      best = current;
    }
  }

  return {
    source,
    method: "token_overlap",
    strength: best.coverage === 1 ? "full" : best.matchedCount > 0 ? "partial" : "none",
    coverage: Number(best.coverage.toFixed(3)),
    matchedCount: best.matchedCount,
    totalCount: best.totalCount,
    advisoryOnly: true,
  };
}

export function annotateIntentEvidence(index, query, candidates, { mode = "explicit" } = {}) {
  const entries = new Map((index?.entries ?? []).map((entry) => [entry.id, entry]));
  return candidates.map((candidate) => {
    const entry = entries.get(candidate.id);
    // Current normalized entries do not preserve per-field provenance for
    // auto-discovered triggers. Recipe triggers are authored; everything else
    // remains unknown until Contract V1 can distinguish parsed vs inferred.
    const source = entry?.origin === "recipe" ? "declared" : "unknown";
    return {
      ...candidate,
      intentEvidence: {
        ...triggerCoverageEvidence(entry?.route?.triggers ?? [], query, { source }),
        mode,
      },
    };
  });
}
