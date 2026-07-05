// Router tuning knobs (threshold, k) live in router.config.yaml, not as
// hardcoded constants in scorer.mjs — PLAN.md Phase 1 spec requires the
// threshold be "config in recipe header or router.config.yaml".

import { readFileSync, existsSync } from "node:fs";
import yaml from "js-yaml";

const DEFAULTS = {
  engine: "hybrid",
  threshold: 2,
  recipeThreshold: 1,
  hybridThreshold: 350,
  hybridRecipeThreshold: 130,
  hybridToolThreshold: 80,
  graphPath: ".hp-state/capability-graph.json",
  graphBoost: 0.25,
  k: 5,
  // See router.config.yaml's own comment for the 320 -> 640 rationale
  // (actionDirective()'s mcp/ToolSearch clause cost, paid at most once per
  // id per session since repeats render tersely) - kept in sync here so a
  // project with no router.config.yaml at all still gets the same fix.
  pushBudgetChars: 640,
};

export function loadConfig(path = "router.config.yaml") {
  if (!existsSync(path)) return { ...DEFAULTS };
  const raw = yaml.load(readFileSync(path, "utf8")) ?? {};
  return {
    engine: raw.engine === "keyword" || raw.engine === "hybrid" ? raw.engine : DEFAULTS.engine,
    threshold: typeof raw.threshold === "number" ? raw.threshold : DEFAULTS.threshold,
    recipeThreshold:
      typeof raw.recipeThreshold === "number" ? raw.recipeThreshold : DEFAULTS.recipeThreshold,
    hybridThreshold:
      typeof raw.hybridThreshold === "number" ? raw.hybridThreshold : DEFAULTS.hybridThreshold,
    hybridRecipeThreshold:
      typeof raw.hybridRecipeThreshold === "number"
        ? raw.hybridRecipeThreshold
        : DEFAULTS.hybridRecipeThreshold,
    hybridToolThreshold:
      typeof raw.hybridToolThreshold === "number" ? raw.hybridToolThreshold : DEFAULTS.hybridToolThreshold,
    graphPath:
      typeof raw.graphPath === "string" && raw.graphPath.trim() ? raw.graphPath : DEFAULTS.graphPath,
    graphBoost: typeof raw.graphBoost === "number" ? raw.graphBoost : DEFAULTS.graphBoost,
    k: typeof raw.k === "number" ? raw.k : DEFAULTS.k,
    pushBudgetChars:
      typeof raw.pushBudgetChars === "number" ? raw.pushBudgetChars : DEFAULTS.pushBudgetChars,
  };
}
