#!/usr/bin/env node

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import spawnSync from "cross-spawn";
import { syncSurfaces } from "./sync-surfaces.mjs";

function localAgents(root) {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  const candidate = join(root, "node_modules", ".bin", `agents${suffix}`);
  return existsSync(candidate) ? candidate : "agents";
}

export function shouldSyncAfterAgents(args) {
  const [command, subcommand] = args.filter((arg) => !arg.startsWith("-"));
  if (command === "connect" || command === "disconnect") return true;
  if (command === "mcp" && ["add", "import", "remove"].includes(subcommand)) return true;
  return false;
}

function parseScope(args) {
  const index = args.indexOf("--scope");
  if (index === -1) return "project";
  return args[index + 1] === "project" ? "project" : "global";
}

async function main() {
  const root = resolve(".");
  const args = process.argv.slice(2);
  const result = spawnSync.sync(localAgents(root), args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    return;
  }
  if (!shouldSyncAfterAgents(args)) return;

  console.log("\n== surface auto-sync after agents change ==");
  const syncResult = await syncSurfaces({ root, scope: parseScope(args) });
  const ok = syncResult.lanes.every((lane) => lane.ok);
  for (const lane of syncResult.lanes) {
    const count = typeof lane.count === "number" ? ` (${lane.count} item(s))` : "";
    console.log(`${lane.ok ? "OK  " : "FAIL"} ${lane.lane}: ${lane.backend} ${lane.action}${count}`);
  }
  process.exitCode = ok ? 0 : 1;
}

import { pathToFileURL } from "node:url";

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
