import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildIndex, readRawEntries } from "./registry.mjs";
import { discoverCli } from "./discover.mjs";
import { mergeEnrichmentRecords } from "./enrich.mjs";
import { normalizeTriggerSpec } from "./trigger-spec.mjs";

const RECIPE_PATHS = [
  "recipe.yaml",
  "recipes/foundry.yaml",
  "recipes/roles/backend-data.yaml",
  "recipes/roles/coding.yaml",
  "recipes/roles/frontend.yaml",
  "recipes/roles/research.yaml",
  "recipes/roles/secure.yaml",
];

test("trigger specs: every curated route has request-language positives and negative guidance", () => {
  for (const path of RECIPE_PATHS) {
    for (const entry of readRawEntries(path).filter((item) => item.route)) {
      assert.ok(entry.route.triggers.length >= 3, `${path}:${entry.id} needs at least three positive triggers`);
      assert.ok(entry.route.skipWhen?.length > 0, `${path}:${entry.id} needs skipWhen guidance`);
    }
  }
});

test("trigger specs: an entry with hand-written triggers gets no generic fallbacks", () => {
  // The hybrid engine tokenizes triggers, so a `${id} tool` fallback puts the
  // bare term "tool" into the index and every prompt containing that word
  // partially matches. Injecting fallbacks into an entry that is already
  // reachable is therefore pure downside — it cost one hard-negative
  // (eval `hard-graph-rag`, abstainAccuracy 0.95 -> 0.90) before this guard.
  const spec = normalizeTriggerSpec({
    id: "codegraph",
    type: "mcp",
    triggers: ["codegraph", "symbols", "call paths", "callers"],
    skipWhen: ["plain text search"],
  });

  assert.deepEqual(spec.triggers, ["codegraph", "symbols", "call paths", "callers"]);
  for (const generic of ["tool", "use", "capability"]) {
    assert.ok(
      !spec.triggers.some((trigger) => trigger.toLowerCase().split(/\s+/).includes(generic)),
      `"${generic}" must not enter the trigger vocabulary of an already-reachable entry`,
    );
  }
});

test("trigger specs: discovery fallbacks always provide at least three positive phrases", () => {
  const spec = normalizeTriggerSpec({
    id: "example-tool",
    type: "mcp",
    description: "MCP server: example-tool",
    triggers: ["example-tool"],
  });

  assert.ok(spec.triggers.length >= 3);
  assert.ok(spec.triggers.includes("use example-tool"));
});

test("trigger specs: refresh enrichment preserves existing negative guidance", () => {
  const merged = mergeEnrichmentRecords(
    {
      codegraph: {
        type: "mcp",
        description: "old",
        triggers: ["codegraph", "trace callers", "call paths"],
        skipWhen: ["plain text search"],
      },
    },
    {
      codegraph: {
        type: "mcp",
        description: "refreshed",
        triggers: ["codegraph", "trace callers", "call paths"],
      },
    },
  );

  assert.equal(merged.codegraph.description, "refreshed");
  assert.deepEqual(merged.codegraph.skipWhen, ["plain text search"]);
});

test("trigger specs: skipWhen survives enrichment-cache discovery", () => {
  const root = mkdtempSync(join(tmpdir(), "portawhip-trigger-enrich-"));
  const cache = join(root, "tool-descriptions.json");
  writeFileSync(
    cache,
    JSON.stringify({
      "example-tool": {
        type: "cli",
        description: "CLI tool: example-tool ? inspect example data",
        triggers: ["example-tool", "inspect example data", "query example data"],
        skipWhen: ["production mutations"],
      },
    }),
  );

  try {
    const entries = discoverCli(cache, () => ({
      status: 0,
      stdout: JSON.stringify({ "example-tool": [] }),
    }));
    assert.deepEqual(entries[0].route.skipWhen, ["production mutations"]);
    assert.ok(entries[0].route.triggers.length >= 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The other half of this — that skipWhen reaches a caller through retrieval and
// never filters it — is asserted in core/router/skip-when.test.mjs. It lives
// there because it is a routing claim, and the registry must not import the
// router (see core/router/leaf-invariant.mjs).
test("trigger specs: skipWhen parses and survives indexing", async () => {
  const root = mkdtempSync(join(tmpdir(), "portawhip-trigger-spec-"));
  const recipe = join(root, "recipe.yaml");
  writeFileSync(
    recipe,
    [
      "- id: codegraph",
      "  type: mcp",
      "  source: codegraph",
      "  route:",
      "    description: Trace callers over a code knowledge graph",
      "    triggers: [trace callers, call paths, plain text search]",
      "    skipWhen: [plain text search, non-code documents]",
      "",
    ].join("\n"),
  );

  try {
    const index = await buildIndex(recipe, { discover: false, providerEntries: [] });
    assert.deepEqual(index.entries[0].route.skipWhen, ["plain text search", "non-code documents"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
