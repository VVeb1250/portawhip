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
