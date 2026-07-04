#!/usr/bin/env node
// Bundle selector - opt-in only, never forced (agreed 2026-07-05). foundry =
// whipforaweeb's recommended core (user may opt out); roles = whipforaweeb's
// role-based add-ons (tick zero, one, or many). Selecting a bundle just
// changes which recipe files feed BOTH install (scripts/load.mjs) and
// routing (router-cli/mcp-server/universal-hook) - the same list, so nothing
// can end up "installed but never routed" (see recipes/foundry.yaml's header
// for the predecessor-project gripe this avoids).

import { resolve } from "node:path";
import {
  listCatalog,
  readActiveSelection,
  resolveBundlePaths,
  resolveRecipePaths,
  writeActiveSelection,
} from "../core/bundle-state.mjs";
import { mergeRawEntries } from "../core/registry.mjs";
import { detectHosts } from "./hosts.mjs";
import { installEntries } from "./load.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true;
      args[key] = value;
      if (value !== true) i += 1;
    }
  }
  return args;
}

function cmdList(root) {
  const { foundry, roles } = listCatalog(root);
  console.log("== foundry (recommended core; opt-out anytime with `select --none`) ==");
  console.log(
    foundry
      ? `${foundry.id}: ${foundry.description ?? "(no description)"} - entries: ${foundry.entryIds.join(", ")}`
      : "(none defined yet - recipes/foundry.yaml missing)",
  );
  console.log("\n== roles (opt-in, pick any number) ==");
  if (roles.length === 0) console.log("(none defined yet - recipes/roles/*.yaml missing)");
  for (const role of roles) {
    console.log(`${role.id}: ${role.description ?? "(no description)"} - entries: ${role.entryIds.join(", ")}`);
  }
}

function cmdStatus(root) {
  const selection = readActiveSelection(root);
  const paths = resolveRecipePaths(root, selection);
  console.log(`foundry: ${selection.foundry ? "on" : "off"}`);
  console.log(`roles: ${selection.roles.length ? selection.roles.join(", ") : "(none)"}`);
  console.log("\nresolved recipe files (precedence: foundry -> roles -> this project's recipe.yaml):");
  for (const p of paths) console.log(` - ${p}`);
  if (paths.length === 0) console.log(" (none - nothing to route or install)");
}

// select does not just record intent — it installs the newly selected
// bundle(s) right away (agreed 2026-07-05: "select bundle นี่คือต้องโหลด
// tools ให้เลย"). Scoped to resolveBundlePaths (foundry + selected roles
// only), not the project's own recipe.yaml, so re-selecting doesn't
// reinstall everything that was already there before bundles existed.
// Installs are idempotent (mise/add-mcp/asm already re-verified this in
// Step 1), so re-running select with the same selection is a safe no-op.
async function cmdSelect(root, args) {
  if (args.none) {
    writeActiveSelection(root, { foundry: false, roles: [] });
    console.log("selection cleared - back to just this project's recipe.yaml.");
    return;
  }
  const selection = {
    foundry: Boolean(args.foundry),
    roles:
      typeof args.role === "string"
        ? args.role
            .split(",")
            .map((r) => r.trim())
            .filter(Boolean)
        : [],
  };
  writeActiveSelection(root, selection);
  console.log(`selection saved: foundry=${selection.foundry}, roles=${selection.roles.join(",") || "(none)"}`);

  const bundlePaths = resolveBundlePaths(root, selection);
  if (bundlePaths.length === 0) {
    console.log("\nnothing to install (no matching recipes/foundry.yaml or recipes/roles/*.yaml found).");
    cmdStatus(root);
    return;
  }

  const scope = args.scope === "project" ? "project" : "global";
  console.log(`\n== installing selected bundle(s) (cli scope: ${scope}) ==`);
  const entries = mergeRawEntries(bundlePaths);
  const hosts = await detectHosts();
  console.log(`detected MCP hosts:   ${hosts.mcpHosts.join(", ") || "(none)"}`);
  console.log(`detected skill hosts: ${hosts.skillHosts.join(", ") || "(none)"}`);
  const results = installEntries(entries, hosts, scope);

  console.log("\n== install summary ==");
  for (const r of results) console.log(`${r.ok ? "OK  " : "FAIL"} ${r.id}`);

  console.log("");
  cmdStatus(root);
}

async function main() {
  const [, , command, ...rest] = process.argv;
  const args = parseArgs(rest);
  const root = resolve(".");

  if (command === "list") return cmdList(root);
  if (command === "status") return cmdStatus(root);
  if (command === "select") return cmdSelect(root, args);

  console.error(
    "usage: bundles.mjs <list|status|select [--foundry] [--role a,b] [--scope project|global] | select --none>",
  );
  process.exitCode = 1;
}

import { pathToFileURL } from "node:url";

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
