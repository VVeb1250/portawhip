import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { routerLeafViolations } from "./leaf-invariant.mjs";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test("nothing outside core/router imports from it", () => {
  const violations = routerLeafViolations(ROOT);
  assert.deepEqual(
    violations,
    [],
    "the router must stay extractable: these files import it directly instead of going through the provider seam\n" +
      violations.map((v) => `  ${v.file} -> ${v.specifier}`).join("\n"),
  );
});

// The check is only worth having if it actually fails when the boundary breaks.
test("the check catches a back-edge when one is introduced", () => {
  const root = mkdtempSync(join(tmpdir(), "portawhip-leaf-"));
  try {
    mkdirSync(join(root, "core", "router"), { recursive: true });
    mkdirSync(join(root, "core", "state"), { recursive: true });
    writeFileSync(join(root, "core", "router", "tokenize.mjs"), "export const tokenize = () => [];\n");
    writeFileSync(join(root, "core", "state", "clean.mjs"), 'import { x } from "./other.mjs";\n');
    assert.deepEqual(routerLeafViolations(root), []);

    writeFileSync(join(root, "core", "state", "leaky.mjs"), 'import { tokenize } from "../router/tokenize.mjs";\n');
    const violations = routerLeafViolations(root);
    assert.equal(violations.length, 1);
    assert.match(violations[0].file, /leaky\.mjs$/);
    assert.equal(violations[0].specifier, "../router/tokenize.mjs");

    // A dynamic import is the same back-edge wearing a different hat.
    rmSync(join(root, "core", "state", "leaky.mjs"));
    writeFileSync(join(root, "core", "state", "sneaky.mjs"), 'await import("../router/tokenize.mjs");\n');
    assert.equal(routerLeafViolations(root).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
