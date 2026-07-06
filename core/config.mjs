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
  // See router.config.yaml's own comment: a lane where the top match barely
  // beats the runner-up is diffuse-vocabulary noise, not a genuine pick.
  peakednessRatio: 1.05,
  // Dense semantic retrieval (core/dense-embedder.mjs, BGE-M3) - on by
  // default so the zero-setup path (just install, no manual model
  // management) is the norm for every user, not an opt-in. Callers that
  // can't amortize a 500MB+ model load across calls (the push hook - see
  // adapters/hooks/universal-hook.mjs) explicitly pass denseEnabled:false.
  denseEnabled: true,
  // 0.6, not the more intuitive-looking 0.55 - verified live against
  // docs/router-eval-set.jsonl (BGE-M3 real model, not simulated): 0.55
  // let a genuinely irrelevant agent/skill pair through on
  // "audit why route suggestions are noisy and injected at the wrong time"
  // (network-config-reviewer/caveman-review, both boosted over the line by
  // actionAlignmentFactor's "review" match on top of raw cosine ~0.48-0.50
  // - BGE-M3's ambient similarity floor for unrelated short text, not a
  // real match). Swept 0.55/0.56/0.58/0.60 - 0.55-0.56 fail, 0.58-0.60 both
  // clean (falsePositiveCount 0, precisionAt1/recallAt3 still 1) - a real
  // plateau, not one lucky number. Picked 0.60 for extra margin over the
  // 0.58 edge.
  denseThreshold: 0.6,
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
    peakednessRatio:
      typeof raw.peakednessRatio === "number" ? raw.peakednessRatio : DEFAULTS.peakednessRatio,
    denseEnabled: typeof raw.denseEnabled === "boolean" ? raw.denseEnabled : DEFAULTS.denseEnabled,
    denseThreshold:
      typeof raw.denseThreshold === "number" ? raw.denseThreshold : DEFAULTS.denseThreshold,
    pushBudgetChars:
      typeof raw.pushBudgetChars === "number" ? raw.pushBudgetChars : DEFAULTS.pushBudgetChars,
  };
}
