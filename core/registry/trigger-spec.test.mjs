import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildIndex, readRawEntries } from "./registry.mjs";
import { normalizeTriggerSpec } from "./trigger-spec.mjs";
import { route } from "../router/scorer.mjs";

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

test("trigger specs: skipWhen parses, survives indexing, and never filters retrieval", async () => {
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
    const index = await buildIndex(recipe, { discover: false });
    assert.deepEqual(index.entries[0].route.skipWhen, ["plain text search", "non-code documents"]);

    const results = route(index, "plain text search", {
      threshold: 1,
      recipeThreshold: 1,
      k: 5,
    });
    assert.deepEqual(results.map((item) => item.id), ["codegraph"]);
    assert.deepEqual(results[0].skipWhen, ["plain text search", "non-code documents"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
