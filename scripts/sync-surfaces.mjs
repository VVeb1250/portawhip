#!/usr/bin/env node

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import spawnSync from "cross-spawn";
import { activeSelectionPathFor, readActiveSelection, resolveRecipePaths } from "../core/bundle-state.mjs";
import { mergeRawEntries } from "../core/registry.mjs";
import { detectHosts } from "./hosts.mjs";
import { installEntries } from "./load.mjs";

const VALID_COMMANDS = new Set(["sync", "check", "watch"]);
const INSTALL_TYPES = new Set(["cli", "skill"]);

function localBin(root, name) {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  const candidate = join(root, "node_modules", ".bin", `${name}${suffix}`);
  return existsSync(candidate) ? candidate : name;
}

export function parseArgs(argv) {
  const args = {
    command: argv[2] ?? "sync",
    scope: "project",
    intervalMs: 1200,
    once: false,
    json: false,
  };

  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--scope") {
      args.scope = argv[i + 1];
      i += 1;
    } else if (arg === "--interval") {
      args.intervalMs = Number(argv[i + 1]);
      i += 1;
    } else if (arg === "--once") {
      args.once = true;
    } else if (arg === "--json") {
      args.json = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!VALID_COMMANDS.has(args.command)) {
    throw new Error("usage: sync-surfaces.mjs <sync|check|watch> [--scope project|global] [--interval ms] [--once] [--json]");
  }
  if (!["project", "global"].includes(args.scope)) throw new Error(`invalid scope "${args.scope}"`);
  if (!Number.isFinite(args.intervalMs) || args.intervalMs <= 0) throw new Error("invalid --interval");
  return args;
}

export function installableEntries(entries) {
  return entries.filter((entry) => entry.install !== false && INSTALL_TYPES.has(entry.type));
}

function recipeEntries(root) {
  const recipePaths = resolveRecipePaths(root, readActiveSelection(root));
  return {
    recipePaths,
    entries: mergeRawEntries(recipePaths),
  };
}

function run(command, args, { cwd }) {
  const result = spawnSync.sync(command, args, { cwd, stdio: "inherit" });
  return result.status === 0;
}

export async function syncSurfaces({ root = resolve("."), scope = "project", check = false, runner = run, hosts = null } = {}) {
  const absoluteRoot = resolve(root);
  const { recipePaths, entries } = recipeEntries(absoluteRoot);
  const installEntriesForSync = installableEntries(entries);
  const result = {
    root: absoluteRoot,
    mode: check ? "check" : "sync",
    recipePaths,
    lanes: [],
  };

  const agentsArgs = ["sync", "--verbose"];
  if (check) agentsArgs.push("--check");
  const mcpOk = runner(localBin(absoluteRoot, "agents"), agentsArgs, { cwd: absoluteRoot });
  result.lanes.push({
    lane: "mcp",
    backend: "agents",
    ok: mcpOk,
    action: check ? "check" : "sync",
  });

  if (check) {
    result.lanes.push({
      lane: "cli+skills",
      backend: "mise+agent-skill-manager",
      ok: true,
      action: "planned",
      count: installEntriesForSync.length,
    });
    return result;
  }

  const detectedHosts = hosts ?? (await detectHosts());
  const installResults = installEntries(installEntriesForSync, detectedHosts, scope);
  result.lanes.push({
    lane: "cli+skills",
    backend: "mise+agent-skill-manager",
    ok: installResults.every((item) => item.ok),
    action: "sync",
    count: installResults.length,
    results: installResults,
  });
  return result;
}

function sourceFiles(root) {
  const files = [
    join(root, ".agents", "agents.json"),
    join(root, ".agents", "local.json"),
    join(root, "recipe.yaml"),
    activeSelectionPathFor(root),
  ];
  const dirs = [join(root, ".agents", "skills"), join(root, "recipes")];
  for (const dir of dirs) collectFiles(dir, files);
  return files.filter(existsSync);
}

function collectFiles(path, files) {
  if (!existsSync(path)) return;
  const stat = statSync(path);
  if (stat.isFile()) {
    files.push(path);
    return;
  }
  if (!stat.isDirectory()) return;
  for (const child of readdirSync(path)) collectFiles(join(path, child), files);
}

function fingerprint(root) {
  return sourceFiles(root)
    .sort()
    .map((path) => {
      const stat = statSync(path);
      return `${path}:${stat.mtimeMs}:${stat.size}`;
    })
    .join("|");
}

function printResult(result, json = false) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`surface ${result.mode}: ${result.lanes.every((lane) => lane.ok) ? "success" : "warning"}`);
  for (const lane of result.lanes) {
    const count = typeof lane.count === "number" ? ` (${lane.count} item(s))` : "";
    console.log(`${lane.ok ? "OK  " : "FAIL"} ${lane.lane}: ${lane.backend} ${lane.action}${count}`);
  }
}

async function runWatch({ root, scope, intervalMs, once, json }) {
  let last = fingerprint(root);
  let syncing = false;
  const runOne = async () => {
    if (syncing) return;
    syncing = true;
    try {
      printResult(await syncSurfaces({ root, scope }), json);
    } finally {
      syncing = false;
    }
  };

  await runOne();
  if (once) return;
  console.log(`watching surface sources every ${intervalMs}ms`);
  setInterval(async () => {
    const next = fingerprint(root);
    if (next === last) return;
    last = next;
    await runOne();
  }, intervalMs);
}

async function main() {
  const args = parseArgs(process.argv);
  const root = resolve(".");
  if (args.command === "watch") {
    await runWatch({ root, scope: args.scope, intervalMs: args.intervalMs, once: args.once, json: args.json });
    return;
  }
  const result = await syncSurfaces({ root, scope: args.scope, check: args.command === "check" });
  printResult(result, args.json);
  process.exitCode = result.lanes.every((lane) => lane.ok) ? 0 : 1;
}

import { pathToFileURL } from "node:url";

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
