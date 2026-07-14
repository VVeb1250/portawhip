#!/usr/bin/env node

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import spawnSync from "cross-spawn";

const ROOT = dirname(fileURLToPath(import.meta.url));

export function commandFor(argv) {
  if (argv[0] === "sync") {
    return { script: join(ROOT, "sync", "reconcile.mjs"), args: argv.slice(1) };
  }
  if (argv[0] === "config") {
    return { script: join(ROOT, "config.mjs"), args: argv.slice(1) };
  }
  if (argv.length === 0 || argv[0] === "tui") {
    return { script: join(ROOT, "tui.mjs"), args: argv[0] === "tui" ? argv.slice(1) : argv };
  }
  if (argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
    return { help: true, script: null, args: [] };
  }
  throw new Error(`unknown command \"${argv[0]}\"; use portawhip config, sync, or tui`);
}

function printHelp() {
  console.log(`usage:
  portawhip                         open the interactive surface
  portawhip sync check              report generated-host drift
  portawhip sync apply --apply      backup, generate, verify, and record ownership
  portawhip sync verify             verify rulesync output and ownership hashes
  portawhip config list             show effective user + project settings
  portawhip config set <key> <value> [--scope user|project]

options for sync: --scope project|global|all  --force  --json`);
}

async function main() {
  const command = commandFor(process.argv.slice(2));
  if (command.help) {
    printHelp();
    return;
  }
  if (process.argv[2] === "sync") {
    const { runCli } = await import("./sync/reconcile.mjs");
    await runCli([process.execPath, command.script, ...command.args]);
    return;
  }
  const result = spawnSync.sync(process.execPath, [command.script, ...command.args], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
