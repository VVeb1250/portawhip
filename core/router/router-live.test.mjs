import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildIndex } from "../registry/registry.mjs";
import { loadConfig } from "../state/config.mjs";
import { routeHybrid } from "./hybrid-router.mjs";
import { stackFactors } from "../state/stack-detect.mjs";

// Clean-state routing tests - the real router, on requested-action summaries,
// against the default curated recipe with no machine-local discovery, graph,
// or feedback state. The
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
// Stack factors remain enabled because they are derived from repository files
// and are deterministic. Live discovery and learned feedback have their own
// focused tests and must not decide whether this suite passes on a clean CI
// runner.

let index;
let config;
let factors;

before(async () => {
  index = await buildIndex("recipe.yaml", { discover: false });
  config = { ...loadConfig(), graphPath: "missing-capability-graph.json", denseEnabled: false };
  factors = stackFactors(index, process.cwd());
});

function route(prompt) {
  return routeHybrid(index, prompt, { ...config, factors });
}

test("clean state: a curated capability routes on a requested-action summary", async () => {
  const result = await route("search codebase for TODO comments");
  assert.ok(result.length > 0, "expected a routing decision, got abstain");
  assert.ok(result.some((r) => r.id === "ripgrep"), `expected ripgrep, got ${result.map((r) => r.id).join(",")}`);
});

test("clean state: an unrelated requested action abstains", async () => {
  const result = await route("identify the capital of France");
  assert.deepEqual(result, [], `expected abstain, got ${result.map((r) => r.id).join(",")}`);
});

test("clean state: a router-analysis action abstains", async () => {
  // Talking ABOUT the router is not a request to USE a capability. This one
  // already abstains correctly today - it guards against a regression that
  // would make the router fire on discussion of its own internals.
  const result = await route("assess router suggestion quality");
  assert.deepEqual(result, [], `expected abstain on meta discussion, got ${result.map((r) => r.id).join(",")}`);
});

test("clean state: a routing-policy action abstains", async () => {
  // Probed 2026-07-07: most meta/research/design prompts already abstain -
  // the existing peakedness gate + broad-term suppression handle them. This
  // guards that the router doesn't regress into firing on its own design talk.
  const result = await route("compare capability-router abstention and injection policies");
  assert.deepEqual(result, [], `expected abstain on design discussion, got ${result.map((r) => r.id).join(",")}`);
});

// Stage-1 intent gate (fixed 2026-07-07). This prompt used to be the one
// deterministic false positive: saturated with capability-name vocab ("MCP",
// "tools", "skills"), it matched build-mcp-server/build-mcp-app purely on
// {mcp, tool, skill} and cleared the bar, because "mcp" wasn't yet classed as
// generic. Diagnosing the actual matched terms (not guessing) showed this
// needed no heavy semantic classifier - the overlap was entirely the
// capability system's OWN vocabulary. Adding mcp/cli/capability to
// hybrid-router.mjs's BROAD_TERMS makes weakKeywordOnly suppress it on the
// sparse channel; the dense channel abstains on its own (abstract-research
// cosine stays under denseThreshold). Verified clean on BOTH channels.
//
// (A second, separate FP axis exists but is deliberately NOT tested here
// because it is non-deterministic: a capability that has been used before can
// get boosted by computeFactors' feedback signal onto a tangential prompt -
// found live, but it depends on feedback-log state, so it can't be a stable
// committed assertion.)
test("clean state: a capability-vocab-saturated research action abstains (intent gate)", async () => {
  const result = await route("research MCP availability for dynamic agent capabilities");
  assert.deepEqual(result, [], `expected abstain on capability-domain research, got ${result.map((r) => r.id).join(",")}`);
});

// The eval's `intent-research-mcp-domain` prompt — the longer form of the case
// above, and the one that kept escaping after that fix. Two leaks the short
// prompt does not reach: "live"/"dynamic" were not yet generic, and curated
// entries were exempt from weakKeywordOnly entirely, so this repo's own
// portawhip skill matched it on {mcp, live, tool, skill} with every one of
// those already classed broad. Both are registry-wide, so assert against the
// real index rather than the synthetic one in the precision regressions.
test("clean state: the long capability-vocab research prompt abstains, curated entries included", async () => {
  const result = await route(
    "research MCP availability and live precision for dynamic tools and skills and future agents",
  );
  assert.deepEqual(result, [], `expected abstain on capability-domain research, got ${result.map((r) => r.id).join(",")}`);
});
