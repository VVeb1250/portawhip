import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveRuntimeRoot } from "./bundle-state.mjs";

test("resolveRuntimeRoot prefers a workspace recipe and otherwise uses the package root", () => {
  const workspace = mkdtempSync(join(tmpdir(), "portawhip-workspace-"));
  const packageRoot = mkdtempSync(join(tmpdir(), "portawhip-package-"));
  try {
    writeFileSync(join(packageRoot, "recipe.yaml"), "[]\n");
    assert.equal(resolveRuntimeRoot(workspace, packageRoot), packageRoot);

    writeFileSync(join(workspace, "recipe.yaml"), "[]\n");
    assert.equal(resolveRuntimeRoot(workspace, packageRoot), workspace);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(packageRoot, { recursive: true, force: true });
  }
});

