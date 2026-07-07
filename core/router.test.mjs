import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex } from "./registry.mjs";
import { compileCapabilityGraph } from "./capability-graph-compiler.mjs";
import { route, listAll, scoreEntry } from "./scorer.mjs";
import { buildCapabilityDocs } from "./capability-docs.mjs";
import { routeHybrid } from "./hybrid-router.mjs";
import {
  _setPipelineForTest,
  _forceUnavailableForTest,
  _setPipelinePendingForTest,
} from "./dense-embedder.mjs";
import { explainRoute } from "./route-entry.mjs";
import { loadConfig } from "./config.mjs";
import { CONNECTOR_TARGETS, targetsForHost } from "./connector-targets.mjs";
import { HOOK_TARGETS, hookTargetForHost } from "./hook-targets.mjs";
import { blockForVariant } from "../adapters/instructions/generate.mjs";
import { installEntries } from "../scripts/load.mjs";
import { discoverAgents, discoverCommands, discoverSkillsFromDirs } from "./discover.mjs";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// denseEnabled:false - these tests must stay fast, deterministic, and
// offline; real dense retrieval (core/dense-embedder.mjs) needs network and
// a 500MB+ model load on first use. Dense fusion itself gets its own test
// with an injected fake pipeline (see "hybrid: dense-only" below).
const CONFIG = { ...loadConfig(), denseEnabled: false };

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
  const result = await explainRoute(index, "how do I extract a table from this pdf", CONFIG);
  assert.equal(result.status, "success");
  assert.equal(result.results[0].id, "pdf");
  assert.equal(result.results[0].tier, "required");
  assert.equal(result.negative_evidence, null);
  assert.ok(Number.isInteger(result.latency_ms));
});

test("explainRoute: empty result includes negative evidence", async () => {
  const index = await buildIndex("recipe.yaml", { discover: false });
  const result = await explainRoute(index, "what's the capital of France", CONFIG);
  assert.equal(result.status, "empty");
  assert.deepEqual(result.results, []);
  assert.equal(result.negative_evidence.result, "empty");
  assert.match(result.negative_evidence.reason, /threshold|weak|keyword/i);
});

test("curated aliases: harness audit routes to workspace surface audit", async () => {
  const index = await buildIndex("recipe.yaml", { discover: false });
  const result = await explainRoute(index, "audit connector hook find bugs in harness config", CONFIG);
  assert.equal(result.results[0].id, "workspace-surface-audit");
  assert.equal(result.results[0].action, "read_skill");
});

test("curated aliases: fix-test-commit routes to review and verification", async () => {
  const index = await buildIndex("recipe.yaml", { discover: false });
  const result = await explainRoute(index, "fix bug run tests and commit after code review", CONFIG);
  const ids = result.results.map((hit) => hit.id);
  assert.equal(ids[0], "code-review");
  assert.ok(ids.includes("verification-loop"));
});

test("curated aliases: settings hook repair routes to configure-ecc", async () => {
  const index = await buildIndex("recipe.yaml", { discover: false });
  const result = await explainRoute(index, "fix settings.json hook for Claude Code config", CONFIG);
  assert.equal(result.results[0].id, "configure-ecc");
  assert.equal(result.results[0].action, "read_skill");
});

test("route-only entries are skipped by the loader", () => {
  const result = installEntries([{ id: "alias-only", type: "skill", source: "missing", install: false }], {
    mcpHosts: ["codex"],
    skillHosts: ["codex"],
  });
  assert.deepEqual(result, [{ id: "alias-only", ok: true, skipped: true }]);
});

test("discovery: filesystem scan includes nested Claude plugin cache skills", () => {
  const root = tempRoot();
  try {
    const skillDir = join(root, ".claude", "plugins", "cache", "ecc", "ecc", "2.0.0", ".agents", "skills", "nested-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      '---\nname: nested-plugin-skill\ndescription: Skill from Claude plugin cache\n---\n# Nested\n',
    );
    const skills = discoverSkillsFromDirs([join(root, ".claude", "plugins", "cache")]);
    assert.deepEqual(skills, [
      {
        name: "nested-plugin-skill",
        description: "Skill from Claude plugin cache",
        path: skillDir,
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("discovery: filesystem scan includes nested plugin commands", () => {
  const root = tempRoot();
  try {
    const commandDir = join(root, ".claude", "plugins", "cache", "ecc", "ecc", "2.0.0", "commands");
    mkdirSync(commandDir, { recursive: true });
    const commandPath = join(commandDir, "harness-audit.md");
    writeFileSync(commandPath, "---\ndescription: Run a deterministic harness audit.\n---\n# Harness Audit\n");
    const commands = discoverCommands([join(root, ".claude", "plugins", "cache")]);
    assert.deepEqual(commands.map((command) => ({
      id: command.id,
      type: command.type,
      path: command.path,
      kindTrigger: command.route.triggers.includes("/harness-audit"),
    })), [
      {
        id: "harness-audit",
        type: "command",
        path: commandPath,
        kindTrigger: true,
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("discovery: filesystem scan includes nested plugin agents", () => {
  const root = tempRoot();
  try {
    const agentDir = join(root, ".claude", "plugins", "cache", "ecc", "ecc", "2.0.0", "agents");
    mkdirSync(agentDir, { recursive: true });
    const agentPath = join(agentDir, "harness-optimizer.md");
    writeFileSync(
      agentPath,
      "---\nname: harness-optimizer\ndescription: Analyze and improve local agent harness configuration.\n---\n# Agent\n",
    );
    const agents = discoverAgents([join(root, ".claude", "plugins", "cache")]);
    assert.deepEqual(agents.map((agent) => ({
      id: agent.id,
      type: agent.type,
      path: agent.path,
      description: agent.route.description,
    })), [
      {
        id: "harness-optimizer",
        type: "agent",
        path: agentPath,
        description: "Analyze and improve local agent harness configuration.",
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
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

test("connectors: every instruction target has a renderable harness block", () => {
  for (const [hostId, config] of Object.entries(CONNECTOR_TARGETS)) {
    assert.ok(config.instructionTargets.length > 0, `${hostId} has no instruction targets`);
    for (const target of config.instructionTargets) {
      const block = blockForVariant(target.variant);
      assert.match(block, /harness-router:start/);
      assert.match(block, /route\(task summary\)/);
    }
  }
});

test("connectors: scope filter returns only requested targets", () => {
  assert.ok(targetsForHost("codex", { scope: "global" }).every((target) => target.scope === "global"));
  assert.ok(targetsForHost("codex", { scope: "project" }).every((target) => target.scope === "project"));
  assert.deepEqual(targetsForHost("claude-desktop", { scope: "project" }), []);
});

test("hooks: native targets map logical events to host events", () => {
  assert.equal(HOOK_TARGETS["claude-code"].events.user_prompt, "UserPromptSubmit");
  assert.equal(HOOK_TARGETS.codex.events.post_tool, "PostToolUse");
  assert.equal(HOOK_TARGETS["gemini-cli"].events.user_prompt, "BeforeAgent");
  assert.equal(HOOK_TARGETS["gemini-cli"].events.post_tool, "AfterTool");
  assert.equal(hookTargetForHost("cursor", { scope: "project" }), null);
});

test("hooks: scoped targets resolve project and global paths", () => {
  const project = hookTargetForHost("codex", { scope: "project" });
  const global = hookTargetForHost("codex", { scope: "global" });
  assert.match(project.path.replace(/\\/g, "/"), /\.codex\/hooks\.json$/);
  assert.match(global.path.replace(/\\/g, "/"), /\.codex\/hooks\.json$/);
  assert.notEqual(project.path, global.path);
});
