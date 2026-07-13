#!/usr/bin/env node

import { resolve } from "node:path";
import { readActiveSelection, resolveRecipePaths } from "../../core/state/bundle-state.mjs";
import { mergeRawEntries } from "../../core/registry/registry.mjs";
import { detectHosts } from "../hosts.mjs";
import { installEntries } from "../load.mjs";
import { runReconcile } from "./reconcile.mjs";

const VALID_COMMANDS = new Set(["sync", "check"]);
const INSTALL_TYPES = new Set(["cli"]);

export function parseArgs(argv) {
  const args = {
    command: argv[2] ?? "sync",
    scope: "project",
    json: false,
  };

  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--scope") {
      args.scope = argv[i + 1];
      i += 1;
    } else if (arg === "--json") {
      args.json = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!VALID_COMMANDS.has(args.command)) {
    throw new Error("usage: sync-surfaces.mjs <sync|check> [--scope project|global] [--json]");
  }
  if (!["project", "global"].includes(args.scope)) throw new Error(`invalid scope "${args.scope}"`);
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

export async function syncSurfaces({ root = resolve("."), scope = "project", check = false, reconciler = runReconcile, hosts = null } = {}) {
  const absoluteRoot = resolve(root);
  const { recipePaths, entries } = recipeEntries(absoluteRoot);
  const installEntriesForSync = installableEntries(entries);
  const result = {
    root: absoluteRoot,
    mode: check ? "check" : "sync",
    recipePaths,
    lanes: [],
  };

  const reconcile = await reconciler({
    command: check ? "check" : "apply",
    scope,
    root: absoluteRoot,
    allowApply: !check,
  });
  result.lanes.push({
    lane: "fan-out",
    backend: "rulesync via reconciler",
    ok: reconcile.status === "success",
    action: check ? "check" : "sync",
    reconcile,
  });

  if (check) {
    result.lanes.push({
      lane: "cli",
      backend: "mise",
      ok: true,
      action: "planned",
      count: installEntriesForSync.length,
    });
    return result;
  }

  const detectedHosts = hosts ?? (await detectHosts());
  const installResults = installEntries(installEntriesForSync, detectedHosts, scope);
  result.lanes.push({
    lane: "cli",
    backend: "mise",
    ok: installResults.every((item) => item.ok),
    action: "sync",
    count: installResults.length,
    results: installResults,
  });

  return result;
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

async function main() {
  const args = parseArgs(process.argv);
  const root = resolve(".");
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
