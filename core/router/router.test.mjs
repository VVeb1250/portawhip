import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex } from "../registry/registry.mjs";
import { compileCapabilityGraph } from "./capability-graph-compiler.mjs";
import { route, listAll, scoreEntry } from "./scorer.mjs";
import { buildCapabilityDocs } from "../registry/capability-docs.mjs";
import { routeHybrid } from "./hybrid-router.mjs";
import {
  _setPipelineForTest,
  _forceUnavailableForTest,
  _setPipelinePendingForTest,
} from "./dense-embedder.mjs";
import { compactRouteResult, explainRoute, runRoute } from "./route-entry.mjs";
import { triggerCoverageEvidence } from "./intent-evidence.mjs";
import { loadRouterConfig as loadConfig } from "./router-config.mjs";
import { runRouterEval } from "./router-eval.mjs";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// denseEnabled:false - these tests must stay fast, deterministic, and
// offline; real dense retrieval (core/dense-embedder.mjs) needs network and
// a 500MB+ model load on first use. Dense fusion itself gets its own test
// with an injected fake pipeline (see "hybrid: dense-only" below).
const CONFIG = { ...loadConfig(), denseEnabled: false };

test("intent evidence: declared trigger coverage stays soft when a negative and positive share the same signature", () => {
  const topicalNegative = triggerCoverageEvidence(
    ["import tool"],
    "how should a router avoid token bloat when many tools are installed",
    { source: "declared" },
  );
  const genuinePositive = triggerCoverageEvidence(["sdk usage"], "use the sdk", { source: "declared" });

  assert.equal(topicalNegative.coverage, 0.5);
  assert.equal(genuinePositive.coverage, 0.5);
  assert.equal(topicalNegative.strength, "partial");
  assert.equal(genuinePositive.strength, "partial");
  assert.equal(topicalNegative.source, "declared");
  assert.equal(topicalNegative.method, "token_overlap");
  assert.equal(topicalNegative.advisoryOnly, true);
});

