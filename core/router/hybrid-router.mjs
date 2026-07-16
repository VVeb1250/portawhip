import { buildCapabilityDocs } from "../registry/capability-docs.mjs";
import { expandWithGraph, loadCapabilityGraph } from "../registry/capability-graph.mjs";
import { capabilityKind, matchesSuggestKind } from "../registry/capability-kind.mjs";
import { actionAlignmentFactor } from "./concept-vector.mjs";
import { denseRetrieve } from "./dense-embedder.mjs";
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
  // The capability system's own vocabulary. "tool"/"skill"/"agent"/"hook"/
  // "router" are already above; "mcp"/"cli"/"capability" complete the set.
  // A prompt that overlaps a capability ONLY through these words is talking
  // ABOUT the tool/skill/MCP machinery, not requesting a task - it's the
  // intent-gate case (docs/router-live.test.mjs): "research MCP availability
  // ... dynamic tools and skills ..." matched build-mcp-server purely on
  // {mcp, tool, skill}, all meta-vocabulary, and cleared the bar because
  // "mcp" alone wasn't yet classed as generic. Same weakKeywordOnly
  // mechanism - a prompt that ALSO shares a task-specific word (e.g. "wrap
  // this REST API as an MCP server") still passes untouched.
  "mcp",
  "cli",
  "capability",
  // The adjectives that vocabulary travels with. Found live via the eval's
  // `intent-research-mcp-domain` case ("research MCP availability and live
  // precision for dynamic tools and skills and future agents"): with
  // mcp/tool/skill already generic, sequential-thinking still cleared the bar
  // on "dynamic" alone, matched against its own description ("a tool for
  // dynamic and reflective problem-solving"). Neither word says anything about
  // WHICH capability a task needs — every server can be described as dynamic
  // and every check can be described as live — so a candidate whose only
  // overlap is one of them has no evidence, same as the nouns above.
  "live",
  "dynamic",
]);

function isWordChar(value) {
  return typeof value === "string" && /[\p{L}\p{N}_]/u.test(value);
}

function containsBoundedPhrase(text, phrase) {
  const haystack = text.toLocaleLowerCase();
  const needle = phrase.trim().toLocaleLowerCase();
  if (!needle) return false;
  let offset = 0;
  while (offset <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, offset);
    if (index < 0) return false;
    const before = index > 0 ? haystack[index - 1] : null;
    const afterIndex = index + needle.length;
    const after = afterIndex < haystack.length ? haystack[afterIndex] : null;
    if (!isWordChar(before) && !isWordChar(after)) return true;
    offset = index + 1;
  }
  return false;
}

function hasDirectCuratedTrigger(candidate, prompt) {
  return (
    candidate.doc?.origin === "recipe" &&
    (candidate.doc.triggers ?? []).some((trigger) => containsBoundedPhrase(prompt, trigger))
  );
}

function candidateBar(candidate, prompt, { autoBar, recipeBar, toolBar }) {
  const isTool = candidate.doc.type === "mcp" || candidate.doc.type === "cli";
  const base = candidate.doc.origin === "recipe" ? recipeBar : isTool ? toolBar : autoBar;
  // A full, bounded match on a deliberately authored recipe trigger is the
  // hybrid equivalent of keyword scorer's trusted single-trigger hit. This
  // prevents clean installs from depending on machine-local graph/feedback
  // boosts while keeping generic token overlap behind the calibrated bar.
  return hasDirectCuratedTrigger(candidate, prompt) ? Math.min(base, candidate.score) : base;
}

// Infinity means "sole lane survivor, nothing to be tied with" - the same
// no-penalty case gateLane already treats as automatically dominant.
function laneMarginRatio(laneCandidates) {
  if (laneCandidates.length < 2) return Infinity;
  const sorted = [...laneCandidates].sort((a, b) => b.score - a.score);
  const [top, runnerUp] = sorted;
  return runnerUp.score <= 0 ? Infinity : top.score / runnerUp.score;
}

