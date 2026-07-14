#!/usr/bin/env node
// node core/router/router-cli.mjs route --prompt "..." [--threshold N] [--recipeThreshold N] [--k N]
// node core/router/router-cli.mjs list [--type skill]

import { loadIndex } from "../registry/registry.mjs";
import { listAll } from "./scorer.mjs";
import { runRoute } from "./route-entry.mjs";
import { compileCapabilityGraph, writeCapabilityGraph } from "../registry/capability-graph-compiler.mjs";
import { runRouterEval, runRouterEvalComparison, loadEvalSet } from "./router-eval.mjs";
import { loadRuntimeConfig } from "../state/config.mjs";
import { computeFactors } from "../state/feedback.mjs";
import { stackFactors, combineFactors } from "../state/stack-detect.mjs";
import { harvestHardNegatives } from "../registry/eval-harvest.mjs";
import { runEnrichment } from "../registry/enrich.mjs";
import { readActiveSelection, resolveRecipePaths, resolveRuntimeRoot } from "../state/bundle-state.mjs";
import { dirname, resolve, join } from "node:path";
import { appendFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function runtimeFile(path, root = resolveRuntimeRoot(process.cwd(), PACKAGE_ROOT)) {
  if (existsSync(resolve(path))) return path;
  return join(root, path);
}

function runtimeConfig(args, root) {
  if (args.config) {
    return loadRuntimeConfig({
      basePath: args.config,
      cwd: process.cwd(),
      env: { ...process.env, PORTAWHIP_CONFIG: args.config },
    });
  }
  return loadRuntimeConfig({ basePath: runtimeFile("router.config.yaml", root), cwd: process.cwd() });
}

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

function printUsage() {
  console.log(`usage:
  node core/router/router-cli.mjs route --prompt "..." [--engine hybrid|keyword] [--no-dense|--dense-block]
  node core/router/router-cli.mjs eval [--engine hybrid|keyword]
  node core/router/router-cli.mjs compare
  node core/router/router-cli.mjs enrich
  node core/router/router-cli.mjs harvest-negatives
  node core/router/router-cli.mjs graph-compile [--out path]
  node core/router/router-cli.mjs list [--type mcp|cli|skill]

Notes:
  route is interactive-fast by default: dense retrieval joins only if already warm.
  use --dense-block when you explicitly want route to wait for dense retrieval.`);
}

async function main() {
  const [, , command, ...rest] = process.argv;
  const args = parseArgs(rest);
  if (!command || command === "--help" || command === "-h" || args.help || args.h) {
    printUsage();
    return;
  }
  // --recipe is an explicit override (bypasses the opt-in bundle layer
  // entirely) so existing single-recipe usage and tests are unaffected.
  // Otherwise resolve whatever bundles the user has opted into via
  // scripts/bundles.mjs select, defaulting to just this project's
  // recipe.yaml when nothing has been selected (today's exact behavior).
  const root = resolveRuntimeRoot(process.cwd(), PACKAGE_ROOT);
  const recipePaths = args.recipe ?? resolveRecipePaths(root, readActiveSelection(root));
  const primaryRecipe = Array.isArray(recipePaths) ? recipePaths[recipePaths.length - 1] : recipePaths;
  const index = await loadIndex(recipePaths, { discover: !args["no-discover"] });

  if (command === "route") {
    if (!args.prompt) {
      console.error('usage: router-cli route --prompt "..."');
      process.exitCode = 1;
      return;
    }
    const config = runtimeConfig(args, root);
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
      peakednessRatio: args.peakednessRatio ? Number(args.peakednessRatio) : config.peakednessRatio,
      denseEnabled: args["no-dense"] ? false : config.denseEnabled,
      denseThreshold: args.denseThreshold ? Number(args.denseThreshold) : config.denseThreshold,
      pushMode: config.pushMode,
      denseBlock: args["dense-block"] ? true : false,
      factors: combineFactors(
        computeFactors(dirname(resolve(primaryRecipe))),
        stackFactors(index, process.cwd()),
      ),
    };
    const engine = args.engine ?? config.engine;
    const result = await runRoute(index, args.prompt, { ...opts, engine });
    console.log(JSON.stringify(result));
    return;
  }

  if (command === "eval") {
    const config = runtimeConfig(args, root);
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
      peakednessRatio: args.peakednessRatio ? Number(args.peakednessRatio) : config.peakednessRatio,
      denseEnabled: args["no-dense"] ? false : config.denseEnabled,
      denseThreshold: args.denseThreshold ? Number(args.denseThreshold) : config.denseThreshold,
      pushMode: config.pushMode,
    };
    console.log(
      JSON.stringify(
        await runRouterEval(index, opts, {
          evalPath: args.evalPath ?? runtimeFile("docs/router-eval-set.jsonl", root),
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
    const config = runtimeConfig(args, root);
    console.log(
      JSON.stringify(
        await runRouterEvalComparison(index, config, {
          evalPath: args.evalPath ?? runtimeFile("docs/router-eval-set.jsonl", root),
          suggest: args.suggest ?? "any",
        }),
        null,
        2,
      ),
    );
    return;
  }

  if (command === "enrich") {
    // Anchored to the same recipe.yaml directory as registry.mjs's own
    // enrichCachePathFor - init/update-time only, never inside route()'s
    // hot path (loadIndex() re-discovers on every prompt).
    const feedbackRoot = dirname(resolve(primaryRecipe));
    const cachePath = args.cachePath ?? join(feedbackRoot, ".hp-state", "tool-descriptions.json");
    const timeoutMs = args.timeoutMs ? Number(args.timeoutMs) : undefined;
    const result = await runEnrichment({ cachePath, timeoutMs });
    console.log(
      JSON.stringify({
        status: "success",
        cachePath,
        enrichedCount: Object.keys(result).length,
        enrichedIds: Object.keys(result),
      }),
    );
    return;
  }

  if (command === "harvest-negatives") {
    const evalPath = args.evalPath ?? runtimeFile("docs/router-eval-set.jsonl", root);
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
    `unknown command "${command}". Use "route", "eval", "compare", "enrich", "harvest-negatives", "graph-compile", or "list".`,
  );
  process.exitCode = 1;
}

main();
