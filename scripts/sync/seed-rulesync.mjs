#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { seedMcpCanonical } from "../../core/surface/rulesync-canonical.mjs";

export function parseArgs(argv) {
  const args = { command: argv[2] ?? "preview", scope: "project", allowApply: false, json: false };
  for (let index = 3; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--scope") {
      args.scope = argv[index + 1];
      index += 1;
    } else if (arg === "--apply") {
      args.allowApply = true;
    } else if (arg === "--json") {
      args.json = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!["preview", "apply"].includes(args.command)) throw new Error("usage: seed-rulesync.mjs <preview|apply> [--scope project|global|all] [--apply]");
  if (!["project", "global", "all"].includes(args.scope)) throw new Error(`invalid scope \"${args.scope}\"`);
  if (args.command === "apply" && !args.allowApply) throw new Error("apply requires an explicit --apply flag");
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const scopes = args.scope === "all" ? ["project", "global"] : [args.scope];
  const results = [];
  for (const scope of scopes) {
    results.push(await seedMcpCanonical({ root: resolve("."), scope, apply: args.command === "apply" }));
  }
  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const result of results) {
      console.log(`${result.scope}: ${result.status}; ${result.count} MCP server(s); ${result.conflicts.length} conflict(s); ${result.warnings.length} warning(s)`);
      console.log(`  canonical: ${result.path}`);
      for (const conflict of result.conflicts) console.log(`  conflict: ${conflict.name} (${conflict.hosts.join(", ")})`);
      for (const warning of result.warnings) console.log(`  warning: ${warning}`);
    }
  }
  process.exitCode = results.every((result) => ["preview", "success"].includes(result.status)) ? 0 : 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
