#!/usr/bin/env node
// Import direction (Phase S1): read what's actually installed across hosts
// (via the same core/discover.mjs the router already uses) and PROPOSE it as
// persistent, shareable canonical entries — CLI/skill into recipes/
// imported.yaml, MCP into .rulesync/mcp.json for the sole fan-out writer.
//
// This owns no discovery or sync logic: discovery is discover.mjs, fan-out is
// the existing loader/agents-dotdir lanes. Import only diffs "installed
// somewhere" against "already canonical" and writes the gap where the user
// approves it. Same status -> preview -> apply gate as sync-config.mjs;
// silence (nothing new) is a valid, expected result.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as yaml from "js-yaml";
import { readActiveSelection, resolveRecipePaths } from "../../core/state/bundle-state.mjs";
import { readRawEntries } from "../../core/registry/registry.mjs";
import { discoverAll } from "../../core/registry/discover.mjs";
import { enrichCliLadder } from "../../core/registry/cli-enrich.mjs";
import { normalizeMcpConfig, unionMcpServers } from "../../core/surface/rulesync-canonical.mjs";

const VALID_ACTIONS = new Set(["status", "preview", "apply"]);
const IMPORTED_RECIPE = ["cli", "skill", "command", "agent"]; // land in imported.yaml
const RULESYNC_MCP = ["mcp"]; // land in .rulesync/mcp.json
// Surfaces shown in full (every id listed) vs summarized (count + sample);
// nothing is hidden — large groups just don't flood the preview. No type is
// suppressed by default: display groups by surface, apply still needs an
// explicit selector for the big groups so nothing pours in unintentionally.
const FULL_LIST_TYPES = new Set(["cli", "mcp"]);
const SAMPLE = 6;

