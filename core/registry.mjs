// Parses recipe.yaml into a normalized, cached index for the router.
// recipe.yaml stays the single source of truth (PLAN.md §3) — this module
// owns no data of its own, only validation + normalization + a cache file.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import yaml from "js-yaml";
import { discoverAll } from "./discover.mjs";

// Cache lives next to whichever recipe.yaml was actually loaded — not cwd —
// so this still works when called from a globally-registered MCP server
// whose caller's cwd has nothing to do with this repo.
function cachePathFor(recipePath) {
  return join(dirname(resolve(recipePath)), ".hp-state", "route-index.json");
}

function validateRoute(entry) {
  const r = entry.route;
  if (r === undefined) return null;
  if (typeof r !== "object" || r === null) {
    throw new Error(`${entry.id}: route block must be an object`);
  }
  if (!Array.isArray(r.triggers) || r.triggers.length === 0) {
    throw new Error(`${entry.id}: route.triggers must be a non-empty array`);
  }
  for (const t of r.triggers) {
    if (typeof t !== "string" || t.trim() === "") {
      throw new Error(`${entry.id}: route.triggers must all be non-empty strings`);
    }
  }
  if (typeof r.description !== "string" || r.description.trim() === "") {
    throw new Error(`${entry.id}: route.description is required and must be a non-empty string`);
  }
  if (r.readyMarker !== undefined && typeof r.readyMarker !== "string") {
    throw new Error(`${entry.id}: route.readyMarker must be a string (relative path)`);
  }
  if (r.readyHint !== undefined && typeof r.readyHint !== "string") {
    throw new Error(`${entry.id}: route.readyHint must be a string`);
  }
  if (r.binary !== undefined && typeof r.binary !== "string") {
    throw new Error(`${entry.id}: route.binary must be a string`);
  }
  return {
    triggers: r.triggers,
    description: r.description,
    when: Array.isArray(r.when) && r.when.length > 0 ? r.when : ["user_prompt"],
    inject: r.inject === "full" ? "full" : "hint",
    // CLI entries' `source` is the package manager's name (mise/etc), which
    // often differs from the actual invoked binary (e.g. source "ripgrep"
    // -> binary "rg"). Optional, only needed for Bash-usage feedback
    // matching in adapters/hooks/universal-hook.mjs.
    binary: r.binary ?? null,
    // Per-project readiness (VISION.md gap: tools installed globally but
    // needing local init, e.g. codegraph's .codegraph/ index). Existence
    // check only — no arbitrary probe command, no shell/subprocess surface.
    // Curated-only by design: auto-discovered entries have no schema for
    // this and no reliable per-tool init-check to infer generically.
    readyMarker: r.readyMarker ?? null,
    readyHint: r.readyHint ?? null,
  };
}

