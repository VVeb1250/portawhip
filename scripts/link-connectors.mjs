#!/usr/bin/env node
// Cross-host connector linker for harness-router.
//
// This does not install MCP servers itself; add-mcp remains the delegated
// installer. The script verifies the MCP link and upserts the small instruction
// connector block into every known host instruction surface for a selected
// scope (project by default, global when explicitly requested).

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { listInstalledServers } from "add-mcp";
import { detectHosts } from "./hosts.mjs";
import { blockForVariant, removeBlock, upsertBlock } from "../adapters/instructions/generate.mjs";
import { CONNECTOR_TARGETS, targetsForHost } from "../core/connector-targets.mjs";

const VALID_COMMANDS = new Set(["status", "install", "remove"]);
const VALID_SCOPES = new Set(["project", "global"]);

function parseArgs(argv) {
  const args = { command: argv[2] ?? "status", scope: "project" };
  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--scope") {
      args.scope = argv[i + 1];
      i += 1;
    } else if (arg === "--all-scopes") {
      args.scope = "all";
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!VALID_COMMANDS.has(args.command)) {
    throw new Error(`usage: link-connectors.mjs <status|install|remove> [--scope project|global|--all-scopes]`);
  }
  if (args.scope !== "all" && !VALID_SCOPES.has(args.scope)) {
    throw new Error(`invalid scope "${args.scope}"`);
  }
  return args;
}

function hasHarnessBlock(path) {
  if (!existsSync(path)) return false;
  const content = readFileSync(path, "utf8");
  return content.includes("<!-- harness-router:start -->") && content.includes("<!-- harness-router:end -->");
}

function normalizeTarget(target) {
  return { ...target, path: resolve(target.path) };
}

function targetsForScope(hostId, scope) {
  if (scope === "all") {
    return CONNECTOR_TARGETS[hostId]?.instructionTargets.map(normalizeTarget) ?? [];
  }
  return targetsForHost(hostId, { scope }).map(normalizeTarget);
}

function rowHasHarnessRouter(row) {
  return row.servers.some(
    (server) => server.name === "harness-router" || server.serverName === "harness-router",
  );
}

async function mcpLinkedByHost(hostIds) {
  const localRows = await listInstalledServers({ global: false, agents: hostIds, cwd: process.cwd() });
  const globalRows = await listInstalledServers({ global: true, agents: hostIds, cwd: process.cwd() });
  const linked = new Map(hostIds.map((hostId) => [hostId, false]));
  for (const row of [...localRows, ...globalRows]) {
    linked.set(row.agentType, linked.get(row.agentType) || rowHasHarnessRouter(row));
  }
  return linked;
}

function applyTarget(command, target) {
  if (command === "status") return { changed: false, linked: hasHarnessBlock(target.path) };
  mkdirSync(dirname(target.path), { recursive: true });
  const changed =
    command === "install" ? upsertBlock(target.path, blockForVariant(target.variant)) : removeBlock(target.path);
  return { changed, linked: hasHarnessBlock(target.path) };
}

async function main() {
  const { command, scope } = parseArgs(process.argv);
  const hosts = await detectHosts();
  const hostIds = hosts.mcpHosts;
  const mcpLinks = await mcpLinkedByHost(hostIds);

  console.log(`connector command: ${command}`);
  console.log(`scope: ${scope}`);
  console.log(`detected MCP hosts: ${hostIds.join(", ") || "(none)"}`);
  console.log("\n== connector links ==");

  for (const hostId of hostIds) {
    const targets = targetsForScope(hostId, scope);
    const mcpStatus = mcpLinks.get(hostId) ? "mcp:linked" : "mcp:missing";
    if (targets.length === 0) {
      console.log(`${hostId}: ${mcpStatus}; instruction:mcp-only`);
      continue;
    }
    for (const target of targets) {
      const result = applyTarget(command, target);
      const action = command === "status" ? (result.linked ? "linked" : "missing") : result.changed ? "changed" : "no-op";
      console.log(`${hostId}: ${mcpStatus}; instruction:${action}; ${target.path}`);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