// A lane where the top match barely beats the runner-up is diffuse-vocabulary
// noise, not a genuine pick — verified against docs/router-eval-set.jsonl's
// one remaining false positive: "what context signals should a router
// observe before injecting a skill" scores example-skill and
// skill-development within 0.3% of each other (both lit up by the same
// generic "router"/"skill"/"injecting" words), while every real match in the
// set has a clear top pick with no close runner-up. A lane with only one
// surviving candidate is never penalized (nothing to be tied with).
//
// Survivors are tagged with the same marginRatio used for the gate decision,
// not just recomputed silently - Stage 3 calibration (classifyCandidate)
// reads it to keep confidence honest for a candidate that barely cleared the
// gate, not just ones that got silenced entirely. See marginConfidenceFactor.
function gateLane(laneCandidates, ratio) {
  const marginRatio = laneMarginRatio(laneCandidates);
  if (laneCandidates.length >= 2 && marginRatio < ratio) return [];
  return laneCandidates.map((candidate) => ({ ...candidate, marginRatio }));
}

// Ramps confidence down for a candidate that only barely cleared the
// peakedness gate (docs/intent-gate-bakeoff.md's calibration ask - Codex
// point 3: "broad-term/dense-only/no-margin candidates must not read
// confidence 1"). marginRatio===Infinity (sole lane survivor - nothing was
// close) is full confidence; right at the gate ratio is the floor; by 0.45
// above the gate ("clearly dominant" - empirically chosen headroom, not
// tuned to a specific eval case) it's back to full.
function marginConfidenceFactor(marginRatio, gateRatio) {
  if (!Number.isFinite(marginRatio)) return 1.0;
  const CONFIDENT = gateRatio + 0.45;
  if (marginRatio <= gateRatio) return 0.5;
  if (marginRatio >= CONFIDENT) return 1.0;
  return 0.5 + ((marginRatio - gateRatio) / (CONFIDENT - gateRatio)) * 0.5;
}

