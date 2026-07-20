import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildIndex } from "../registry/registry.mjs";
import { route } from "./scorer.mjs";

// skipWhen is advice carried to the caller, not a retrieval filter: a
// capability whose skipWhen matches the query must still be returned, with the
// caveat attached, so the model can make the call. Parsing and indexing of the
// same field is covered in core/registry/trigger-spec.test.mjs.
test("skipWhen reaches the caller through retrieval and never filters it", async () => {
  const root = mkdtempSync(join(tmpdir(), "portawhip-skip-when-"));
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
