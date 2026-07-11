// A second, non-lexical signal — PLAN.md Phase 4 item 3 called for a local
// transformer embedding model (fastembed/BGE-M3) here. Checked this session:
// huggingface.co (the model weight host) did not respond within 10s from
// this sandbox, so a real download-a-model approach is not reliably
// available. This ships a zero-dependency, zero-download stand-in instead.
//
// First attempt was a full curated concept-vector (action + domain
// dimensions) scored by cosine similarity, fused via reciprocalRankFusion
// as a competing ranking. Eval caught a real regression: cosine over
// sparse low-dimensional vectors is pathological — a doc that only ever
// mentions ONE concept dimension gets an artificially perfect cosine (1.0)
// against a query with the same single dimension active, beating a doc
// that's a much stronger overall match but touches more dimensions (and so
// has a "diluted" vector norm). That's exactly what flipped
// prisma-patterns above postgres-patterns on a Postgres-specific query.
//
// Fix: score ONLY the action-intent dimension (build/test/fix/review/
// refactor/deploy/document), as a discrete match/mismatch/neutral factor,
// not a cosine similarity. Domain specificity (postgres vs prisma vs mysql)
// is left entirely to the lexical BM25 score, which already handles it
// correctly — the actual observed failure mode this exists to fix
// (react-testing outranking react-patterns on a build task) is an
// action-intent conflation, not a domain one.

import { tokenize } from "./tokenize.mjs";

const ACTION_CONCEPTS = {
  build: ["add", "create", "build", "implement", "scaffold", "generate"],
  test: ["test", "spec", "coverage", "verify", "assert", "mock"],
  fix: ["fix", "bug", "defect", "repair", "debug", "broken", "crash"],
  review: ["review", "audit", "inspect", "lint", "vet"],
  refactor: ["refactor", "restructure", "cleanup", "simplify", "reorganize"],
  deploy: ["deploy", "release", "ship", "publish", "rollout"],
  document: ["document", "explain", "readme"],
};

function dominantAction(text) {
  const tokens = new Set(tokenize(text));
  let best = null;
  let bestCount = 0;
  for (const [name, keywords] of Object.entries(ACTION_CONCEPTS)) {
    let hits = 0;
    for (const kw of keywords) {
      const kwTokens = tokenize(kw);
      if (kwTokens.length > 0 && kwTokens.every((t) => tokens.has(t))) hits += 1;
    }
    if (hits > bestCount) {
      bestCount = hits;
      best = name;
    }
  }
  return bestCount > 0 ? best : null;
}

// Docs are rebuilt fresh per call in hybrid-router.mjs, so no cross-call
// staleness risk from caching on the object itself.
const docActionCache = new WeakMap();

function docText(doc) {
  return [doc.id, (doc.triggers ?? []).join(" "), doc.description ?? ""].join(" ");
}

// The id is a curated, compact "what this IS" signal (security-review,
// react-testing) — trust it alone first. Only fall back to the full
// description when the id itself carries no action-cluster word at all.
// Needed because descriptions are often "when to activate" prose (e.g.
// security-review's own description talks about "adding authentication,
// implementing payment features" — build-flavored words describing WHEN
// to use a review skill, not what the skill itself does) that would
// otherwise outvote the id on raw keyword-presence count.
function dominantActionForDoc(doc) {
  return dominantAction(doc.id) ?? dominantAction(docText(doc));
}

// Neutral (1.0) unless BOTH the query and the doc have a clear, single
// dominant action-intent — a query with no strong action verb (e.g. ",
// "PostgreSQL schema design and query optimization") never triggers this,
// and neither does a doc with no action-flavored vocabulary at all (most
// domain-pattern docs). Only fires, and only ever demotes/boosts, when
// there's a genuine mismatch/match to react to.
export function actionAlignmentFactor(doc, query, { match = 1.15, mismatch = 0.6 } = {}) {
  const queryAction = dominantAction(query);
  if (!queryAction) return 1.0;
  let docAction = docActionCache.get(doc);
  if (docAction === undefined) {
    docAction = dominantActionForDoc(doc);
    docActionCache.set(doc, docAction);
  }
  if (!docAction) return 1.0;
  return docAction === queryAction ? match : mismatch;
}
