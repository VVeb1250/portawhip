// portawhip must not import a capability provider.
//
// This replaces the leaf-invariant that guarded core/router/ while the router
// still lived here. The boundary is the same one, now pointing outward: a
// provider is optional, resolved at runtime by capability-providers.mjs, and
// the moment any module `import`s one directly, portawhip stops installing
// without it. That failure is quiet — everything works on the developer machine
// where the provider happens to be present — so it needs a test, not a rule.
//
// The single legitimate mention is the specifier string in PROVIDER_SPECIFIERS,
// which is data, not a dependency.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".git", ".codegraph", ".hp-state", "graphify-out"]);
// capability-providers.mjs names the specifier as data handed to import().
// The test for this rule has to name it too, in order to have something to
// detect; both are mentions, neither is a dependency.
const ALLOWED = new Set([
  "core/state/capability-providers.mjs",
  "core/state/provider-boundary.test.mjs",
]);

// Static import, re-export, or dynamic import() of a provider package.
const PROVIDER_IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*)["'](portawhip-router[^"']*)["']/g;

function* sourceFiles(root, dir = root) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* sourceFiles(root, path);
    else if (path.endsWith(".mjs")) yield path;
  }
}

export function providerBoundaryViolations(root) {
  const violations = [];
  for (const path of sourceFiles(root)) {
    const rel = relative(root, path).replaceAll("\\", "/");
    if (ALLOWED.has(rel)) continue;
    for (const match of readFileSync(path, "utf8").matchAll(PROVIDER_IMPORT_RE)) {
      violations.push({ file: rel, specifier: match[1] });
    }
  }
  return violations;
}
