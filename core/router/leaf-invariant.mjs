// The router must stay a leaf.
//
// Extracting core/router/ into its own package is only mechanical for as long
// as nothing outside it imports from it. Every such import is a back-edge that
// has to be unpicked later, and they reappear easily — one convenient helper
// pulled from ../router/ and the boundary is gone again without anyone noticing.
// This makes that regression a failing test rather than a Phase-2 surprise.
//
// The one permitted reference is the provider seam, and even that is not an
// import: core/state/capability-providers.mjs names "../router/provider.mjs" as
// a specifier string resolved at runtime, so the dependency is optional by
// construction.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".git", ".codegraph", ".hp-state", "graphify-out"]);
const ROUTER_DIR = join("core", "router");

// Matches the specifier of a static import, a re-export, or a dynamic import().
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*)["']([^"']+)["']/g;

function* sourceFiles(root, dir = root) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* sourceFiles(root, path);
    else if (entry.endsWith(".mjs")) yield path;
  }
}

function importsIn(source) {
  const specifiers = [];
  for (const match of source.matchAll(IMPORT_RE)) specifiers.push(match[1]);
  return specifiers;
}

// Returns every file outside core/router/ that imports something inside it.
export function routerLeafViolations(root) {
  const violations = [];
  for (const path of sourceFiles(root)) {
    const rel = relative(root, path);
    if (rel.startsWith(ROUTER_DIR + sep)) continue;
    for (const specifier of importsIn(readFileSync(path, "utf8"))) {
      if (!specifier.startsWith(".")) continue;
      if (/(^|\/)router\//.test(specifier.replaceAll("\\", "/"))) {
        violations.push({ file: rel, specifier });
      }
    }
  }
  return violations;
}
