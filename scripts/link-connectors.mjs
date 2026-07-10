#!/usr/bin/env node
// Cross-host connector linker for harness-router.
//
// This does not install MCP servers itself; add-mcp remains the delegated
// installer. The script verifies the MCP link and upserts the small instruction
// connector block into every known host instruction surface for a selected
// scope (project by default, global when explicitly requested).

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { listInstalledServers } from "add-mcp";
import { detectHosts } from "./hosts.mjs";
import { blockForVariant, removeBlock, upsertBlock } from "../adapters/instructions/generate.mjs";
import { CONNECTOR_TARGETS, targetsForHost } from "../core/connector-targets.mjs";

const VALID_COMMANDS = new Set(["status", "install", "remove"]);
const VALID_SCOPES = new Set(["project", "global"]);

function parseArgs(argv) {
  const args = { command: argv[2] ?? "status", scope: "project", json: false };
  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--scope") {
      args.scope = argv[i + 1];
      i += 1;
    } else if (arg === "--all-scopes") {
      args.scope = "all";
    } else if (arg === "--json") {
      args.json = true;
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

// A dedicated, harness-owned rule file (cursor .mdc, windsurf .md) carries
// frontmatter BEFORE the marker block, so marker-upsert is wrong for it:
// upsertBlock preserves the pre-marker preamble AND re-adds the block's own
// preamble, duplicating the frontmatter on every re-run. Own the whole file
// instead — install writes it verbatim (idempotent), remove deletes it (no
// orphan always-on rule left behind on uninstall).
function applyOwnedTarget(command, target) {
  if (command === "remove") {
    if (!existsSync(target.path)) return { changed: false, linked: false };
    rmSync(target.path);
    return { changed: true, linked: false };
  }
  mkdirSync(dirname(target.path), { recursive: true });
  const next = `${blockForVariant(target.variant)}\n`;
  const current = existsSync(target.path) ? readFileSync(target.path, "utf8") : null;
  const changed = current !== next;
  if (changed) writeFileSync(target.path, next);
  return { changed, linked: true };
}

export function applyTarget(command, target) {
  if (command === "status") return { changed: false, linked: hasHarnessBlock(target.path) };
  if (target.owned) return applyOwnedTarget(command, target);
  mkdirSync(dirname(target.path), { recursive: true });
  const changed =
    command === "install" ? upsertBlock(target.path, blockForVariant(target.variant)) : removeBlock(target.path);
  return { changed, linked: hasHarnessBlock(target.path) };
}

export async function collectConnectorLinks({ command = "status", scope = "project" } = {}) {
  const hosts = await detectHosts();
  const hostIds = hosts.mcpHosts;
  const mcpLinks = await mcpLinkedByHost(hostIds);
  const rows = [];

  for (const hostId of hostIds) {
    const targets = targetsForScope(hostId, scope);
    const mcpLinked = Boolean(mcpLinks.get(hostId));
    const mcpStatus = mcpLinked ? "linked" : "missing";
    if (targets.length === 0) {
      rows.push({
        type: "connector",
        hostId,
        scope,
        mcpStatus,
        instructionStatus: "mcp-only",
        path: null,
        supported: true,
      });
      continue;
    }
    for (const target of targets) {
      const result = applyTarget(command, target);
      const instructionStatus =
        command === "status" ? (result.linked ? "linked" : "missing") : result.changed ? "changed" : "no-op";
      rows.push({
        type: "connector",
        hostId,
        scope,
        mcpStatus,
        instructionStatus,
        path: target.path,
        supported: true,
      });
    }
  }

  // Extra hosts add-mcp doesn't catalogue (Pi, Amp, …), present on this
  // machine: instruction linking only. mcpStatus is "n/a" — we never hand
  // these to add-mcp's MCP linker, which doesn't know them.
  for (const hostId of hosts.extraHosts ?? []) {
    const targets = targetsForScope(hostId, scope);
    for (const target of targets) {
      const result = applyTarget(command, target);
      const instructionStatus =
        command === "status" ? (result.linked ? "linked" : "missing") : result.changed ? "changed" : "no-op";
      rows.push({ type: "connector", hostId, scope, mcpStatus: "n/a", instructionStatus, path: target.path, supported: true });
    }
  }

  return { command, scope, hostIds, extraHostIds: hosts.extraHosts ?? [], rows };
}

async function main() {
  const { command, scope, json } = parseArgs(process.argv);
  const result = await collectConnectorLinks({ command, scope });
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`connector command: ${command}`);
  console.log(`scope: ${scope}`);
  console.log(`detected MCP hosts: ${result.hostIds.join(", ") || "(none)"}`);
  console.log("\n== connector links ==");

  for (const row of result.rows) {
    const mcpStatus = `mcp:${row.mcpStatus}`;
    if (row.instructionStatus === "mcp-only") {
      console.log(`${row.hostId}: ${mcpStatus}; instruction:mcp-only`);
      continue;
    }
    console.log(`${row.hostId}: ${mcpStatus}; instruction:${row.instructionStatus}; ${row.path}`);
  }
}

import { pathToFileURL } from "node:url";

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