export function parseArgs(argv) {
  const args = {
    action: argv[2] ?? "status",
    types: null,
    include: null,
    json: false,
    allowApply: false,
  };
  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--type" || arg === "--types") {
      args.types = String(argv[i + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      i += 1;
    } else if (arg === "--include") {
      args.include = String(argv[i + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      i += 1;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--apply") {
      args.allowApply = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!VALID_ACTIONS.has(args.action)) {
    throw new Error("usage: import-surfaces.mjs <status|preview|apply> [--type cli,mcp,skill,command,agent] [--include id,id] [--json] [--apply]");
  }
  if (args.action === "apply" && !args.allowApply) {
    throw new Error("apply requires an explicit --apply flag; run preview first");
  }
  return args;
}

// Ids already canonical: curated recipe/bundle/imported entries + MCP servers
// already declared in .agents/agents.json. A candidate matching any of these
// is not "new" and is skipped.
export function knownIds({ root, recipePaths, mcpJson, agentsJson }) {
  const ids = new Set();
  for (const path of recipePaths) {
    if (!existsSync(path)) continue;
    for (const entry of readRawEntries(path)) if (entry.id) ids.add(entry.id);
  }
  const servers = mcpJson?.mcpServers ?? agentsJson?.mcp?.servers ?? {};
  for (const name of Object.keys(servers)) ids.add(name);
  return ids;
}

// Pure: filter discovered entries down to the ones worth proposing. No type
// is suppressed by default (grouped display handles volume); an explicit
// --type or --include narrows it.
export function computeCandidates({ discovered, known, types, include }) {
  const typeSet = types && types.length ? new Set(types) : null;
  const includeSet = include && include.length ? new Set(include) : null;
  return discovered.filter((entry) => {
    if (known.has(entry.id)) return false;
    if (includeSet) return includeSet.has(entry.id) || includeSet.has(`${entry.type}:${entry.id}`);
    if (typeSet) return typeSet.has(entry.type);
    return true;
  });
}

// Pure: a discovered entry is "bare" if discovery gave it no real trigger
// surface beyond its own name (the dead-weight case the enrich ladder exists
// to fix). Used as the auto-junk gate for CLI import.
export function isBare(entry) {
  const triggers = entry.route?.triggers ?? [];
  const nonSelf = triggers.filter((t) => t !== entry.id && t !== entry.source);
  return nonSelf.length === 0;
}

// Pure: shape a discovered entry into a recipe-file entry, recording
// provenance so a later forget/doctor can see it was imported (and when).
// `enrichment` (optional) is the CLI ladder result — when present its
// triggers/description win (promote bare -> useful). Returns null to HOLD
// BACK a still-bare CLI entry: the auto-junk gate that replaces manual
// approval (an entry that would only ever match its own name isn't worth
// fanning out to every host).
export function toRecipeEntry(entry, enrichment = null) {
  const route = enrichment
    ? {
        triggers: enrichment.triggers,
        description: enrichment.description,
        when: entry.route?.when ?? ["user_prompt"],
        inject: entry.route?.inject ?? "hint",
      }
    : {
        triggers: entry.route?.triggers ?? [entry.id],
        description: entry.route?.description ?? `${entry.type}: ${entry.id}`,
        when: entry.route?.when ?? ["user_prompt"],
        inject: entry.route?.inject ?? "hint",
      };
  if (entry.type === "cli" && !enrichment && isBare(entry)) return null;
  const out = {
    id: entry.id,
    type: entry.type,
    source: entry.source ?? entry.id,
    route,
    imported: {
      at: new Date().toISOString(),
      via: `discover:${entry.type}`,
      ...(enrichment ? { enriched: enrichment.sources } : {}),
    },
  };
  if (entry.path) out.path = entry.path;
  return out;
}

// Pure: merge new recipe entries into an existing imported.yaml list,
// first-seen (existing) wins so re-running apply is idempotent.
export function mergeImported(existing, additions) {
  const byId = new Map();
  for (const entry of existing) byId.set(entry.id, entry);
  for (const entry of additions) if (!byId.has(entry.id)) byId.set(entry.id, entry);
  return [...byId.values()];
}

function readYamlList(path) {
  if (!existsSync(path)) return [];
  const raw = yaml.load(readFileSync(path, "utf8"));
  return Array.isArray(raw) ? raw : [];
}

function readRulesyncMcp(root) {
  const path = join(root, ".rulesync", "mcp.json");
  if (!existsSync(path)) return { path, json: null };
  try {
    return { path, json: JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return { path, json: null };
  }
}

// MCP launch config isn't carried by discoverMcp (it dedups to id+source), so
// fetch it from add-mcp the same way core/enrich.mjs does, only for the
// servers actually being imported.
export function collectMcpConfigs(serverNames, hosts) {
  const wanted = new Set(serverNames);
  const filtered = hosts.map((host) => ({
    ...host,
    servers: (host.servers ?? []).filter((server) => wanted.has(server.serverName) && server.config),
  }));
  const union = unionMcpServers(filtered);
  return { configs: union.servers, conflicts: union.conflicts, warnings: union.warnings };
}

async function mcpConfigs(serverNames) {
  if (!serverNames.length) return { configs: {}, conflicts: [], warnings: [] };
  const { listInstalledServers } = await import("add-mcp");
  const hosts = await listInstalledServers({ global: true });
  return collectMcpConfigs(serverNames, hosts);
}

// Pure: add imported MCP servers into rulesync's canonical mcpServers map.
export function mergeRulesyncMcp(mcpJson, mcpEntries, configs) {
  const json = mcpJson
    ? structuredClone(mcpJson)
    : { $schema: "https://github.com/dyoshikawa/rulesync/releases/download/v9.6.3/mcp-schema.json", mcpServers: {} };
  json.mcpServers = json.mcpServers ?? {};
  const added = [];
  for (const entry of mcpEntries) {
    if (json.mcpServers[entry.id]) continue;
    const config = configs[entry.id];
    if (!config) continue; // no launch config recoverable -> skip, report
    const normalized = normalizeMcpConfig(config);
    if (!normalized.config) continue;
    json.mcpServers[entry.id] = normalized.config;
    added.push(entry.id);
  }
  return { json, added };
}

export async function collectImport({ root = resolve("."), action = "status", types = null, include = null } = {}) {
  const selection = readActiveSelection(root);
  const recipePaths = resolveRecipePaths(root, selection);
  const { json: mcpJson, path: mcpPath } = readRulesyncMcp(root);
  const known = knownIds({ root, recipePaths, mcpJson });
  const discovered = await discoverAll();
  const candidates = computeCandidates({ discovered, known, types, include });

  const byLane = { recipe: [], rulesyncMcp: [] };
  for (const entry of candidates) {
    if (RULESYNC_MCP.includes(entry.type)) byLane.rulesyncMcp.push(entry);
    else if (IMPORTED_RECIPE.includes(entry.type)) byLane.recipe.push(entry);
  }

  const result = {
    root,
    action,
    discoveredCount: discovered.length,
    knownCount: known.size,
    candidates: candidates.map((e) => ({ id: e.id, type: e.type })),
    lanes: {
      recipe: byLane.recipe.map((e) => e.id),
      rulesyncMcp: byLane.rulesyncMcp.map((e) => e.id),
    },
    applied: null,
  };

  // Group counts for display are useful in every mode.
  result.groups = groupByType(candidates);

  if (action !== "apply") return result;

  // apply
  const importedPath = join(root, "recipes", "imported.yaml");
  const existing = readYamlList(importedPath);

  // Auto-enrich CLI candidates inline (promote bare -> useful) so imported
  // entries route on natural phrasing, not just their own name. The ladder is
  // the quality gate: a CLI that can't be enriched and is still bare is held
  // back by toRecipeEntry (returns null).
  const cliIds = byLane.recipe.filter((e) => e.type === "cli").map((e) => e.id);
  const enrichment = cliIds.length ? await enrichCliLadder(cliIds) : {};

  const additions = [];
  const heldBack = [];
  for (const entry of byLane.recipe) {
    const built = toRecipeEntry(entry, entry.type === "cli" ? enrichment[entry.id] ?? null : null);
    if (built) additions.push(built);
    else heldBack.push(entry.id);
  }
  const merged = mergeImported(existing, additions);
  const mcpDiscovery = await mcpConfigs(byLane.rulesyncMcp.map((e) => e.id));
  if (mcpDiscovery.conflicts.length > 0) {
    result.applied = {
      status: "blocked",
      wrote: [],
      conflicts: mcpDiscovery.conflicts,
      warnings: mcpDiscovery.warnings,
      mcpSkipped: byLane.rulesyncMcp.map((entry) => entry.id),
      heldBack,
    };
    return result;
  }
  const { json: newMcp, added: mcpAdded } = mergeRulesyncMcp(
    mcpJson,
    byLane.rulesyncMcp,
    mcpDiscovery.configs,
  );

  const wrote = [];
  if (additions.length) {
    writeFileSync(importedPath, yaml.dump(merged, { lineWidth: 100 }));
    wrote.push({ path: importedPath, added: additions.map((e) => e.id) });
  }
  if (mcpAdded.length) {
    writeFileSync(mcpPath, `${JSON.stringify(newMcp, null, 2)}\n`);
    wrote.push({ path: mcpPath, added: mcpAdded });
  }
  const mcpSkipped = byLane.rulesyncMcp.map((e) => e.id).filter((id) => !mcpAdded.includes(id));
  result.applied = { wrote, mcpSkipped, heldBack };
  return result;
}

// Pure: group candidate {id,type} rows by surface type.
export function groupByType(candidates) {
  const groups = {};
  for (const c of candidates) (groups[c.type] ??= []).push(c.id);
  return groups;
}

function printText(result) {
  console.log(`import ${result.action}`);
  console.log(`discovered ${result.discoveredCount} across hosts; ${result.knownCount} already canonical`);
  console.log(`new candidates: ${result.candidates.length}`);
  // Grouped by surface with real counts; nothing hidden. Small groups list
  // every id; large groups show a sample + how to import fully.
  const groups = result.groups ?? {};
  for (const type of Object.keys(groups).sort()) {
    const ids = groups[type];
    if (FULL_LIST_TYPES.has(type) || ids.length <= SAMPLE) {
      console.log(`  ${type} (${ids.length}): ${ids.join(", ")}`);
    } else {
      console.log(`  ${type} (${ids.length}): ${ids.slice(0, SAMPLE).join(", ")}, … +${ids.length - SAMPLE}`);
      console.log(`      import all: --type ${type}   |   one: --include ${type}:<id>`);
    }
  }
  if (!result.candidates.length) console.log("  (nothing new to import — silence is a valid result)");
  if (result.applied) {
    for (const w of result.applied.wrote) console.log(`WROTE ${w.path}: +${w.added.length} (${w.added.join(", ")})`);
    if (result.applied.heldBack?.length) {
      console.log(`HELD BACK (bare, could not enrich — not worth fanning out): ${result.applied.heldBack.join(", ")}`);
    }
    if (result.applied.mcpSkipped.length) {
      console.log(`SKIPPED (no recoverable launch config): ${result.applied.mcpSkipped.join(", ")}`);
    }
    if (result.applied.status === "blocked") {
      console.log(`BLOCKED (conflicting host MCP variants): ${result.applied.conflicts.map((item) => item.name).join(", ")}`);
    } else {
      console.log("next: run `portawhip sync apply --scope project --apply` to fan out through the guarded reconciler.");
    }
  } else if (result.action === "preview") {
    console.log("next: re-run with `apply --apply` to write these; hand-curated recipe.yaml always wins on id collision.");
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const result = await collectImport({
    root: resolve("."),
    action: args.action,
    types: args.types,
    include: args.include,
  });
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else printText(result);
  process.exitCode = 0;
}

import { pathToFileURL } from "node:url";

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
