import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex } from "./registry.mjs";
import { compileCapabilityGraph } from "./capability-graph-compiler.mjs";
import { route, listAll, scoreEntry } from "./scorer.mjs";
import { buildCapabilityDocs } from "./capability-docs.mjs";
import { routeHybrid } from "./hybrid-router.mjs";
import { loadConfig } from "./config.mjs";
import { CONNECTOR_TARGETS, targetsForHost } from "./connector-targets.mjs";
import { HOOK_TARGETS, hookTargetForHost } from "./hook-targets.mjs";
import { blockForVariant } from "../adapters/instructions/generate.mjs";

const CONFIG = loadConfig();

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

test("hybrid: hyphenated ids match natural spaced phrasing", () => {
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
  const result = routeHybrid(index, "walk me through a zero-downtime database migration", {
    hybridThreshold: 2,
    k: 5,
  });
  assert.equal(result[0].id, "database-migrations");
});

test("hybrid: token sequence matching does not match inside longer words", () => {
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
  const result = routeHybrid(index, "what's the capital of France", {
    hybridThreshold: 2,
    k: 5,
  });
  assert.deepEqual(result, []);
});

test("hybrid: suggest filters split skills from tools", () => {
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
  const skills = routeHybrid(index, "pdf", { hybridThreshold: 0.01, suggest: "skill", k: 5 });
  const tools = routeHybrid(index, "pdf", { hybridThreshold: 0.01, suggest: "tool", k: 5 });
  assert.ok(skills.every((result) => result.kind === "skill"));
  assert.ok(tools.every((result) => result.kind === "tool"));
  assert.equal(skills[0].id, "pdf-skill");
  assert.equal(tools[0].id, "pdf-tool");
});

test("hybrid: capability docs enrich skills from SKILL metadata without bloating results", () => {
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

  const result = routeHybrid(index, "mobile toolbar wrapping layout check", {
    hybridThreshold: 2,
    suggest: "skill",
    k: 5,
  });
  assert.equal(result[0].id, "viewport-audit");
  assert.equal(result[0].how_to_use, "Viewport inspection");
  assert.ok(result[0].how_to_use.length < 300);
});

test("hybrid graph: expands only from seeded candidates", () => {
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
  const result = routeHybrid(index, "database migration rollout", {
    graphPath: "core/fixtures/capability-graph.json",
    graphBoost: 0.5,
    hybridThreshold: 2,
    k: 5,
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

test("hybrid graph: abstains when retrieval has no seed", () => {
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
  const result = routeHybrid(index, "write a poem", {
    graphPath: "core/fixtures/capability-graph.json",
    graphBoost: 1,
    hybridThreshold: 2,
    k: 5,
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
