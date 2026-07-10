#!/usr/bin/env node
// Managed-copy fan-out for slash commands + subagent defs (Phase S2 write).
//
// mise/asm don't install these surfaces, so this lane copies each canonical
// command/agent markdown file into every markdown-compatible host's native
// dir, exactly the link-hooks pattern: a managed marker makes install
// idempotent and remove precise, and hosts whose format differs (gemini TOML)
// are reported unsupported instead of fed a file that wouldn't load.
//
// Canonical source = command/agent entries in the resolved recipe set
// (recipe.yaml + recipes/imported.yaml + bundles) that carry a `path`. The
// file already living under one host's dir is never copied back onto itself.

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { readActiveSelection, resolveRecipePaths } from "../core/bundle-state.mjs";
import { readRawEntries } from "../core/registry.mjs";
import { SURFACE_COPY_TARGETS } from "../core/surface-copy-targets.mjs";

const VALID_COMMANDS = new Set(["status", "install", "remove"]);
const VALID_SCOPES = new Set(["project", "global"]);
const SURFACE_TYPES = ["command", "agent"];
export const MARKER = "portawhip-managed";

function markerLine(id) {
  return `<!-- ${MARKER}: ${id} -->`;
}

// Pure: canonical command/agent entries (with a source path) from raw recipe
// entries. Deduped first-seen, matching the rest of the registry.
export function canonicalSurfaceEntries(rawEntries) {
  const seen = new Map();
  for (const entry of rawEntries) {
    if (!SURFACE_TYPES.includes(entry.type)) continue;
    if (!entry.path) continue; // nothing to copy without a source file
    if (!seen.has(entry.id)) seen.set(entry.id, entry);
  }
  return [...seen.values()];
}

// Pure: does this target dir already contain the source file (i.e. this is the
// host the file came from)? Then it's the source, never a copy destination.
export function isSourceDir(sourcePath, targetDir) {
  const src = resolve(sourcePath).replace(/\\/g, "/");
  const dir = resolve(targetDir).replace(/\\/g, "/");
  return src.startsWith(`${dir}/`);
}

// Pure: the file content with a managed marker injected right after the
// frontmatter block (or at the very top if there is none). Idempotent — an
// already-marked file is returned unchanged.
export function withMarker(content, id) {
  if (content.includes(markerLine(id)) || content.includes(`<!-- ${MARKER}:`)) return content;
  const fm = content.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)/);
  if (fm) return `${fm[1]}${markerLine(id)}\n${content.slice(fm[1].length)}`;
  return `${markerLine(id)}\n${content}`;
}

export function isManaged(content) {
  return typeof content === "string" && content.includes(`<!-- ${MARKER}:`);
}

function targetFileFor(dir, sourcePath) {
  return join(dir, basename(sourcePath));
}

// One (entry x host x target) plan row. Pure given fs facts injected.
function planRow({ entry, hostId, type, target }) {
  const row = { hostId, type, id: entry.id, scope: target.scope, dir: target.dir ?? null };
  if (target.unsupported) return { ...row, status: "unsupported", format: target.format };
  if (isSourceDir(entry.path, target.dir)) return { ...row, status: "source" };
  const file = targetFileFor(target.dir, entry.path);
  const present = existsSync(file) && isManaged(safeRead(file));
  return { ...row, file, status: present ? "linked" : "missing" };
}

function safeRead(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

export function collectSurfaceLinks({
  command = "status",
  scope = "global",
  root = resolve("."),
  targets = SURFACE_COPY_TARGETS,
  entries = null,
} = {}) {
  const surfaceEntries =
    entries ??
    canonicalSurfaceEntries(
      resolveRecipePaths(root, readActiveSelection(root)).flatMap((p) => (existsSync(p) ? readRawEntries(p) : [])),
    );
  const rows = [];

  for (const entry of surfaceEntries) {
    for (const hostId of Object.keys(targets)) {
      const perType = (targets[hostId]?.[entry.type] ?? []).filter((t) => t.scope === scope);
      for (const target of perType) {
        const row = planRow({ entry, hostId, type: entry.type, target });
        if ((command === "install" || command === "remove") && row.file) {
          applySurface(command, entry, row);
        }
        rows.push(row);
      }
    }
  }
  return { root, command, scope, rows };
}

function applySurface(command, entry, row) {
  if (row.status === "source" || row.status === "unsupported") return;
  if (command === "install") {
    if (row.status === "linked") return; // idempotent
    mkdirSync(dirname(row.file), { recursive: true });
    writeFileSync(row.file, withMarker(safeRead(entry.path), entry.id));
    row.status = "linked";
    row.changed = true;
  } else if (command === "remove") {
    if (existsSync(row.file) && isManaged(safeRead(row.file))) {
      rmSync(row.file, { force: true });
      row.status = "missing";
      row.changed = true;
    }
  }
}

function parseArgs(argv) {
  const args = { command: argv[2] ?? "status", scope: "global", json: false };
  for (let i = 3; i < argv.length; i += 1) {
    if (argv[i] === "--scope") {
      args.scope = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--json") {
      args.json = true;
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  if (!VALID_COMMANDS.has(args.command)) throw new Error("usage: link-surfaces.mjs <status|install|remove> [--scope project|global]");
  if (!VALID_SCOPES.has(args.scope)) throw new Error(`invalid scope "${args.scope}"`);
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const result = collectSurfaceLinks({ command: args.command, scope: args.scope });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`link-surfaces ${result.command} (${result.scope}): ${result.rows.length} target(s)`);
    for (const r of result.rows) {
      console.log(`${r.status.padEnd(11)} ${r.type} ${r.id} -> ${r.hostId} ${r.dir ?? r.format ?? ""}`);
    }
  }
  const ok = result.rows.every((r) => r.status !== "error");
  process.exitCode = ok ? 0 : 1;
}

import { pathToFileURL } from "node:url";

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
