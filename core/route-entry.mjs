// Single place that decides keyword vs hybrid engine, shared by
// router-cli.mjs and server/mcp-server.mjs — the Phase 2.5 audit found
// these two callers had drifted (CLI defaulted to hybrid, the live MCP
// server silently kept using the old keyword-only scorer). One function,
// used by both, so that can't happen again.

import { route } from "./scorer.mjs";
import { routeHybrid } from "./hybrid-router.mjs";

export async function runRoute(index, prompt, config) {
  return config.engine === "hybrid" ? await routeHybrid(index, prompt, config) : route(index, prompt, config);
}

export async function explainRoute(index, prompt, config) {
  const startedAt = Date.now();
  const all = config.engine === "hybrid"
    ? await routeHybrid(index, prompt, { ...config, includeWeak: true })
    : route(index, prompt, config);
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
