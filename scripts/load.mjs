#!/usr/bin/env node
// Declarative recipe loader. MCP declarations are staged in Rulesync's
// canonical source (never written to hosts through add-mcp); mise owns CLI
// tools, and ASM is limited to long-tail skill hosts Rulesync cannot target.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import spawnSync from "cross-spawn";
import { detectHosts } from "./hosts.mjs";
import { mergeRawEntries } from "../core/registry/registry.mjs";
import { readActiveSelection, resolveRecipePaths } from "../core/state/bundle-state.mjs";
import { canonicalRootForScope, normalizeMcpConfig } from "../core/surface/rulesync-canonical.mjs";

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const result = spawnSync.sync(cmd, args, { stdio: "inherit" });
  return result.status === 0;
}

export function stageMcpEntry(entry, { root = resolve("."), scope = entry.scope ?? "global", home = homedir() } = {}) {
  const source = String(entry.source ?? "");
  const input = /^https?:\/\//i.test(source)
    ? { url: source, headers: entry.headers }
    : Array.isArray(entry.args)
      ? {
          command: source,
          args: entry.args.map((arg) => {
            const candidate = resolve(root, arg);
            return existsSync(candidate) ? candidate : arg;
          }),
          env: entry.env,
        }
      : null;
  const normalized = normalizeMcpConfig(input ?? {});
  if (!normalized.config) {
    throw new Error(`${entry.id}: no portable launch config; import its installed config with npm run sync:seed`);
  }

  const canonicalRoot = canonicalRootForScope({ root, scope, home });
  const path = join(canonicalRoot, ".rulesync", "mcp.json");
  const json = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : {
        $schema: "https://github.com/dyoshikawa/rulesync/releases/download/v9.6.3/mcp-schema.json",
        mcpServers: {},
      };
  json.mcpServers ??= {};
  const name = entry.name ?? entry.id;
  const current = json.mcpServers[name];
  if (current && !isDeepStrictEqual(current, normalized.config)) {
    throw new Error(`${name}: declaration conflicts with canonical Rulesync MCP config`);
  }
  if (current) return { status: "no-op", path, name, warnings: normalized.warnings };

  json.mcpServers[name] = normalized.config;
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(json, null, 2)}\n`);
  renameSync(temporary, path);
  return { status: "changed", path, name, warnings: normalized.warnings };
}

function loadMcp(entry, hosts, scope) {
  try {
    const result = stageMcpEntry(entry, { root: resolve("."), scope: entry.scope ?? scope });
    console.log(`${result.status} ${entry.id}: staged in ${result.path}; run portawhip sync apply to fan out`);
    return true;
  } catch (error) {
    console.error(error.message);
    return false;
  }
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

const ASM_LONG_TAIL_PROVIDERS = new Set(["gemini", "windsurf", "antigravity"]);

export function longTailSkillHosts(skillHosts) {
  return skillHosts.filter((provider) => ASM_LONG_TAIL_PROVIDERS.has(provider));
}

function loadSkill(entry, hosts) {
  const providers = longTailSkillHosts(hosts.skillHosts);
  if (providers.length === 0) {
    console.log(`skip ${entry.id}: Rulesync owns detected skill hosts; ASM is reserved for long-tail hosts`);
    return true;
  }
  let ok = true;
  for (const provider of providers) {
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
