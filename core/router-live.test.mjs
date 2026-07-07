import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildIndex } from "./registry.mjs";
import { loadConfig } from "./config.mjs";
import { routeHybrid } from "./hybrid-router.mjs";
import { stackFactors } from "./stack-detect.mjs";

// Live routing tests - the real router, on real prompts, against this
// machine's REAL installed capabilities (recipe.yaml + live discovery). The
// "hybrid: ..." tests in router.test.mjs are deliberately synthetic (a 1-2
// entry hand-built index + a fake extractor) to isolate mechanics - lane
// split, the peakedness gate, fusion math. That is exactly what makes them
// unable to tell you whether the router is actually *smart* on a real prompt
// against 300+ real skills. This file closes that gap: no fixtures, no mocks.
//
// denseEnabled:false on purpose. These assert routing DECISIONS (route vs
// abstain), and the decisions that matter here - the false positives found
// live this session - are driven by the sparse channel and reproduce without
// the model. Keeping dense off makes the test deterministic and offline; the
// dense channel's own behavior is covered by the fake-extractor fusion tests
// and the live e2e proof in server/mcp-server.test.mjs.
//
// Factors: the real MCP/CLI path applies combineFactors(computeFactors,
// stackFactors). We apply stackFactors only (it is derived from this repo's
// files on disk - deterministic) and deliberately omit computeFactors (it
// reads the live feedback log, which varies run to run). Applying stackFactors
// matters: it is what tipped the "push hook complaint" false positive over the
// bar in the real CLI path - leaving it out made the test quietly disagree
// with production, the exact eval-vs-live gap these tests exist to close.

let index;
let config;
let factors;

before(async () => {
  index = await buildIndex("recipe.yaml", { discover: true });
  config = { ...loadConfig(), denseEnabled: false };
  factors = stackFactors(index, process.cwd());
});

function route(prompt) {
  return routeHybrid(index, prompt, { ...config, factors });
}

test("live: a curated capability routes on a real task prompt", async () => {
  const result = await route("grep for TODO comments in this codebase");
  assert.ok(result.length > 0, "expected a routing decision, got abstain");
  assert.ok(result.some((r) => r.id === "ripgrep"), `expected ripgrep, got ${result.map((r) => r.id).join(",")}`);
});

test("live: an unrelated general-knowledge prompt abstains", async () => {
  const result = await route("what's the capital of France");
  assert.deepEqual(result, [], `expected abstain, got ${result.map((r) => r.id).join(",")}`);
});

test("live: a meta prompt reflecting on the router itself abstains", async () => {
  // Talking ABOUT the router is not a request to USE a capability. This one
  // already abstains correctly today - it guards against a regression that
  // would make the router fire on discussion of its own internals.
  const result = await route("reflect on whether the router suggests tools and skills intelligently");
  assert.deepEqual(result, [], `expected abstain on meta discussion, got ${result.map((r) => r.id).join(",")}`);
});

test("live: a design-discussion prompt about routing internals abstains", async () => {
  // Probed 2026-07-07: most meta/research/design prompts already abstain -
  // the existing peakedness gate + broad-term suppression handle them. This
  // guards that the router doesn't regress into firing on its own design talk.
  const result = await route("how should a capability router decide when to abstain versus inject");
  assert.deepEqual(result, [], `expected abstain on design discussion, got ${result.map((r) => r.id).join(",")}`);
});

// --- Known live failure (todo) — the spec for the stage-1 intent gate. ------
// The ONE meta prompt that still false-positives deterministically (probed
// 2026-07-07 across the real index): it is saturated with capability-name
// vocab ("MCP", "tools", "skills"), so build-mcp-server/build-mcp-app clear
// the bar even though the user is researching the domain, not asking to build
// a server. This is the narrow, real remaining job of the intent gate. Marked
// todo, not skipped: node runs it, reports expected-failing, keeps the suite
// green, and flags it the day it starts passing so it gets promoted to a hard
// assertion. Do NOT "fix" it by loosening the assertion - fix it by building
// the gate.
//
// (A second, separate FP axis exists but is deliberately NOT tested here
// because it is non-deterministic: a capability that has been used before can
// get boosted by computeFactors' feedback signal onto a tangential prompt -
// found live, but it depends on feedback-log state, so it can't be a stable
// committed assertion.)
test("live [intent-gate TODO]: a capability-vocab-saturated research prompt must abstain", { todo: true }, async () => {
  const result = await route("research MCP availability and live precision for dynamic tools and skills and future agents");
  assert.deepEqual(result, [], `expected abstain, got ${result.map((r) => r.id).join(",")}`);
});
