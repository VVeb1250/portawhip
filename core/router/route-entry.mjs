// Single place that decides keyword vs hybrid engine, shared by
// router-cli.mjs and server/mcp-server.mjs — the Phase 2.5 audit found
// these two callers had drifted (CLI defaulted to hybrid, the live MCP
// server silently kept using the old keyword-only scorer). One function,
// used by both, so that can't happen again.

import { route } from "./scorer.mjs";
import { routeHybrid } from "./hybrid-router.mjs";
import { routeTwoStage } from "./two-stage-router.mjs";
import { annotateIntentEvidence } from "./intent-evidence.mjs";

function pushIsSilent(config) {
  return config.mode === "push" && config.pushMode === "silent";
}

export async function runRoute(index, prompt, config) {
  // Delivery policy, not retrieval: raw-prompt push has no reasoning signal,
  // so the default mode abstains before invoking either engine. Direct engine
  // callers remain available for characterization and evals.
  if (pushIsSilent(config)) return [];
  const candidates =
    config.engine === "two-stage"
      ? await routeTwoStage(index, prompt, config)
      : config.engine === "hybrid"
        ? await routeHybrid(index, prompt, config)
        : route(index, prompt, config);
  return annotateIntentEvidence(index, prompt, candidates, { mode: config.mode });
}

function compactSkipWhen(hit) {
  if (typeof hit.skip_when === "string" && hit.skip_when.trim()) return hit.skip_when.trim();
  if (!Array.isArray(hit.skipWhen)) return null;
  const clauses = hit.skipWhen.filter((clause) => typeof clause === "string" && clause.trim());
  return clauses.length > 0 ? clauses.join("; ") : null;
}

function compactHit(hit) {
  return Object.fromEntries(
    [
      ["id", hit.id],
      ["type", hit.type],
      ["kind", hit.kind],
      ["state", hit.state],
      ["tier", hit.tier],
      ["action", hit.action],
      ["how_to_use", hit.how_to_use],
      ["pointer", hit.pointer],
      ["skip_when", compactSkipWhen(hit)],
      ["readyMarker", hit.readyMarker],
      ["readyHint", hit.readyHint],
    ].filter(([, value]) => value !== null && value !== undefined),
  );
}

export function compactRouteResult(result, { ledger = null } = {}) {
  if (result.status !== "success" || result.results.length === 0) {
    return {
      status: "empty",
      reason:
        result.reason ??
        result.negative_evidence?.reason ??
        "no installed capability cleared the routing threshold",
    };
  }

  const compactedResults = result.results.map((hit) => compactHit({ ...hit, state: hit.state ?? "fresh" }));
  const emittedResults = ledger ? ledger.emit(compactedResults) : compactedResults;
  if (emittedResults.length === 0) {
    return { status: "empty", reason: "matching capabilities were muted for this session" };
  }
  const recognitionSet = emittedResults.length > 1 || emittedResults.some((hit) => hit.state !== "fresh");

  return {
    status: "success",
    ...(recognitionSet ? { mode: "candidates", note: "candidates - pick what fits, ignoring all is fine" } : {}),
    results: emittedResults,
  };
}

export async function explainRoute(index, prompt, config) {
  const startedAt = Date.now();
  if (pushIsSilent(config)) {
    const reason = "push delivery is silent by mode policy";
    return {
      status: "empty",
      decision: "abstain",
      summary: "no actionable capability matched this task",
      results: [],
      suppressed: [],
      near_misses: [],
      negative_evidence: { result: "empty", reason },
      reason,
      latency_ms: Date.now() - startedAt,
    };
  }
  const engineCandidates =
    config.engine === "two-stage"
      ? await routeTwoStage(index, prompt, { ...config, includeWeak: true })
      : config.engine === "hybrid"
        ? await routeHybrid(index, prompt, { ...config, includeWeak: true })
        : route(index, prompt, config);
  const all = annotateIntentEvidence(index, prompt, engineCandidates, { mode: config.mode });
  const results = all.filter((item) => item.tier === "required" || item.tier === "recommended");
  const suppressed = all.filter((item) => item.tier !== "required" && item.tier !== "recommended");
  const reason =
    results.length === 0
      ? suppressed.length > 0
        ? "only weak or keyword-only matches were found; ignore them by default"
        : "no installed capability cleared the routing threshold"
      : null;
  return {
    status: results.length > 0 ? "success" : "empty",
    // decision/near_misses: the same information as status/suppressed above,
    // spelled out in the vocabulary Stage 4 (docs/intent-gate-bakeoff.md)
    // asked for - "abstain is a first-class decision with a reason, not a
    // shrug." Added alongside the original fields, not replacing them: this
    // server is published (github.com/VVeb1250/portawhip) and any external
    // caller may already depend on status/negative_evidence/suppressed, so
    // this is additive, never a breaking rename.
    decision: results.length > 0 ? "route" : "abstain",
    summary:
      results.length > 0
        ? `found ${results.length} actionable capability match${results.length === 1 ? "" : "es"}`
        : "no actionable capability matched this task",
    results,
    suppressed,
    near_misses: suppressed,
    negative_evidence: reason ? { result: "empty", reason } : null,
    reason,
    latency_ms: Date.now() - startedAt,
  };
}
