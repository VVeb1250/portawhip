import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { providerBoundaryViolations } from "./provider-boundary.mjs";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test("portawhip never imports a capability provider directly", () => {
  const violations = providerBoundaryViolations(ROOT);
  assert.deepEqual(
    violations,
    [],
    "these modules import an optional provider instead of resolving it at runtime, " +
      "which makes portawhip fail to install without it\n" +
      violations.map((v) => `  ${v.file} -> ${v.specifier}`).join("\n"),
  );
});

test("the router is not a dependency of portawhip", async () => {
  const { default: pkg } = await import("../../package.json", { with: { type: "json" } });
  assert.ok(!pkg.dependencies?.["portawhip-router"], "the router must never be a hard dependency");
  assert.equal(pkg.peerDependenciesMeta?.["portawhip-router"]?.optional, true);
  // The heavy retrieval dependencies left with the router; a portawhip install
  // must not pull a 500MB+ embedding model for a user who only wants sync.
  for (const dep of ["@huggingface/transformers", "minisearch"]) {
    assert.ok(!pkg.dependencies?.[dep], `${dep} belongs to the router, not portawhip`);
  }
});

test("the check catches a direct provider import when one is introduced", () => {
  const root = mkdtempSync(join(tmpdir(), "portawhip-boundary-"));
  try {
    mkdirSync(join(root, "core", "state"), { recursive: true });
    writeFileSync(join(root, "core", "state", "clean.mjs"), 'import { x } from "./other.mjs";\n');
    assert.deepEqual(providerBoundaryViolations(root), []);

    writeFileSync(join(root, "core", "state", "leaky.mjs"), 'import { hooks } from "portawhip-router/provider";\n');
    const violations = providerBoundaryViolations(root);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].specifier, "portawhip-router/provider");

    // The seam itself names the specifier, and that is allowed — it is a string
    // handed to import(), not a resolved dependency.
    rmSync(join(root, "core", "state", "leaky.mjs"));
    writeFileSync(
      join(root, "core", "state", "capability-providers.mjs"),
      'export const S = ["portawhip-router/provider"];\nawait import("portawhip-router/provider");\n',
    );
    assert.deepEqual(providerBoundaryViolations(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
