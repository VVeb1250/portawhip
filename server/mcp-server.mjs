#!/usr/bin/env node
// Pull mode (PLAN.md Phase 2): exposes the same core/registry.mjs +
// core/scorer.mjs used by router-cli.mjs, as an MCP server any host can
// call directly — no per-host code beyond this one stdio process.

import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadIndex } from "../core/registry/registry.mjs";
import { listAll } from "../core/router/scorer.mjs";
import { explainRoute } from "../core/router/route-entry.mjs";
import { loadConfig } from "../core/state/config.mjs";
import { computeFactors, logEvent } from "../core/state/feedback.mjs";
import { stackFactors, combineFactors } from "../core/state/stack-detect.mjs";
import { readActiveSelection, resolveRecipePaths } from "../core/state/bundle-state.mjs";
import { warmDense, setDenseCachePath, primeDocCache } from "../core/router/dense-embedder.mjs";
import { buildCapabilityDocs } from "../core/registry/capability-docs.mjs";

// This server is registered globally (add-mcp may promote project scope to
// global depending on the host), so a caller can invoke it from ANY cwd —
// recipe.yaml/router.config.yaml must resolve to this repo, never the
// caller's working directory.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// Integration tests and embedded deployments may isolate outcome state from
// the repository's live dogfood log. Capability/config discovery still uses
// ROOT; only feedback events are redirected.
const FEEDBACK_ROOT = process.env.PORTAWHIP_FEEDBACK_ROOT || ROOT;
// Whatever bundles were opted into via `scripts/bundles.mjs select` (foundry
// + roles), resolved in front of this repo's own recipe.yaml — defaults to
// just recipe.yaml when nothing has been selected (today's behavior).
const RECIPE_PATHS = resolveRecipePaths(ROOT, readActiveSelection(ROOT));
const CONFIG_PATH = join(ROOT, "router.config.yaml");

const server = new McpServer({ name: "harness-router", version: "0.0.1" });

server.tool(
  "route",
  "Look up which installed capability (MCP tool, skill, or CLI) fits a task before you start it. " +
    "State only the positively requested action and its direct object; do not copy the raw prompt. " +
    "Drop chit-chat, venting, background, and any rejected, negated, or hypothetical option. " +
    "If a request is buried in chat, route only the request; if the message names several distinct actions, call route once per action. " +
    "Example: 'ugh CI is flaky, anyway find where we parse the auth token' -> query 'find the code that parses the auth token'. " +
    "Returns pointers, not full content. An empty result is expected and means nothing installed fits.",
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
    const factors = combineFactors(computeFactors(FEEDBACK_ROOT), stackFactors(index, process.cwd()));
    // denseBlock:false - this is the interactive tier. A cold dense-model load
    // must never block a route() call (it would time the MCP client out; see
    // core/dense-embedder.mjs). Early calls are sparse-only and dense joins in
    // once the background warm (started at server boot below) finishes.
    const result = await explainRoute(index, query, {
      ...config,
      graphPath,
      k: k ?? config.k,
      factors,
      denseBlock: false,
      mode: "pull",
    });
    logEvent(FEEDBACK_ROOT, {
      type: "route",
      engine: config.engine,
      queryLength: query.length,
      resultCount: result.results.length,
      suppressedCount: result.suppressed.length,
      topIds: result.results.slice(0, 3).map((hit) => hit.id),
      latencyMs: result.latency_ms,
      emptyReason: result.negative_evidence?.reason ?? null,
    });
    // Pull results join the trust loop as boost-only signal (2026-07-09):
    // source:"pull" marks these so computeFactors credits a follow-up "used"
    // (Claude asked, got an answer, acted on it - the strongest possible
    // relevance signal) but never counts an unused pull result as an
    // "ignored" outcome. Pull is recall-generous by design; punishing
    // unclicked results would recreate the noise-decay bug at this layer.
    for (const hit of result.results) {
      // The reasoned summary may contain sensitive task context. Outcome
      // attribution only needs capability id + source, so never persist it.
      logEvent(FEEDBACK_ROOT, { type: "suggested", id: hit.id, source: "pull" });
    }
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

// Start the (slow) dense model load in the background at boot, so it overlaps
// the idle time before the first route() call rather than blocking it. Safe
// to call unconditionally: it's fire-and-forget and a no-op when the model
// can't be loaded (dense degrades to sparse-only). If dense is disabled in
// config, the warm still completes harmlessly and simply never gets used.
warmDense();

// Doc-embedding cache: persisted to disk (survives this process restarting,
// which happens every session) AND primed here at boot, in the background,
// overlapping the model load above - so the FIRST interactive route() call
// after warm doesn't land on 559 uncached docs being embedded one-by-one in
// its own request (found live: 67-104s route() latency from exactly this -
// denseBlock:false only ever guarded the model load, never this). Fire and
// forget: no client is waiting on server boot, and denseRetrieve's own
// on-demand embed path still covers any doc this background pass hasn't
// reached yet.
setDenseCachePath(join(ROOT, ".hp-state", "dense-cache.json"));
loadIndex(RECIPE_PATHS)
  .then((index) => primeDocCache(buildCapabilityDocs(index)))
  .catch(() => {});

const transport = new StdioServerTransport();
await server.connect(transport);
