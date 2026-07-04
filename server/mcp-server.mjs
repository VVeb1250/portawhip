#!/usr/bin/env node
// Pull mode (PLAN.md Phase 2): exposes the same core/registry.mjs +
// core/scorer.mjs used by router-cli.mjs, as an MCP server any host can
// call directly — no per-host code beyond this one stdio process.

import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadIndex } from "../core/registry.mjs";
import { listAll } from "../core/scorer.mjs";
import { explainRoute } from "../core/route-entry.mjs";
import { loadConfig } from "../core/config.mjs";
import { computeFactors, logEvent } from "../core/feedback.mjs";
import { readActiveSelection, resolveRecipePaths } from "../core/bundle-state.mjs";

// This server is registered globally (add-mcp may promote project scope to
// global depending on the host), so a caller can invoke it from ANY cwd —
// recipe.yaml/router.config.yaml must resolve to this repo, never the
// caller's working directory.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// Whatever bundles were opted into via `scripts/bundles.mjs select` (foundry
// + roles), resolved in front of this repo's own recipe.yaml — defaults to
// just recipe.yaml when nothing has been selected (today's behavior).
const RECIPE_PATHS = resolveRecipePaths(ROOT, readActiveSelection(ROOT));
const CONFIG_PATH = join(ROOT, "router.config.yaml");

const server = new McpServer({ name: "harness-router", version: "0.0.1" });

server.tool(
  "route",
  "Look up which installed capability (MCP tool, skill, or CLI) is relevant " +
    "to a task, before starting it. Returns pointers, not full content. " +
    "Empty result is expected and means nothing relevant is installed.",
  { query: z.string(), k: z.number().optional() },
  async ({ query, k }) => {
    const index = await loadIndex(RECIPE_PATHS);
    const config = loadConfig(CONFIG_PATH);
    // Same class of bug fixed earlier for recipe.yaml/router.config.yaml:
    // graphPath in config is written as a repo-relative string, which
    // silently resolves against the CALLER's cwd, not this repo, when this
    // server is invoked from elsewhere (which is the whole point of
    // installing it globally).
    const graphPath =
      config.graphPath && !isAbsolute(config.graphPath) ? join(ROOT, config.graphPath) : config.graphPath;
    const factors = computeFactors(ROOT);
    const result = explainRoute(index, query, { ...config, graphPath, k: k ?? config.k, factors });
    logEvent(ROOT, {
      type: "route",
      engine: config.engine,
      queryLength: query.length,
      resultCount: result.results.length,
      suppressedCount: result.suppressed.length,
      topIds: result.results.slice(0, 3).map((hit) => hit.id),
      latencyMs: result.latency_ms,
      emptyReason: result.negative_evidence?.reason ?? null,
    });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

server.tool(
  "list_all",
  "List every installed capability known to the harness registry, " +
    "optionally filtered by type (mcp | cli | skill).",
  { type: z.string().optional() },
  async ({ type }) => {
    const index = await loadIndex(RECIPE_PATHS);
    const result = listAll(index, type);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
