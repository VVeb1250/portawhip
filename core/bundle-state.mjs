// Bundle selection (2026-07-05): tracks which opt-in recipe files a user has
// turned on, and resolves that selection into the ordered path list
// registry.mjs (routing) and scripts/load.mjs (install) both consume.
//
// Every rule below traces back to one decision made explicit with the owner:
// bundles are recommend-only, never forced. `foundry` is whipforaweeb's
// curated core but stays opt-out; `roles` are whipforaweeb's role-based
// add-ons and a user may tick zero, one, or many. Nothing here auto-selects
// anything — the default (no selection file) is exactly today's behavior:
// just the project's own recipe.yaml, unchanged.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import yaml from "js-yaml";

export function activeSelectionPathFor(root) {
  return join(root, ".hp-state", "active-recipes.json");
}

export function readActiveSelection(root) {
  const path = activeSelectionPathFor(root);
  if (!existsSync(path)) return { foundry: false, roles: [] };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return {
      foundry: raw.foundry === true,
      roles: Array.isArray(raw.roles) ? raw.roles.filter((r) => typeof r === "string") : [],
    };
  } catch {
    // A corrupted selection file should degrade to "nothing selected", not
    // crash routing/install — same fail-open posture as the rest of this repo.
    return { foundry: false, roles: [] };
  }
}

export function writeActiveSelection(root, selection) {
  const path = activeSelectionPathFor(root);
  mkdirSync(dirname(path), { recursive: true });
  const normalized = {
    foundry: selection.foundry === true,
    roles: [...new Set(selection.roles ?? [])],
  };
  writeFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

// The bundle-only portion of a selection (foundry.yaml + selected
// recipes/roles/*.yaml, NOT the project's own recipe.yaml). Exposed
// separately so scripts/bundles.mjs's `select` can install exactly what was
// just opted into, right away — without reinstalling the project's own
// recipe.yaml entries every time a bundle changes.
export function resolveBundlePaths(root, selection) {
  const paths = [];
  if (selection.foundry) {
    const p = join(root, "recipes", "foundry.yaml");
    if (existsSync(p)) paths.push(p);
  }
  for (const role of selection.roles ?? []) {
    const p = join(root, "recipes", "roles", `${role}.yaml`);
    if (existsSync(p)) paths.push(p);
  }
  return paths;
}

// Resolves a selection into the ordered recipe-file list, skipping anything
// missing rather than throwing — an empty/no-op selection (or a project with
// no recipes/ directory at all yet) degrades to exactly today's single-recipe
// behavior. Order matters: registry.mjs/load.mjs both treat the LAST path as
// highest precedence, so the project's own recipe.yaml always goes last.
//
// userRecipe is anchored to `root`, not process.cwd() — this server/hook is
// invoked globally from ANY caller cwd (that's the whole point), so a
// cwd-relative resolve would silently look in the CALLER's directory instead
// of this repo's own recipe.yaml. Same failure mode already fixed once for
// router.config.yaml's graphPath (see server/mcp-server.mjs's own comment).
export function resolveRecipePaths(root, selection, { userRecipe = "recipe.yaml" } = {}) {
  const paths = resolveBundlePaths(root, selection);
  // Imported surfaces (Phase S1): user-approved entries promoted from live
  // host discovery by scripts/import-surfaces.mjs. Always-on (not an opt-in
  // bundle), and ordered BEFORE the project's own recipe.yaml so a
  // hand-authored entry still wins on id collision. Like bundle entries, an
  // imported entry only routes if discovery independently confirms it's still
  // installed (buildIndex's fromBundle gate) — so a stale import self-heals.
  const importedPath = join(root, "recipes", "imported.yaml");
  if (existsSync(importedPath)) paths.push(importedPath);
  const userPath = isAbsolute(userRecipe) ? userRecipe : join(root, userRecipe);
  if (existsSync(userPath)) paths.push(userPath);
  return paths;
}

function safeEntryIds(path) {
  if (!existsSync(path)) return [];
  const raw = yaml.load(readFileSync(path, "utf8"));
  return Array.isArray(raw) ? raw.map((e) => e.id) : [];
}

// Catalog is read straight from recipes/ + recipes/manifest.yaml (pure data,
// no decision logic) so `scripts/bundles.mjs list` never drifts from what
// resolveRecipePaths would actually load.
export function listCatalog(root) {
  const manifestPath = join(root, "recipes", "manifest.yaml");
  const manifest = existsSync(manifestPath) ? (yaml.load(readFileSync(manifestPath, "utf8")) ?? {}) : {};

  const foundryPath = join(root, "recipes", "foundry.yaml");
  const foundry = existsSync(foundryPath)
    ? { id: "foundry", ...manifest.foundry, entryIds: safeEntryIds(foundryPath) }
    : null;

  const rolesDir = join(root, "recipes", "roles");
  const roles = existsSync(rolesDir)
    ? readdirSync(rolesDir)
        .filter((f) => f.endsWith(".yaml"))
        .map((f) => {
          const id = f.replace(/\.yaml$/, "");
          return { id, ...(manifest.roles?.[id] ?? {}), entryIds: safeEntryIds(join(rolesDir, f)) };
        })
    : [];

  return { foundry, roles };
}