export function readRawEntries(recipePath) {
  const raw = yaml.load(readFileSync(recipePath, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`${recipePath}: expected a top-level list of entries`);
  return raw;
}

// Bundle compose (2026-07-05): a caller may pass one recipe path (today's
// usage, unchanged) or an ORDERED array for the opt-in bundle layer —
// [foundry?, ...selected roles, the project's own recipe.yaml]. Later paths
// win on id collision, matching the agreed precedence "user > role >
// foundry": the project's own recipe.yaml goes last in the array so a
// deliberate project entry always overrides a same-id bundle default.
// sourceById records which path each surviving entry came from — buildIndex
// needs that provenance to decide trust tier; mergeRawEntries' own public
// contract (used by scripts/load.mjs for install-dispatch) stays a plain
// array, since install must act on a bundle entry regardless of whether
// it's installed yet — that's the whole point of installing it.
function mergeWithProvenance(paths) {
  const byId = new Map();
  const sourceById = new Map();
  for (const path of paths) {
    for (const entry of readRawEntries(path)) {
      if (!entry.id || !entry.type) {
        throw new Error(`malformed entry (missing id/type) in ${path}: ${JSON.stringify(entry)}`);
      }
      byId.set(entry.id, entry);
      sourceById.set(entry.id, path);
    }
  }
  return { byId, sourceById };
}

export function mergeRawEntries(recipePath) {
  const paths = Array.isArray(recipePath) ? recipePath : [recipePath];
  if (paths.length === 0) throw new Error("mergeRawEntries: at least one recipe path is required");
  const { byId } = mergeWithProvenance(paths);
  return [...byId.values()];
}

export async function buildIndex(recipePath = "recipe.yaml", { discover = true } = {}) {
  const paths = Array.isArray(recipePath) ? recipePath : [recipePath];
  if (paths.length === 0) throw new Error("buildIndex: at least one recipe path is required");
  // The project's own recipe.yaml is always last in a compose array (see the
  // precedence note above) and stays the one trusted-without-verification
  // tier — the pre-existing convention that whoever hand-writes an entry
  // there has already set it up. A single-path call has trustedPath === its
  // only path, so every entry is trusted and behavior is unchanged from
  // before bundles existed.
  const trustedPath = paths[paths.length - 1];
  const { byId, sourceById } = mergeWithProvenance(paths);

  const discovered = discover ? await discoverAll() : [];
  const discoveredIds = new Set(discovered.map((e) => e.id));

  // Bundle-sourced entries (foundry.yaml / recipes/roles/*.yaml) carry
  // curated route metadata but are NOT presumed installed just because a
  // user opted into that bundle — `scripts/bundles.mjs select` only records
  // intent, `scripts/load.mjs` does the actual install. Routing an entry
  // before it's installed would suggest a capability that can't run yet —
  // exactly the overclaim VISION.md's "live-probe, never overclaim" rule
  // forbids, and was caught live 2026-07-05: route() suggested gitleaks and
  // ast-grep while neither was mise-installed on this machine. Gate: a
  // bundle-sourced entry only routes once discovery independently confirms
  // it's actually present. Skipped when discover:false (curated-only tests)
  // — those calls opt out of live machine state on purpose and must stay
  // deterministic.
  const curated = [];
  for (const entry of byId.values()) {
    const fromBundle = sourceById.get(entry.id) !== trustedPath;
    if (discover && fromBundle && !discoveredIds.has(entry.id)) continue;
    curated.push({
      id: entry.id,
      type: entry.type,
      source: entry.source,
      path: entry.path ?? null,
      origin: "recipe",
      route: validateRoute(entry),
    });
  }

  // recipe.yaml stays authoritative for anything it names — a hand-authored
  // entry wins over its auto-discovered twin so deliberate route metadata
  // is never silently overwritten by inferred keywords.
  const curatedIds = new Set(curated.map((e) => e.id));
  const finalDiscovered = discover ? discovered.filter((e) => !curatedIds.has(e.id)) : [];

  const entries = [...curated, ...finalDiscovered];
  const index = { generatedAt: new Date().toISOString(), entries };
  // Cache anchors to the LAST (highest-precedence) path — for a single-path
  // call this is that same path (today's behavior, unchanged); for a bundle
  // compose it's the project's own recipe.yaml, so the cache still lands in
  // that project's .hp-state like every other per-project cache here.
  const cachePath = cachePathFor(trustedPath);
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(index, null, 2));
  return index;
}

export async function loadIndex(recipePath = "recipe.yaml", opts) {
  // Cache is a perf/inspection convenience, not a second source of truth —
  // always rebuild rather than trusting a stale cache.
  return buildIndex(recipePath, opts);
}

export function readCachedIndex(recipePath = "recipe.yaml") {
  const paths = Array.isArray(recipePath) ? recipePath : [recipePath];
  const cachePath = cachePathFor(paths[paths.length - 1]);
  if (!existsSync(cachePath)) return null;
  return JSON.parse(readFileSync(cachePath, "utf8"));
}
