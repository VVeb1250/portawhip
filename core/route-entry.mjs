// Single place that decides keyword vs hybrid engine, shared by
// router-cli.mjs and server/mcp-server.mjs — the Phase 2.5 audit found
// these two callers had drifted (CLI defaulted to hybrid, the live MCP
// server silently kept using the old keyword-only scorer). One function,
// used by both, so that can't happen again.

import { route } from "./scorer.mjs";
import { routeHybrid } from "./hybrid-router.mjs";

export function runRoute(index, prompt, config) {
  return config.engine === "hybrid" ? routeHybrid(index, prompt, config) : route(index, prompt, config);
}

export function explainRoute(index, prompt, config) {
  const startedAt = Date.now();
  const all = config.engine === "hybrid"
    ? routeHybrid(index, prompt, { ...config, includeWeak: true })
    : route(index, prompt, config);
  const results = all.filter((item) => item.tier === "required" || item.tier === "recommended");
  const suppressed = all.filter((item) => item.tier !== "required" && item.tier !== "recommended");
  return {
    status: results.length > 0 ? "success" : "empty",
    summary:
      results.length > 0
        ? `found ${results.length} actionable capability match${results.length === 1 ? "" : "es"}`
        : "no actionable capability matched this task",
    results,
    suppressed,
    negative_evidence:
      results.length === 0
        ? {
            result: "empty",
            reason:
              suppressed.length > 0
                ? "only weak or keyword-only matches were found; ignore them by default"
                : "no installed capability cleared the routing threshold",
          }
        : null,
    latency_ms: Date.now() - startedAt,
  };
}
