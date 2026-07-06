import { readFileSync } from "node:fs";
import { routeHybrid } from "./hybrid-router.mjs";
import { route } from "./scorer.mjs";

export function loadEvalSet(path = "docs/router-eval-set.jsonl") {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function rankOf(results, expectedIds) {
  const ids = new Set(expectedIds);
  const index = results.findIndex((result) => ids.has(result.id));
  return index === -1 ? null : index + 1;
}

function emptyKindMetrics() {
  return { positiveCount: 0, top1Correct: 0, recall3Correct: 0, reciprocalRankSum: 0 };
}

function publicKindMetrics(metrics) {
  return {
    positiveCount: metrics.positiveCount,
    precisionAt1: metrics.positiveCount ? metrics.top1Correct / metrics.positiveCount : 0,
    recallAt3: metrics.positiveCount ? metrics.recall3Correct / metrics.positiveCount : 0,
    mrr: metrics.positiveCount ? metrics.reciprocalRankSum / metrics.positiveCount : 0,
  };
}

export async function runRouterEval(index, config, { evalPath, engine = "hybrid", suggest = "any" } = {}) {
  const cases = loadEvalSet(evalPath);
  const routeFn =
    engine === "keyword"
      ? async (prompt, caseSuggest) => route(index, prompt, { ...config, suggest: caseSuggest })
      : async (prompt, caseSuggest) => routeHybrid(index, prompt, { ...config, suggest: caseSuggest });

  const failures = [];
  let positiveCount = 0;
  let top1Correct = 0;
  let recall3Correct = 0;
  let reciprocalRankSum = 0;
  let negativeCount = 0;
  let abstainCorrect = 0;
  let falsePositiveCount = 0;
  const byKind = { skill: emptyKindMetrics(), tool: emptyKindMetrics() };

  for (const testCase of cases) {
    const testSuggest = testCase.suggest ?? suggest;
    const results = await routeFn(testCase.prompt, testSuggest);
    const ids = results.map((result) => result.id);
    if (testCase.shouldRoute) {
      positiveCount += 1;
      const kindMetrics = byKind[testCase.expectedKind] ?? null;
      if (kindMetrics) kindMetrics.positiveCount += 1;
      const rank = rankOf(results, testCase.expectedAnyIds ?? [testCase.expectedTopId]);
      if (results[0]?.id === testCase.expectedTopId) {
        top1Correct += 1;
        if (kindMetrics) kindMetrics.top1Correct += 1;
      }
      if (rank !== null && rank <= 3) {
        recall3Correct += 1;
        if (kindMetrics) kindMetrics.recall3Correct += 1;
      }
      if (rank !== null) {
        reciprocalRankSum += 1 / rank;
        if (kindMetrics) kindMetrics.reciprocalRankSum += 1 / rank;
      }
      if (results[0]?.id !== testCase.expectedTopId) {
        failures.push({
          id: testCase.id,
          expected: testCase.expectedTopId,
          suggest: testSuggest,
          got: ids,
          prompt: testCase.prompt,
        });
      }
    } else {
      negativeCount += 1;
      if (results.length === 0) {
        abstainCorrect += 1;
      } else {
        falsePositiveCount += 1;
        failures.push({
          id: testCase.id,
          expected: "[]",
          suggest: testSuggest,
          got: ids,
          prompt: testCase.prompt,
        });
      }
    }
  }

  const metrics = {
    positiveCount,
    precisionAt1: positiveCount ? top1Correct / positiveCount : 0,
    recallAt3: positiveCount ? recall3Correct / positiveCount : 0,
    mrr: positiveCount ? reciprocalRankSum / positiveCount : 0,
    negativeCount,
    abstainAccuracy: negativeCount ? abstainCorrect / negativeCount : 0,
    falsePositiveCount,
    byKind: {
      skill: publicKindMetrics(byKind.skill),
      tool: publicKindMetrics(byKind.tool),
    },
  };
  const pass =
    metrics.precisionAt1 === 1 &&
    metrics.recallAt3 === 1 &&
    metrics.abstainAccuracy === 1 &&
    metrics.falsePositiveCount === 0;

  return {
    status: pass ? "success" : "warning",
    summary: pass ? "router eval passed" : "router eval has failures",
    engine,
    metrics,
    failures,
  };
}

export async function runRouterEvalComparison(index, config, { evalPath, suggest = "any" } = {}) {
  const keyword = await runRouterEval(index, config, {
    evalPath,
    engine: "keyword",
    suggest,
  });
  const hybrid = await runRouterEval(index, config, {
    evalPath,
    engine: "hybrid",
    suggest,
  });
  return {
    status: hybrid.status === "success" ? "success" : "warning",
    summary:
      hybrid.status === "success"
        ? "hybrid router meets the eval pass bar"
        : "hybrid router has eval failures",
    engines: {
      keyword,
      hybrid,
    },
    delta: {
      precisionAt1: hybrid.metrics.precisionAt1 - keyword.metrics.precisionAt1,
      recallAt3: hybrid.metrics.recallAt3 - keyword.metrics.recallAt3,
      mrr: hybrid.metrics.mrr - keyword.metrics.mrr,
      abstainAccuracy: hybrid.metrics.abstainAccuracy - keyword.metrics.abstainAccuracy,
      falsePositiveCount: hybrid.metrics.falsePositiveCount - keyword.metrics.falsePositiveCount,
    },
  };
}
