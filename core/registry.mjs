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
    // matching in adapters/claude-code/feedback-mark-hook.mjs.
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

export async function buildIndex(recipePath = "recipe.yaml", { discover = true } = {}) {
  const raw = yaml.load(readFileSync(recipePath, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`${recipePath}: expected a top-level list of entries`);

  const curated = raw.map((entry) => {
    if (!entry.id || !entry.type) {
      throw new Error(`malformed entry (missing id/type): ${JSON.stringify(entry)}`);
    }
    return {
      id: entry.id,
      type: entry.type,
      source: entry.source,
      path: entry.path ?? null,
      origin: "recipe",
      route: validateRoute(entry),
    };
  });

  // recipe.yaml stays authoritative for anything it names — a hand-authored
  // entry wins over its auto-discovered twin so deliberate route metadata
  // is never silently overwritten by inferred keywords.
  const curatedIds = new Set(curated.map((e) => e.id));
  const discovered = discover
    ? (await discoverAll()).filter((e) => !curatedIds.has(e.id))
    : [];

  const entries = [...curated, ...discovered];
  const index = { generatedAt: new Date().toISOString(), entries };
  const cachePath = cachePathFor(recipePath);
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
  const cachePath = cachePathFor(recipePath);
  if (!existsSync(cachePath)) return null;
  return JSON.parse(readFileSync(cachePath, "utf8"));
}
