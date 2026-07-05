#!/usr/bin/env node
// node core/router-cli.mjs route --prompt "..." [--threshold N] [--recipeThreshold N] [--k N]
// node core/router-cli.mjs list [--type skill]

import { loadIndex } from "./registry.mjs";
import { listAll } from "./scorer.mjs";
import { runRoute } from "./route-entry.mjs";
import { compileCapabilityGraph, writeCapabilityGraph } from "./capability-graph-compiler.mjs";
import { runRouterEval, runRouterEvalComparison, loadEvalSet } from "./router-eval.mjs";
import { loadConfig } from "./config.mjs";
import { computeFactors } from "./feedback.mjs";
import { stackFactors, combineFactors } from "./stack-detect.mjs";
import { harvestHardNegatives } from "./eval-harvest.mjs";
import { readActiveSelection, resolveRecipePaths } from "./bundle-state.mjs";
import { dirname, resolve } from "node:path";
import { appendFileSync } from "node:fs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true;
      args[key] = value;
      if (value !== true) i += 1;
    }
  }
  return args;
}

async function main() {
  const [, , command, ...rest] = process.argv;
  const args = parseArgs(rest);
  // --recipe is an explicit override (bypasses the opt-in bundle layer
  // entirely) so existing single-recipe usage and tests are unaffected.
  // Otherwise resolve whatever bundles the user has opted into via
  // scripts/bundles.mjs select, defaulting to just this project's
  // recipe.yaml when nothing has been selected (today's exact behavior).
  const recipePaths = args.recipe ?? resolveRecipePaths(process.cwd(), readActiveSelection(process.cwd()));
  const primaryRecipe = Array.isArray(recipePaths) ? recipePaths[recipePaths.length - 1] : recipePaths;
  const index = await loadIndex(recipePaths, { discover: !args["no-discover"] });

  if (command === "route") {
    if (!args.prompt) {
      console.error('usage: router-cli route --prompt "..."');
      process.exitCode = 1;
      return;
    }
    const config = loadConfig(args.config ?? "router.config.yaml");
    const opts = {
      threshold: args.threshold ? Number(args.threshold) : config.threshold,
      recipeThreshold: args.recipeThreshold ? Number(args.recipeThreshold) : config.recipeThreshold,
      hybridThreshold: args.hybridThreshold ? Number(args.hybridThreshold) : config.hybridThreshold,
      hybridRecipeThreshold: args.hybridRecipeThreshold ? Number(args.hybridRecipeThreshold) : config.hybridRecipeThreshold,
      hybridToolThreshold: args.hybridToolThreshold ? Number(args.hybridToolThreshold) : config.hybridToolThreshold,
      graphPath: args.graphPath ?? config.graphPath,
      graphBoost: args.graphBoost ? Number(args.graphBoost) : config.graphBoost,
      suggest: args.suggest ?? "any",
      k: args.k ? Number(args.k) : config.k,
      factors: combineFactors(
        computeFactors(dirname(resolve(primaryRecipe))),
        stackFactors(index, process.cwd()),
      ),
    };
    const engine = args.engine ?? config.engine;
    const result = runRoute(index, args.prompt, { ...opts, engine });
    console.log(JSON.stringify(result));
    return;
  }

  if (command === "eval") {
    const config = loadConfig(args.config ?? "router.config.yaml");
    const opts = {
      threshold: args.threshold ? Number(args.threshold) : config.threshold,
      recipeThreshold: args.recipeThreshold ? Number(args.recipeThreshold) : config.recipeThreshold,
      hybridThreshold: args.hybridThreshold ? Number(args.hybridThreshold) : config.hybridThreshold,
      hybridRecipeThreshold: args.hybridRecipeThreshold ? Number(args.hybridRecipeThreshold) : config.hybridRecipeThreshold,
      hybridToolThreshold: args.hybridToolThreshold ? Number(args.hybridToolThreshold) : config.hybridToolThreshold,
      graphPath: args.graphPath ?? config.graphPath,
      graphBoost: args.graphBoost ? Number(args.graphBoost) : config.graphBoost,
      suggest: args.suggest ?? "any",
      k: args.k ? Number(args.k) : config.k,
    };
    console.log(
      JSON.stringify(
        runRouterEval(index, opts, {
          evalPath: args.evalPath ?? "docs/router-eval-set.jsonl",
          engine: args.engine ?? "hybrid",
          suggest: args.suggest ?? "any",
        }),
        null,
        2,
      ),
    );
    return;
  }

  if (command === "compare") {
    const config = loadConfig(args.config ?? "router.config.yaml");
    console.log(
      JSON.stringify(
        runRouterEvalComparison(index, config, {
          evalPath: args.evalPath ?? "docs/router-eval-set.jsonl",
          suggest: args.suggest ?? "any",
        }),
        null,
        2,
      ),
    );
    return;
  }

  if (command === "harvest-negatives") {
    const evalPath = args.evalPath ?? "docs/router-eval-set.jsonl";
    const minIgnoredCount = args.minIgnoredCount ? Number(args.minIgnoredCount) : 2;
    const feedbackRoot = dirname(resolve(primaryRecipe));
    const existing = loadEvalSet(evalPath);
    const existingPrompts = new Set(existing.map((c) => c.prompt.toLowerCase()));
    const harvested = harvestHardNegatives(feedbackRoot, { minIgnoredCount });
    const fresh = harvested.filter((c) => !existingPrompts.has(c.prompt.toLowerCase()));
    if (fresh.length > 0) {
      appendFileSync(evalPath, `${fresh.map((c) => JSON.stringify(c)).join("\n")}\n`);
    }
    console.log(
      JSON.stringify({
        status: "success",
        harvested: harvested.length,
        added: fresh.length,
        skippedAsDuplicate: harvested.length - fresh.length,
        evalPath,
      }),
    );
    return;
  }

  if (command === "graph-compile") {
    const graph = compileCapabilityGraph(index, {
      maxEdgesPerNode: args.maxEdgesPerNode ? Number(args.maxEdgesPerNode) : undefined,
      minScore: args.minScore ? Number(args.minScore) : undefined,
    });
    if (args.out) {
      writeCapabilityGraph(args.out, graph);
      console.log(JSON.stringify({ status: "success", out: args.out, edgeCount: graph.edges.length }));
    } else {
      console.log(JSON.stringify(graph, null, 2));
    }
    return;
  }

  if (command === "list") {
    console.log(JSON.stringify(listAll(index, args.type)));
    return;
  }

  console.error(
    `unknown command "${command}". Use "route", "eval", "compare", "harvest-negatives", "graph-compile", or "list".`,
  );
  process.exitCode = 1;
}

main();