test("config: push is silent by default and legacy rollback must be explicit", () => {
  const root = tempRoot("harness-router-push-mode-");
  try {
    const missing = loadConfig(join(root, "missing.yaml"));
    assert.equal(missing.pushMode, "silent");

    const path = join(root, "router.config.yaml");
    writeFileSync(path, "pushMode: legacy\n");
    assert.equal(loadConfig(path).pushMode, "legacy");

    writeFileSync(path, "pushMode: noisy-guess\n");
    assert.equal(loadConfig(path).pushMode, "silent");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(prefix = "harness-router-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

// Curated-only (discover: false) tests exercise recipe.yaml + scorer logic
// in isolation — deterministic, no dependency on what happens to be
// installed on the machine running the test.

test("trigger hit: exact word match scores 1", async () => {
  const index = await buildIndex("recipe.yaml", { discover: false });
  const entry = index.entries.find((e) => e.id === "ripgrep");
  assert.equal(scoreEntry(entry, "help me grep this repo"), 1);
});

test("phrase hit: multi-word trigger matches as a phrase", async () => {
  const index = await buildIndex("recipe.yaml", { discover: false });
  const entry = index.entries.find((e) => e.id === "pdf");
  assert.equal(scoreEntry(entry, "please merge pages of this file"), 1);
});

test("abstain: unrelated prompt returns []", async () => {
  const index = await buildIndex("recipe.yaml", { discover: false });
  const result = route(index, "design a database schema for orders", CONFIG);
  assert.deepEqual(result, []);
});

test("route: relevant prompt returns the matching entry, not others", async () => {
  const index = await buildIndex("recipe.yaml", { discover: false });
  const result = route(index, "how do I extract a table from this pdf", CONFIG);
  assert.ok(result.length >= 1);
  assert.equal(result[0].id, "pdf");
  assert.equal(result[0].tier, "required");
  assert.equal(result[0].action, "read_skill");
});

test("explainRoute: returns actionable results plus structured route metadata", async () => {
  const index = await buildIndex("recipe.yaml", { discover: false });
  const engineResults = await routeHybrid(index, "how do I extract a table from this pdf", {
    ...CONFIG,
    includeWeak: true,
  });
  const result = await explainRoute(index, "how do I extract a table from this pdf", CONFIG);
  assert.equal(result.status, "success");
  assert.equal(result.results[0].id, "pdf");
  assert.equal(result.results[0].tier, "required");
  assert.equal(result.negative_evidence, null);
  assert.ok(Number.isInteger(result.latency_ms));
  // Stage 4: decision/near_misses/reason are additive aliases of
  // status/suppressed/negative_evidence.reason, in the literal vocabulary
  // ("route"/"abstain") the decision-layer redesign asked for - never a
  // breaking rename of the original fields (this server is published).
  assert.equal(result.decision, "route");
  assert.deepEqual(result.near_misses, result.suppressed);
  assert.equal(result.reason, null);
  for (const annotated of [...result.results, ...result.suppressed]) {
    const expected = engineResults.find((item) => item.id === annotated.id);
    const { intentEvidence, ...unchanged } = annotated;
    assert.deepEqual(unchanged, expected, `delivery evidence changed engine output for ${annotated.id}`);
  }
  assert.equal(result.results[0].intentEvidence.source, "declared");
  assert.equal(result.results[0].intentEvidence.advisoryOnly, true);
});

test("runRoute: advisory intent evidence preserves keyword-engine output", async () => {
  const index = await buildIndex("recipe.yaml", { discover: false });
  const prompt = "how do I extract a table from this pdf";
  const expected = route(index, prompt, CONFIG);
  const annotated = await runRoute(index, prompt, { ...CONFIG, engine: "keyword" });

  assert.equal(annotated.length, expected.length);
  for (let i = 0; i < annotated.length; i += 1) {
    const { intentEvidence, ...unchanged } = annotated[i];
    assert.deepEqual(unchanged, expected[i]);
    assert.equal(intentEvidence.advisoryOnly, true);
  }
});

test("runRoute: silent push abstains without changing the hybrid engine candidate", async () => {
  const index = await buildIndex("recipe.yaml", { discover: false });
  const prompt = "how do I extract a table from this pdf";
  const engineCandidates = await routeHybrid(index, prompt, CONFIG);
  assert.equal(engineCandidates[0]?.id, "pdf", "characterization: engine must still retrieve pdf");

  const delivered = await runRoute(index, prompt, {
    ...CONFIG,
    engine: "hybrid",
    mode: "push",
    pushMode: "silent",
  });
  assert.deepEqual(delivered, []);
});

test("router eval: mode-aware cases exercise delivery policy instead of the engine directly", async () => {
  const root = tempRoot("harness-router-mode-eval-");
  try {
    const evalPath = join(root, "eval.jsonl");
    writeFileSync(
      evalPath,
      [
        {
          id: "raw-push-pdf",
          prompt: "how do I extract a table from this pdf",
          mode: "push",
          shouldRoute: false,
        },
        {
          id: "explicit-pdf",
          prompt: "how do I extract a table from this pdf",
          mode: "explicit",
          shouldRoute: true,
          expectedTopId: "pdf",
          expectedAnyIds: ["pdf"],
          expectedKind: "skill",
        },
        {
          id: "optional-missing-tool",
          prompt: "use a tool that is not installed in this fixture",
          mode: "explicit",
          shouldRoute: true,
          expectedTopId: "not-installed-tool",
          expectedAnyIds: ["not-installed-tool"],
          expectedKind: "tool",
          requiresInstalled: true,
        },
      ].map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
    const index = await buildIndex("recipe.yaml", { discover: false });
    const report = await runRouterEval(index, { ...CONFIG, pushMode: "silent" }, { evalPath });
    assert.equal(report.status, "success");
    assert.equal(report.metrics.falsePositiveCount, 0);
    assert.equal(report.metrics.skippedCount, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("explainRoute: empty result includes negative evidence", async () => {
  const index = await buildIndex("recipe.yaml", { discover: false });
  const result = await explainRoute(index, "what's the capital of France", CONFIG);
  assert.equal(result.status, "empty");
  assert.deepEqual(result.results, []);
  assert.equal(result.negative_evidence.result, "empty");
  assert.match(result.negative_evidence.reason, /threshold|weak|keyword/i);
  assert.equal(result.decision, "abstain");
  assert.deepEqual(result.near_misses, result.suppressed);
  assert.equal(result.reason, result.negative_evidence.reason);
});

test("compactRouteResult: emits only actionable fields for successful routes", () => {
  const result = compactRouteResult({
    status: "success",
    decision: "route",
    summary: "found 1 actionable capability match",
    results: [{
      id: "pdf",
      type: "skill",
      kind: "skill",
      score: 1.25,
      tier: "required",
      confidence: 0.98,
      why: "matched pdf",
      action: "read_skill",
      how_to_use: "Read and edit PDF files.",
      pointer: "/skills/pdf",
      origin: "recipe",
      readyMarker: null,
      readyHint: null,
      intentEvidence: { advisoryOnly: true },
    }],
    suppressed: [{ id: "noise" }],
    near_misses: [{ id: "noise" }],
    negative_evidence: null,
    reason: null,
    latency_ms: 12,
  });

  assert.equal(result.status, "success");
  assert.deepEqual(result.results, [{
    id: "pdf",
    type: "skill",
    kind: "skill",
    state: "fresh",
    tier: "required",
    action: "read_skill",
    how_to_use: "Read and edit PDF files.",
    pointer: "/skills/pdf",
  }]);
  assert.ok(!("score" in result.results[0]));
  assert.ok(!("confidence" in result.results[0]));
});

test("compactRouteResult: empty routes contain only status and reason", () => {
  const result = compactRouteResult({
    status: "empty",
    decision: "abstain",
    summary: "no actionable capability matched this task",
    results: [],
    suppressed: [{ id: "weak-match" }],
    near_misses: [{ id: "weak-match" }],
    negative_evidence: { result: "empty", reason: "only weak matches were found" },
    reason: "only weak matches were found",
    latency_ms: 7,
  });

  assert.deepEqual(result, {
    status: "empty",
    reason: "only weak matches were found",
  });
});

// One table, one index build. These were three near-identical tests that each
// rebuilt the whole index (loadIndex never caches) to assert the same shape on a
// different prompt; adding the fourth alias should cost a row, not a copy.
test("curated aliases: recipe phrasings route to the capability they name", async () => {
  const index = await buildIndex("recipe.yaml", { discover: false });
  const cases = [
    { prompt: "audit connector hook find bugs in harness config", top: "workspace-surface-audit", action: "read_skill" },
    { prompt: "fix settings.json hook for Claude Code config", top: "configure-ecc", action: "read_skill" },
    // This one also pins that a second capability rides along, so it keeps its
    // own extra assertion rather than being flattened into the table.
    { prompt: "fix bug run tests and commit after code review", top: "code-review", alsoIncludes: "verification-loop" },
  ];

  for (const { prompt, top, action, alsoIncludes } of cases) {
    const ids = (await explainRoute(index, prompt, CONFIG)).results;
    assert.equal(ids[0]?.id, top, prompt);
    if (action) assert.equal(ids[0].action, action, prompt);
    if (alsoIncludes) assert.ok(ids.map((h) => h.id).includes(alsoIncludes), `${prompt} -> ${ids.map((h) => h.id)}`);
  }
});

test("malformed route block is rejected", async () => {
  const badRecipe = "core/fixtures/bad-recipe.yaml";
  await assert.rejects(() => buildIndex(badRecipe, { discover: false }));
});

test("list: filters by type", async () => {
  const index = await buildIndex("recipe.yaml", { discover: false });
  const skills = listAll(index, "skill");
  assert.ok(skills.every((e) => e.type === "skill"));
  assert.ok(skills.some((e) => e.id === "pdf"));
});

test("budget: how_to_use string stays short (hint, not full content)", async () => {
  const index = await buildIndex("recipe.yaml", { discover: false });
  const result = route(index, "grep for a regex in the codebase", CONFIG);
  for (const r of result) {
    assert.ok(r.how_to_use.length < 300, `${r.id} how_to_use exceeds budget`);
  }
});

test("hybrid: hyphenated ids match natural spaced phrasing", async () => {
  const index = {
    entries: [
      {
        id: "database-migrations",
        type: "skill",
        origin: "auto:skill",
        path: "/skills/database-migrations",
        route: {
          triggers: ["database-migrations"],
          description: "Database migration best practices for zero-downtime deployments",
        },
      },
    ],
  };
  const result = await routeHybrid(index, "walk me through a zero-downtime database migration", {
    hybridThreshold: 2,
    k: 5,
    denseEnabled: false,
  });
  assert.equal(result[0].id, "database-migrations");
});

test("hybrid: token sequence matching does not match inside longer words", async () => {
  const index = {
    entries: [
      {
        id: "x-api",
        type: "skill",
        origin: "auto:skill",
        path: "/skills/x-api",
        route: {
          triggers: ["x-api"],
          description: "X API integration",
        },
      },
    ],
  };
  const result = await routeHybrid(index, "what's the capital of France", {
    hybridThreshold: 2,
    k: 5,
    denseEnabled: false,
  });
  assert.deepEqual(result, []);
});

test("hybrid: broad vocabulary matches are suppressed as keyword-only noise", async () => {
  const index = {
    entries: [
      {
        id: "vue-patterns",
        type: "skill",
        origin: "auto:skill",
        path: "/skills/vue-patterns",
        route: {
          triggers: ["vue-patterns"],
          description: "Vue.js component architecture patterns",
        },
      },
    ],
  };
  const result = await routeHybrid(index, "router architecture", {
    hybridThreshold: 0.01,
    includeWeak: true,
    k: 5,
    denseEnabled: false,
  });
  assert.equal(result[0].tier, "irrelevant_but_keyword_matched");
  assert.equal(result[0].action, "ignore_by_default");
});

// R6 (docs/recognition-router.md, measured in docs/router-eval-holdout.md): the
// pull path is handed a distilled action by an assistant that already filtered
// out chat, so it does not pay the bar that reading raw prompts costs.
const barProbeIndex = {
  entries: [
    {
      id: "to-prd",
      type: "skill",
      origin: "auto:skill",
      path: "/skills/to-prd",
      route: {
        triggers: ["to-prd", "prd"],
        description: "Turn the current conversation context into a PRD and publish it to the project issue tracker",
      },
    },
  ],
};

// The bars here are sized for this one-document index, NOT production's
// 350/100. minisearch scores on IDF, so absolute scores scale with corpus size:
// the query below scores 5.2 against this single doc and 110.7 against the real
// 645-capability registry. What is under test is the MECHANISM — that mode
// selects which bar applies — and pinning production's numbers here would only
// pin a fiction. Their calibration lives in router.config.yaml's comments and is
// measured by `npm run route:eval` / docs/router-eval-holdout.md.
const PROMPT = "write a PRD for a self-serve upgrade flow";
const barProbeOpts = { k: 5, denseEnabled: false, graphPath: "missing-capability-graph.json" };

test("hybrid: pull mode uses the pull bar, and the raw-prompt bar still applies elsewhere", async () => {
  const opts = { ...barProbeOpts, hybridThreshold: 10, pullHybridThreshold: 1 };

  const pull = await routeHybrid(barProbeIndex, PROMPT, { ...opts, mode: "pull" });
  assert.ok(pull.some((entry) => entry.id === "to-prd"), `pull mode must clear the pull bar, got ${pull.map((e) => e.id)}`);

  // Same index, same query, same call — only the mode differs. The asymmetry is
  // the feature: the high bar exists to survive unfiltered chat, and only the
  // pull path has something upstream that filters it.
  const explicit = await routeHybrid(barProbeIndex, PROMPT, opts);
  assert.deepEqual(explicit, [], `default mode must keep the raw-prompt bar, got ${explicit.map((e) => e.id)}`);
});

test("hybrid: a config with no pull bar falls back to the raw-prompt bar, not to zero", async () => {
  const result = await routeHybrid(barProbeIndex, PROMPT, { ...barProbeOpts, hybridThreshold: 10, mode: "pull" });
  assert.deepEqual(result, [], `missing pullHybridThreshold must fall back to hybridThreshold, got ${result.map((e) => e.id)}`);
});

test("hybrid: suggest filters split skills from tools", async () => {
  const index = {
    entries: [
      {
        id: "pdf-skill",
        type: "skill",
        origin: "auto:skill",
        path: "/skills/pdf-skill",
        route: {
          triggers: ["pdf"],
          description: "PDF skill",
        },
      },
      {
        id: "pdf-tool",
        type: "mcp",
        origin: "auto:mcp",
        source: "pdf-tool",
        route: {
          triggers: ["pdf"],
          description: "PDF tool",
        },
      },
    ],
  };
  // threshold near 0: this fixture's only purpose is testing suggest-kind
  // filtering, not score calibration — with just 2 docs sharing "pdf" as
  // their only trigger, idf (and thus score) is naturally tiny.
  const skills = await routeHybrid(index, "pdf", { hybridThreshold: 0.01, suggest: "skill", k: 5, denseEnabled: false });
  const tools = await routeHybrid(index, "pdf", { hybridThreshold: 0.01, suggest: "tool", k: 5, denseEnabled: false });
  assert.ok(skills.every((result) => result.kind === "skill"));
  assert.ok(tools.every((result) => result.kind === "tool"));
  assert.equal(skills[0].id, "pdf-skill");
  assert.equal(tools[0].id, "pdf-tool");
});

test("hybrid: tool and skill lanes don't crowd each other out of a shared k", async () => {
  // Same fixture as the suggest-filter test above, but called the way real
  // callers actually do (push hook / MCP route tool / router-cli route all
  // default to suggest:"any", never "skill" or "tool" alone). A single
  // shared slice-to-k treats pdf-skill and pdf-tool as competitors for the
  // same k slots even though a task usually wants both side by side (the
  // tool to do it, the skill for how to do it well) — k:1 here makes that
  // crowding impossible to miss if the fix regresses.
  const index = {
    entries: [
      {
        id: "pdf-skill",
        type: "skill",
        origin: "auto:skill",
        path: "/skills/pdf-skill",
        route: {
          triggers: ["pdf"],
          description: "PDF skill",
        },
      },
      {
        id: "pdf-tool",
        type: "mcp",
        origin: "auto:mcp",
        source: "pdf-tool",
        route: {
          triggers: ["pdf"],
          description: "PDF tool",
        },
      },
    ],
  };
  const result = await routeHybrid(index, "pdf", { hybridThreshold: 0.01, k: 1, denseEnabled: false });
  assert.ok(result.some((r) => r.id === "pdf-skill"), "skill lane must not be crowded out");
  assert.ok(result.some((r) => r.id === "pdf-tool"), "tool lane must not be crowded out");
});

test("hybrid: a lane where the top match barely beats the runner-up is silenced as diffuse noise", async () => {
  // Two docs sharing identical generic triggers score exactly tied (ratio
  // 1.0) — the same shape as the real remaining false positive (example-skill
  // vs skill-development both lit up by "router"/"skill"/"injecting").
  const index = {
    entries: [
      {
        id: "skill-a",
        type: "skill",
        origin: "auto:skill",
        path: "/skills/skill-a",
        route: { triggers: ["architecture", "pattern"], description: "Skill A" },
      },
      {
        id: "skill-b",
        type: "skill",
        origin: "auto:skill",
        path: "/skills/skill-b",
        route: { triggers: ["architecture", "pattern"], description: "Skill B" },
      },
    ],
  };
  const result = await routeHybrid(index, "architecture pattern", { hybridThreshold: 0.01, k: 5, denseEnabled: false });
  assert.equal(result.length, 0, "near-tied scores in a lane should be silenced, not guessed");
});

test("hybrid: a single dominant match in a lane still fires even with no competing runner-up", async () => {
  const index = {
    entries: [
      {
        id: "pdf-skill",
        type: "skill",
        origin: "auto:skill",
        path: "/skills/pdf-skill",
        route: { triggers: ["pdf"], description: "PDF skill" },
      },
    ],
  };
  const result = await routeHybrid(index, "pdf", { hybridThreshold: 0.01, k: 5, denseEnabled: false });
  assert.ok(result.some((r) => r.id === "pdf-skill"));
});

// Fake extractor: keyed by exact input text so vectors (and thus cosine
// similarity) are fully controlled, no real model/network involved. Query
// and doc text share zero real vocabulary on purpose - the whole point is
// proving dense rescues a case sparse structurally cannot reach at all
// (sparse.length === 0), the same shape as the real e2e-testing miss
// (docs/router-eval-set.jsonl) that motivated adding this channel.
function fakeExtractor(vectors) {
  return async (text) => ({ data: vectors[text] ?? [0, 0, 1] });
}

test("hybrid: dense channel rescues a paraphrase with zero shared vocabulary", async () => {
  const index = {
    entries: [
      {
        id: "wibble-skill",
        type: "skill",
        origin: "auto:skill",
        path: "/skills/wibble-skill",
        route: { triggers: ["wibble"], description: "wibble wobble gadzooks" },
      },
    ],
  };
  _setPipelineForTest(
    fakeExtractor({
      "xyzzy quux frobnicate": [1, 0, 0],
      "wibble-skill wibble wibble wobble gadzooks": [0.99, 0.1411, 0],
    }),
  );
  try {
    const result = await routeHybrid(index, "xyzzy quux frobnicate", {
      hybridThreshold: 350,
      k: 5,
      denseEnabled: true,
      denseThreshold: 0.5,
    });
    assert.ok(result.some((r) => r.id === "wibble-skill"), "dense channel should surface a pure paraphrase miss");
  } finally {
    _forceUnavailableForTest();
  }
});

test("hybrid: dense channel degrades to sparse-only behavior when the model is unavailable", async () => {
  const index = {
    entries: [
      {
        id: "wibble-skill",
        type: "skill",
        origin: "auto:skill",
        path: "/skills/wibble-skill",
        route: { triggers: ["wibble"], description: "wibble wobble gadzooks" },
      },
    ],
  };
  _forceUnavailableForTest();
  const result = await routeHybrid(index, "xyzzy quux frobnicate", {
    hybridThreshold: 350,
    k: 5,
    denseEnabled: true,
    denseThreshold: 0.5,
  });
  assert.deepEqual(result, [], "no lexical match + unavailable dense = same silent abstain as sparse-only");
});

test("hybrid: denseBlock:false returns sparse-only while the model is still warming, then dense once ready", async () => {
  const index = {
    entries: [
      {
        id: "wibble-skill",
        type: "skill",
        origin: "auto:skill",
        path: "/skills/wibble-skill",
        route: { triggers: ["wibble"], description: "wibble wobble gadzooks" },
      },
    ],
  };
  const opts = { hybridThreshold: 350, k: 5, denseEnabled: true, denseThreshold: 0.5, denseBlock: false };

  // Model still loading in the background: a non-blocking caller (the MCP
  // server's tier) must NOT await it - it gets sparse-only this call. With no
  // lexical match either, that means a silent abstain, never a 73s hang.
  _setPipelinePendingForTest();
  const whileWarming = await routeHybrid(index, "xyzzy quux frobnicate", opts);
  assert.deepEqual(whileWarming, [], "non-blocking call must not wait on a cold model load");

  // Once warm, the same non-blocking call picks dense up with no code change.
  _setPipelineForTest(
    fakeExtractor({
      "xyzzy quux frobnicate": [1, 0, 0],
      "wibble-skill wibble wibble wobble gadzooks": [0.99, 0.1411, 0],
    }),
  );
  try {
    const warmed = await routeHybrid(index, "xyzzy quux frobnicate", opts);
    assert.ok(warmed.some((r) => r.id === "wibble-skill"), "dense joins in once the model is ready");
  } finally {
    _forceUnavailableForTest();
  }
});

test("hybrid: capability docs enrich skills from SKILL metadata without bloating results", async () => {
  const index = {
    entries: [
      {
        id: "viewport-audit",
        type: "skill",
        origin: "auto:skill",
        path: "core/fixtures/skill-with-metadata",
        route: {
          triggers: ["viewport-audit"],
          description: "Viewport inspection",
        },
      },
    ],
  };
  const docs = buildCapabilityDocs(index);
  assert.match(docs[0].text, /mobile toolbar wrapping/);
  assert.match(docs[0].text, /responsive viewport failures/);

  const result = await routeHybrid(index, "mobile toolbar wrapping layout check", {
    hybridThreshold: 2,
    suggest: "skill",
    k: 5,
    denseEnabled: false,
  });
  assert.equal(result[0].id, "viewport-audit");
  assert.equal(result[0].how_to_use, "Viewport inspection");
  assert.ok(result[0].how_to_use.length < 300);
});

test("hybrid graph: expands only from seeded candidates", async () => {
  const index = {
    entries: [
      {
        id: "database-migrations",
        type: "skill",
        origin: "auto:skill",
        path: "/skills/database-migrations",
        route: {
          triggers: ["database-migrations"],
          description: "Database migration best practices",
        },
      },
      {
        id: "postgres-patterns",
        type: "skill",
        origin: "auto:skill",
        path: "/skills/postgres-patterns",
        route: {
          triggers: ["postgres-patterns"],
          description: "PostgreSQL schema design",
        },
      },
    ],
  };
  const result = await routeHybrid(index, "database migration rollout", {
    graphPath: "core/fixtures/capability-graph.json",
    graphBoost: 0.5,
    hybridThreshold: 2,
    k: 5,
    denseEnabled: false,
  });
  assert.equal(result[0].id, "database-migrations");
  assert.ok(result.some((r) => r.id === "postgres-patterns" && r.graphBoosted));
});

test("graph compiler: links related skills and tools from capability docs", () => {
  const index = {
    entries: [
      {
        id: "e2e-testing",
        type: "skill",
        origin: "auto:skill",
        path: null,
        route: {
          triggers: ["e2e-testing", "playwright"],
          description: "Playwright E2E testing patterns",
        },
      },
      {
        id: "playwright",
        type: "mcp",
        origin: "auto:mcp",
        source: "@playwright/mcp",
        route: {
          triggers: ["playwright"],
          description: "MCP server: playwright",
        },
      },
    ],
  };
  const graph = compileCapabilityGraph(index, { minScore: 2, maxEdgesPerNode: 2 });
  assert.ok(
    graph.edges.some(
      (edge) =>
        edge.from === "e2e-testing" &&
        edge.to === "playwright" &&
        edge.type === "skill_uses_tool",
    ),
  );
});

test("hybrid graph: abstains when retrieval has no seed", async () => {
  const index = {
    entries: [
      {
        id: "database-migrations",
        type: "skill",
        origin: "auto:skill",
        path: "/skills/database-migrations",
        route: {
          triggers: ["database-migrations"],
          description: "Database migration best practices",
        },
      },
      {
        id: "postgres-patterns",
        type: "skill",
        origin: "auto:skill",
        path: "/skills/postgres-patterns",
        route: {
          triggers: ["postgres-patterns"],
          description: "PostgreSQL schema design",
        },
      },
    ],
  };
  const result = await routeHybrid(index, "write a poem", {
    graphPath: "core/fixtures/capability-graph.json",
    graphBoost: 1,
    hybridThreshold: 2,
    k: 5,
    denseEnabled: false,
  });
  assert.deepEqual(result, []);
});

// Discovery (discover: true) tests hit the real machine's installed
// tools/skills/servers — assertions stay loose (structure + precedence),
// not tied to exact counts, since installed content varies by machine.

test("discovery: curated entry wins over its auto-discovered twin", async () => {
  const index = await buildIndex("recipe.yaml", { discover: true });
  const context7Entries = index.entries.filter((e) => e.id === "context7");
  assert.equal(context7Entries.length, 1, "no duplicate id after merge");
  assert.equal(context7Entries[0].origin, "recipe");
  assert.equal(
    context7Entries[0].route.description,
    "Fetch current docs/examples for a library, framework, or API",
  );
});

test("discovery: auto-discovered entries carry an origin tag", async () => {
  const index = await buildIndex("recipe.yaml", { discover: true });
  const auto = index.entries.filter((e) => e.origin !== "recipe");
  for (const e of auto) {
    assert.ok(e.origin.startsWith("auto:"), `${e.id} missing auto: origin tag`);
    assert.ok(Array.isArray(e.route.triggers) && e.route.triggers.length > 0);
  }
});
