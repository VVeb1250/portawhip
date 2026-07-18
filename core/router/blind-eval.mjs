// Blind-prompt eval: the instrument docs/router-eval-set.jsonl cannot be.
//
// That set is 38 cases written by the router's author over the author's own
// capabilities, and it scores 1.0 on precision@1, recall@3, MRR and abstain
// accuracy. docs/router-eval-holdout.md already showed what that is worth
// against strangers' prompts (27.5% top-1, 49% top-3) — but the 194 prompts it
// measured were never committed, so its numbers cannot be reproduced or used to
// referee a change. This rebuilds a runnable equivalent.
//
// Construction, deliberately mirroring that method:
//   - Prompts written by agents with NO access to this repo or its registry.
//   - Group A = genuine work requests, group B = hard negatives that reuse
//     group A's vocabulary but request nothing.
//   - Labels applied by DIFFERENT agents, given the capability list but never
//     the router's output, and instructed that "none" is frequently correct.
//
// Two query fields per case, and they measure different paths:
//   - `prompt` is the raw user message. Running it here is the push path.
//   - `distilled` is what the assistant sends to route() under its stated
//     contract ("only the positively requested action and its direct object").
//     This is the pull path, and it is the one production actually uses.
// Scoring raw prompts against pull thresholds flatters nothing and measures
// nothing real — pass the field you mean.
//
// Three populations, scored separately because they answer different questions:
//   - answerable (truthId !== "none"): can the router find it? recall/MRR.
//   - actionable-but-unanswerable (truthId === "none"): real request, nothing
//     installed fits. Firing here is noise, and it is the failure mode a lower
//     threshold buys most of.
//   - non-actionable (group B): discussion. Firing here is the alert-fatigue
//     failure (F3) that makes users abandon the channel.

import { readFileSync } from "node:fs";
import { runRoute } from "./route-entry.mjs";

export function loadBlindSet(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function rankOf(ids, accepted) {
  const wanted = new Set(accepted);
  const index = ids.findIndex((id) => wanted.has(id));
  return index === -1 ? null : index + 1;
}

// The labels were drawn from a capability list containing only skills and
// agents, so the router must be scored over that same universe — otherwise a
// correct MCP/CLI answer counts as a miss purely because the labeller was never
// shown it. Restricting the index here rather than via config.routeTypes is
// deliberate: it keeps this number reproducible regardless of how
// router.config.yaml is set in a given checkout.
function restrictToLabelUniverse(index, types) {
  const allow = new Set(types);
  return { ...index, entries: index.entries.filter((entry) => allow.has(entry.type)) };
}

export async function runBlindEval(index, config, options = {}) {
  const {
    setPath,
    engine = "hybrid",
    mode = "pull",
    field = "distilled",
    routeOptions = {},
    types = ["skill", "agent"],
    // Feeds the case's needServer/needTool to the two engine stages separately,
    // which is what MCP-Zero's <tool_assistant> contract actually produces. The
    // default (one query used at both levels) is a degenerate form of it, and
    // measuring only that would test the hierarchy while withholding the thing
    // that gives it two levels to work with.
    splitQuery = false,
  } = options;
  const cases = loadBlindSet(setPath);
  const scopedIndex = restrictToLabelUniverse(index, types);

  const answerable = { count: 0, top1: 0, hit3: 0, hit5: 0, rrSum: 0, miss: 0, stageSum: 0 };
  const unanswerable = { count: 0, fired: 0 };
  const discussion = { count: 0, fired: 0 };
  const misses = [];
  const wrongTop1 = [];
  const byDomain = new Map();
  const rows = [];

  for (const testCase of cases) {
    // `prompt` is the raw message and always present; the derived query fields
    // (distilled, need) are null exactly when the case is not a work request.
    // On the pull path that null IS the outcome — the assistant never calls
    // route() — so score it as a correct abstention rather than falling back to
    // the raw prompt, which would measure the push path while claiming pull.
    const rawField = field === "prompt";
    const query = rawField ? testCase.prompt : testCase[field];
    const skipped = !rawField && !query;
    const perCase =
      splitQuery && !skipped
        ? { serverQuery: testCase.needServer ?? query, toolQuery: testCase.needTool ?? query }
        : {};
    const results = skipped
      ? []
      : await runRoute(scopedIndex, query, {
          ...config,
          ...routeOptions,
          ...perCase,
          engine,
          mode,
          denseBlock: true,
          suggest: "any",
        });
    const ids = results.map((result) => result.id);
    rows.push({ id: testCase.id, query: skipped ? null : query, got: ids });

    if (!testCase.actionable) {
      discussion.count += 1;
      if (ids.length > 0) discussion.fired += 1;
      continue;
    }
    if (testCase.truthId === "none") {
      unanswerable.count += 1;
      if (ids.length > 0) unanswerable.fired += 1;
      continue;
    }

    const accepted = testCase.truthAny?.length ? testCase.truthAny : [testCase.truthId];
    const rank = rankOf(ids, accepted);
    const bucket = byDomain.get(testCase.domain) ?? { count: 0, hit3: 0 };
    bucket.count += 1;

    answerable.count += 1;
    answerable.stageSum += ids.length;
    if (ids[0] === testCase.truthId) answerable.top1 += 1;
    if (rank !== null) {
      answerable.rrSum += 1 / rank;
      if (rank <= 3) {
        answerable.hit3 += 1;
        bucket.hit3 += 1;
      }
      if (rank <= 5) answerable.hit5 += 1;
    } else {
      answerable.miss += 1;
      misses.push({ id: testCase.id, domain: testCase.domain, want: testCase.truthId, query, got: ids });
    }
    if (ids[0] !== testCase.truthId) {
      wrongTop1.push({ id: testCase.id, want: testCase.truthId, got: ids.slice(0, 3) });
    }
    byDomain.set(testCase.domain, bucket);
  }

  const n = answerable.count || 1;
  return {
    engine,
    mode,
    field,
    metrics: {
      answerableCount: answerable.count,
      top1: answerable.top1 / n,
      top3: answerable.hit3 / n,
      top5: answerable.hit5 / n,
      mrr: answerable.rrSum / n,
      missCount: answerable.miss,
      missRate: answerable.miss / n,
      avgStageSize: answerable.stageSum / n,
      unanswerableCount: unanswerable.count,
      noiseOnUnanswerable: unanswerable.count ? unanswerable.fired / unanswerable.count : 0,
      discussionCount: discussion.count,
      falsePositiveOnDiscussion: discussion.count ? discussion.fired / discussion.count : 0,
    },
    byDomain: Object.fromEntries(
      [...byDomain.entries()].map(([domain, bucket]) => [
        domain,
        { count: bucket.count, top3: bucket.count ? bucket.hit3 / bucket.count : 0 },
      ]),
    ),
    misses,
    wrongTop1: wrongTop1.slice(0, 40),
    rows,
  };
}
