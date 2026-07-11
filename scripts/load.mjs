#!/usr/bin/env node
// Step 1 proof: one declarative recipe, dispatched to whichever backend
// already solves that capability type well. This file owns NO install
// logic and no host list — it only shells out to add-mcp / mise / asm
// per entry.type, targeting whatever detectHosts() finds on THIS machine.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import spawnSync from "cross-spawn";
import { detectHosts } from "./hosts.mjs";
import { mergeRawEntries } from "../core/registry/registry.mjs";
import { readActiveSelection, resolveRecipePaths } from "../core/state/bundle-state.mjs";

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const result = spawnSync.sync(cmd, args, { stdio: "inherit" });
  return result.status === 0;
}

function slugify(label) {
  return label.trim().toLowerCase().replace(/\s+/g, "-");
}

function loadMcp(entry, hosts) {
  if (hosts.mcpHosts.length === 0) {
    console.log(`skip ${entry.id}: no MCP-capable agent detected on this machine`);
    return true;
  }
  // add-mcp fails the WHOLE batch if any target lacks transport support for
  // this entry (e.g. Claude Desktop only takes stdio, not remote/http). It
  // names the incompatible host in its own error text, so read that instead
  // of hardcoding a per-host transport capability matrix ourselves.
  let candidates = [...hosts.mcpHosts];
  for (let attempt = 0; attempt < candidates.length; attempt += 1) {
    const args = ["--yes", "add-mcp", entry.source, "-y"];
    if (entry.scope !== "project") args.push("-g");
    if (entry.name) args.push("-n", entry.name);
    // add-mcp can silently upgrade project-scoped entries to global if any
    // target host requires it (observed: VS Code / Copilot CLI force this).
    // A relative path only resolves correctly from this repo's own cwd, so
    // any local file argument must be made absolute regardless of scope.
    for (const a of entry.args ?? []) {
      args.push("--args", existsSync(a) ? resolve(a) : a);
    }
    for (const host of candidates) args.push("-a", host);
    console.log(`\n$ npx ${args.join(" ")}`);
    const result = spawnSync.sync("npx", args, { encoding: "utf8" });
    const text = (result.stdout || "") + (result.stderr || "");
    console.log(text);
    if (result.status === 0) return true;

    const match = text.match(/don't support .*transport:\s*([^\n]+)/i);
    if (!match) return false; // some other failure — don't loop blindly
    const excluded = new Set(match[1].split(",").map((s) => slugify(s)));
    const next = candidates.filter((id) => !excluded.has(id));
    if (next.length === candidates.length || next.length === 0) return false;
    console.log(`retrying without incompatible host(s): ${[...excluded].join(", ")}`);
    candidates = next;
  }
  return false;
}

function loadCli(entry, hosts, scope) {
  // mise itself is the cross-OS layer here; no per-agent targeting needed.
  // scope:"project" pins the tool in THIS project's own .mise.toml (created/
  // updated in the cwd mise is run from) instead of the user's global mise
  // config — for a bundle role that's only relevant to one project, not
  // every project on the machine.
  const args = scope === "project" ? ["use", entry.source] : ["use", "-g", entry.source];
  return run("mise", args);
}

function loadSkill(entry, hosts) {
  if (hosts.skillHosts.length === 0) {
    console.log(`skip ${entry.id}: no skill-capable agent detected on this machine`);
    return true;
  }
  let ok = true;
  for (const provider of hosts.skillHosts) {
    const args = ["--yes", "agent-skill-manager", "install", entry.source];
    if (entry.path) args.push("--path", entry.path);
    args.push("-p", provider, "--yes");
    ok = run("npx", args) && ok;
  }
  return ok;
}

const DISPATCH = { mcp: loadMcp, cli: loadCli, skill: loadSkill };

// Extracted so scripts/bundles.mjs's `select` can install right after
// recording a bundle choice, without duplicating this dispatch logic.
// scope only affects type:cli entries (mise -g vs project .mise.toml);
// mcp/skill handlers ignore the extra argument.
export function installEntries(entries, hosts, scope = "global") {
  const results = [];
  for (const entry of entries) {
    if (entry.install === false) {
      console.log(`skip ${entry.id}: route-only entry`);
      results.push({ id: entry.id, ok: true, skipped: true });
      continue;
    }
    const handler = DISPATCH[entry.type];
    if (!handler) {
      console.error(`unknown type "${entry.type}" for ${entry.id}`);
      results.push({ id: entry.id, ok: false });
      continue;
    }
    const ok = handler(entry, hosts, scope);
    results.push({ id: entry.id, ok });
  }
  return results;
}

async function main() {
  // An explicit path argument bypasses the opt-in bundle layer entirely
  // (existing single-recipe usage, unchanged). Otherwise install whatever
  // bundles were selected via scripts/bundles.mjs select, composed in front
  // of this project's own recipe.yaml — defaults to just recipe.yaml when
  // nothing has been selected (today's exact behavior).
  const explicitRecipe = process.argv[2];
  const recipePaths = explicitRecipe
    ? [explicitRecipe]
    : resolveRecipePaths(resolve("."), readActiveSelection(resolve(".")));
  const entries = mergeRawEntries(recipePaths);
  const hosts = await detectHosts();

  console.log(`detected MCP hosts:   ${hosts.mcpHosts.join(", ") || "(none)"}`);
  console.log(`detected skill hosts: ${hosts.skillHosts.join(", ") || "(none)"}`);

  const results = installEntries(entries, hosts);

  console.log("\n== load summary ==");
  for (const r of results) console.log(`${r.ok ? "OK  " : "FAIL"} ${r.id}`);
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}

import { pathToFileURL } from "node:url";

// Guard main() behind an entry-point check (matches link-hooks/link-connectors/
// generate) so importing this module never triggers a real install as a side
// effect of module load.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
