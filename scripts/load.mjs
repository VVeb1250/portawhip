#!/usr/bin/env node
// Step 1 proof: one declarative recipe, dispatched to whichever backend
// already solves that capability type well. This file owns NO install
// logic and no host list — it only shells out to add-mcp / mise / asm
// per entry.type, targeting whatever detectHosts() finds on THIS machine.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import spawnSync from "cross-spawn";
import yaml from "js-yaml";
import { detectHosts } from "./hosts.mjs";

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

function loadCli(entry) {
  // mise itself is the cross-OS layer here; no per-agent targeting needed.
  return run("mise", ["use", "-g", entry.source]);
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

async function main() {
  const recipePath = process.argv[2] ?? "recipe.yaml";
  const entries = yaml.load(readFileSync(recipePath, "utf8"));
  const hosts = await detectHosts();

  console.log(`detected MCP hosts:   ${hosts.mcpHosts.join(", ") || "(none)"}`);
  console.log(`detected skill hosts: ${hosts.skillHosts.join(", ") || "(none)"}`);

  const results = [];
  for (const entry of entries) {
    const handler = DISPATCH[entry.type];
    if (!handler) {
      console.error(`unknown type "${entry.type}" for ${entry.id}`);
      results.push({ id: entry.id, ok: false });
      continue;
    }
    const ok = handler(entry, hosts);
    results.push({ id: entry.id, ok });
  }

  console.log("\n== load summary ==");
  for (const r of results) console.log(`${r.ok ? "OK  " : "FAIL"} ${r.id}`);
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}

main();
