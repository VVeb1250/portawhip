import assert from "node:assert/strict";
import test from "node:test";
import { buildIndex } from "../registry/registry.mjs";
import { loadConfig } from "../state/config.mjs";
import { routeHybrid } from "./hybrid-router.mjs";

const index = await buildIndex("recipe.yaml", { discover: false });
const cleanConfig = {
  ...loadConfig(),
  graphPath: "missing-capability-graph.json",
  factors: null,
  denseEnabled: false,
};

test("a direct curated trigger routes without machine-local graph or feedback state", async () => {
  const result = await routeHybrid(index, "grep for TODO comments in this codebase", cleanConfig);
  assert.ok(result.some((entry) => entry.id === "ripgrep"), `expected ripgrep, got ${result.map((entry) => entry.id)}`);
});

test("generic token overlap does not inherit the direct-trigger trust path", async () => {
  const result = await routeHybrid(
    index,
    "why did the old skill-router hook misfire while we were discussing harness architecture",
    cleanConfig,
  );
  assert.deepEqual(result, []);
});

