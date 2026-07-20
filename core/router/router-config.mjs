// The router's slice of the config key space.
//
// These keys used to live in core/state/config.mjs, which made every one of
// them a permanent part of portawhip whether or not routing was installed. They
// are declared here instead and reach the config machinery through
// core/router/provider.mjs, so removing the router removes its settings too.

import { HARNESS_SCHEMA, loadRuntimeConfig, loadConfig, mergeSchemas } from "../state/config.mjs";

export const ROUTER_DEFAULTS = {
  engine: "hybrid",
  threshold: 2,
  recipeThreshold: 1,
  hybridThreshold: 350,
  pullHybridThreshold: 150,
  hybridRecipeThreshold: 130,
  hybridToolThreshold: 80,
  graphPath: ".hp-state/capability-graph.json",
  graphBoost: 0.25,
  k: 5,
  peakednessRatio: 1.05,
  denseEnabled: true,
  denseThreshold: 0.6,
  pushMode: "silent",
  pushBudgetChars: 640,
  pushMinConfidence: 0.75,
  pushMaxMentionsPerSession: 2,
};

export const ROUTER_DEFINITIONS = {
  engine: { type: "enum", values: ["keyword", "hybrid"], description: "Retrieval mode used to match requests with capabilities." },
  threshold: { type: "number", min: 0, description: "Minimum keyword score for general capability matches." },
  recipeThreshold: { type: "number", min: 0, description: "Minimum keyword score for curated recipe matches." },
  hybridThreshold: { type: "number", min: 0, description: "Minimum hybrid score for general capability matches." },
  pullHybridThreshold: { type: "number", min: 0, description: "Minimum hybrid score for general capability matches on the pull path, where route() is handed a distilled action rather than a raw prompt." },
  hybridRecipeThreshold: { type: "number", min: 0, description: "Minimum hybrid score for curated recipe matches." },
  hybridToolThreshold: { type: "number", min: 0, description: "Minimum hybrid score for MCP and CLI tool matches." },
  graphPath: { type: "path", description: "Path to the compiled capability relationship graph." },
  graphBoost: { type: "number", min: 0, description: "Extra score applied to candidates related in the capability graph." },
  k: { type: "integer", min: 1, description: "Maximum number of routing results returned per result lane." },
  peakednessRatio: { type: "number", min: 1, description: "Required lead of the top match over the runner-up to avoid noisy results." },
  denseEnabled: { type: "boolean", description: "Enable semantic embedding matches in the hybrid router." },
  denseThreshold: { type: "number", min: 0, max: 1, description: "Minimum semantic similarity accepted as a dense match." },
  pushMode: { type: "enum", values: ["silent", "legacy"], description: "Controls automatic capability suggestions; silent is the safe default." },
  pushBudgetChars: { type: "integer", min: 1, description: "Maximum character budget for a legacy automatic suggestion." },
  pushMinConfidence: { type: "number", min: 0, max: 1, description: "Minimum confidence required for an automatic suggestion." },
  pushMaxMentionsPerSession: { type: "integer", min: 0, description: "Maximum times one capability may be suggested in a session." },
};

export const ROUTER_SCHEMA = {
  id: "router",
  defaults: ROUTER_DEFAULTS,
  definitions: ROUTER_DEFINITIONS,
  mergeKeys: [],
  normalize(raw, defaults = ROUTER_DEFAULTS) {
    return {
      engine: ["keyword", "hybrid"].includes(raw.engine) ? raw.engine : defaults.engine,
      threshold: typeof raw.threshold === "number" ? raw.threshold : defaults.threshold,
      recipeThreshold: typeof raw.recipeThreshold === "number" ? raw.recipeThreshold : defaults.recipeThreshold,
      hybridThreshold: typeof raw.hybridThreshold === "number" ? raw.hybridThreshold : defaults.hybridThreshold,
      pullHybridThreshold: typeof raw.pullHybridThreshold === "number" ? raw.pullHybridThreshold : defaults.pullHybridThreshold,
      hybridRecipeThreshold: typeof raw.hybridRecipeThreshold === "number" ? raw.hybridRecipeThreshold : defaults.hybridRecipeThreshold,
      hybridToolThreshold: typeof raw.hybridToolThreshold === "number" ? raw.hybridToolThreshold : defaults.hybridToolThreshold,
      graphPath: typeof raw.graphPath === "string" && raw.graphPath.trim() ? raw.graphPath : defaults.graphPath,
      graphBoost: typeof raw.graphBoost === "number" ? raw.graphBoost : defaults.graphBoost,
      k: typeof raw.k === "number" ? raw.k : defaults.k,
      peakednessRatio: typeof raw.peakednessRatio === "number" ? raw.peakednessRatio : defaults.peakednessRatio,
      denseEnabled: typeof raw.denseEnabled === "boolean" ? raw.denseEnabled : defaults.denseEnabled,
      denseThreshold: typeof raw.denseThreshold === "number" ? raw.denseThreshold : defaults.denseThreshold,
      pushMode: ["legacy", "silent"].includes(raw.pushMode) ? raw.pushMode : defaults.pushMode,
      pushBudgetChars: typeof raw.pushBudgetChars === "number" ? raw.pushBudgetChars : defaults.pushBudgetChars,
      pushMinConfidence: typeof raw.pushMinConfidence === "number" ? raw.pushMinConfidence : defaults.pushMinConfidence,
      pushMaxMentionsPerSession: typeof raw.pushMaxMentionsPerSession === "number" ? raw.pushMaxMentionsPerSession : defaults.pushMaxMentionsPerSession,
    };
  },
};

// Router code wants harness keys too — autoSync gates whether a routing run may
// trigger a background sync — so both fragments are merged here.
export const ROUTER_RUNTIME_SCHEMA = mergeSchemas(HARNESS_SCHEMA, ROUTER_SCHEMA);

export function loadRouterRuntimeConfig(options = {}) {
  return loadRuntimeConfig({ ...options, schema: ROUTER_RUNTIME_SCHEMA });
}

export function loadRouterConfig(path = "router.config.yaml") {
  return loadConfig(path, { schema: ROUTER_RUNTIME_SCHEMA });
}