// Curated (recipe.yaml) entries are trusted outright - deliberately
// authored, same rationale as the recipe/auto threshold split. A candidate
// with no direct lexical evidence at all (terms.length===0 - always true for
// a dense-only or graph-only hit, since neither carries real matched terms)
// is a similarity/adjacency GUESS, not an exact match, and must not read as
// confidently as one. A sparse hit that survived the tier filter above
// always has at least one specific (non-broad) term by construction.
function specificityConfidenceFactor(item) {
  if (item.doc?.origin === "recipe") return 1.0;
  return (item.terms ?? []).length === 0 ? 0.6 : 1.0;
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

function classifyCandidate(item, bar, peakednessRatio = 1.05) {
  const score = item.score ?? item.rrfScore ?? 0;
  const baseConfidence = bar > 0 ? Math.min(1, score / bar) : 1;
  const terms = item.terms ?? [];
  const specificTerms = terms.filter((term) => !BROAD_TERMS.has(term));
  // No `origin !== "recipe"` exemption here. This is an evidence test, not a
  // trust test: curation says a capability matters to this project, which
  // cannot manufacture evidence that THIS prompt is about it. Curation is
  // already paid for where it belongs — a lower recipeThreshold to clear, and
  // the "required" tier below. Exempting curated entries from the evidence test
  // instead let this repo's OWN meta-tooling fire on any talk about
  // capabilities: portawhip is a skill about capability sync, so its indexed
  // text is saturated with exactly the meta-vocabulary BROAD_TERMS exists to
  // neutralize, and it matched the eval's `intent-research-mcp-domain` research
  // prompt on {mcp, live, tool, skill} with the whole list already generic.
  const weakKeywordOnly = terms.length > 0 && specificTerms.length === 0;
  // Composite, not a single score/threshold ratio (docs/intent-gate-bakeoff.md
  // / Codex point 3): a candidate that barely cleared the peakedness gate, or
  // has no direct lexical evidence (dense/graph-only), must not read as
  // confidently as one that's both dominant in its lane AND directly matched.
  const confidence = Math.max(
    0,
    Math.min(
      1,
      baseConfidence *
        specificityConfidenceFactor(item) *
        marginConfidenceFactor(item.marginRatio ?? Infinity, peakednessRatio),
    ),
  );

  if (score >= bar && !weakKeywordOnly) {
    return {
      tier: confidence >= 0.9 && item.doc?.origin === "recipe" ? "required" : "recommended",
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

function formatResult(item, bar, peakednessRatio) {
  const doc = item.doc;
  const classification = classifyCandidate(item, bar, peakednessRatio);
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
    skipWhen: doc.skipWhen ?? [],
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

export async function routeHybrid(
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
    denseEnabled = true,
    denseThreshold = 0.6,
    // Default true = wait for the dense model (deterministic - what CLI and
    // eval want). The MCP server passes false so a cold model load never
    // blocks an interactive route() call into a client timeout; see
    // core/dense-embedder.mjs's warmDense/denseRetrieve.
    denseBlock = true,
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
  // Direct curated triggers may score below the corpus-wide calibrated bars
  // (short CLI docs are especially sparse), so retrieval must not discard
  // them before candidateBar can apply the exact-trigger trust path.
  const minScore = 0;
  // No early-return on an empty sparse hit list: a genuine paraphrase can
  // share zero lexical vocabulary with any doc field at all, and dense
  // retrieval below runs independently of minisearch - exiting here would
  // deny it the one case it exists to rescue. Graph expansion/candidate
  // building all handle an empty seed list fine already (see "hybrid graph:
  // abstains when retrieval has no seed").
  const sparse = sparseRetrieve(docs, prompt, { k: Math.max(k * 4, 20), minScore });

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
      const bar = candidateBar(candidate, prompt, { autoBar, recipeBar, toolBar });
      return { ...candidate, bar };
    });
  const filtered = candidates.filter((candidate) => {
    const bar = candidateBar(candidate, prompt, { autoBar, recipeBar, toolBar });
    return candidate.score >= bar && classifyCandidate(candidate, bar).tier !== "irrelevant_but_keyword_matched";
  });

  // Dense retrieval (core/dense-embedder.mjs, BGE-M3) is a second,
  // meaning-based channel additive to the lexical one above - it runs
  // regardless of what sparse found, so a genuine paraphrase with little or
  // no shared vocabulary (the gap margin-gate/threshold tuning on lexical
  // scores alone provably cannot close - see docs/router-eval-set.jsonl's
  // e2e-testing miss) still gets a chance. Fails soft to [] whenever the
  // model isn't installed/reachable or a caller opts out (push hook does -
  // see universal-hook.mjs - a fresh process per keystroke can't amortize a
  // 500MB+ model load), so every caller sees identical output to before
  // whenever dense doesn't contribute. minScore:0 is deliberate - the real
  // gate is `bar` below, applied after factors/actionAlignment, the same
  // two-stage "loose net, then precise bar" shape the lexical path above
  // already uses.
  const filteredIds = new Set(filtered.map((candidate) => candidate.doc.id));
  let denseOnly = [];
  if (denseEnabled) {
    const denseHits = await denseRetrieve(docs, prompt, {
      k: Math.max(k * 4, 20),
      minScore: 0,
      block: denseBlock,
    });
    denseOnly = denseHits
      .filter((hit) => matchesSuggestKind(hit.doc.type, suggest) && !filteredIds.has(hit.id))
      .map((hit) => ({
        ...hit,
        score: hit.score * (factors?.get(hit.doc.id) ?? 1.0) * actionAlignmentFactor(hit.doc, prompt),
        bar: denseThreshold,
        terms: [],
      }))
      .filter((hit) => hit.score >= denseThreshold);
  }

  const candidatesForLanes = [...filtered, ...denseOnly];
  if (candidatesForLanes.length === 0) {
    if (!includeWeak) return [];
    return candidates.slice(0, k).map((candidate) => formatResult(candidate, candidate.bar, peakednessRatio));
  }

  // Tools and skills get their own reserved k slots, not one shared slice.
  // Found live: real callers (push hook, MCP route tool, router-cli route)
  // all call with suggest:"any", so a query where BOTH a skill and a tool
  // are genuinely relevant used to have them compete for the same k slots
  // — a strong skill match could silently crowd a real tool match (or vice
  // versa) out of the result entirely, even though a task usually wants
  // both side by side (the tool to do it, the skill for how to do it well).
  const lanes = new Map();
  for (const candidate of candidatesForLanes) {
    const kind = capabilityKind(candidate.doc.type);
    if (!lanes.has(kind)) lanes.set(kind, []);
    lanes.get(kind).push(candidate);
  }
  const laneWinners = [...lanes.values()].flatMap((laneCandidates) =>
    reciprocalRankFusion([gateLane(laneCandidates, peakednessRatio)]).slice(0, k),
  );
  const fused = laneWinners.sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0) || a.doc.id.localeCompare(b.doc.id),
  );
  const routed = fused.map((item) => formatResult(item, item.bar, peakednessRatio));
  if (!includeWeak || routed.length >= k) return routed;

  const routedIds = new Set(routed.map((item) => item.id));
  const weak = candidates
    .filter((candidate) => !routedIds.has(candidate.doc.id))
    .slice(0, k - routed.length)
    .map((candidate) => formatResult(candidate, candidate.bar, peakednessRatio));
  return [...routed, ...weak];
}
