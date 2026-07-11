// Embedded-hook inventory (Phase S3, mode B — scan + inventory only, NO
// linking). Hooks bundled inside skills/plugins run third-party commands on
// lifecycle events; today they are invisible to portawhip's own hook sync.
// This module finds them and reports what/where they are so a later,
// per-item-approved link step (S3 full) has something concrete to act on.
//
// Owns no linking and executes nothing — it only reads hooks.json files and
// extracts each declared command. Command bodies are surfaced verbatim
// (truncated for display, full source path kept) precisely because a human
// must see the exact command before ever choosing to activate it.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const HOOK_SCAN_MAX_DEPTH = 9;
const SKIP_DIRS = new Set([".git", "node_modules"]);
const COMMAND_PREVIEW_CHARS = 160;

export function defaultHookScanRoots() {
  return [
    join(homedir(), ".claude", "plugins", "cache"),
    join(homedir(), ".claude", "plugins", "marketplaces"),
    join(homedir(), ".claude", "skills"),
    join(homedir(), ".codex", "skills"),
  ];
}

// Pure: which host a hooks.json belongs to + whether it looks like a live
// hook or a shipped template, inferred from its path segments (data, not a
// decision that changes behavior — inventory metadata only).
export function classifyHookPath(sourcePath) {
  const segs = String(sourcePath).split(/[\\/]/);
  const host = segs.includes(".codex")
    ? "codex"
    : segs.includes(".cursor")
      ? "cursor"
      : segs.includes(".gemini")
        ? "gemini-cli"
        : "claude-code";
  const template = segs.includes("scaffolds") || segs.includes("templates") || segs.includes("schemas");
  const pkg = inferPackage(segs);
  return { host, template, pkg };
}

function inferPackage(segs) {
  const i = segs.lastIndexOf("plugins");
  if (i !== -1 && segs[i + 1]) {
    // .../plugins/cache/<pkg>/... or .../plugins/marketplaces/<mp>/plugins/<pkg>/...
    const after = segs.slice(i + 1).filter((s) => s !== "cache" && s !== "marketplaces");
    return after[0] ?? "unknown";
  }
  const s = segs.lastIndexOf("skills");
  if (s !== -1 && segs[s + 1]) return segs[s + 1];
  return "unknown";
}

function truncate(text, max = COMMAND_PREVIEW_CHARS) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// Pure: extract every command hook from a parsed hooks.json object.
export function parseEmbeddedHooks(json, sourcePath) {
  if (!json || typeof json.hooks !== "object" || json.hooks === null) return [];
  const { host, template, pkg } = classifyHookPath(sourcePath);
  const out = [];
  for (const [event, groups] of Object.entries(json.hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const matcher = group?.matcher ?? null;
      for (const hook of group?.hooks ?? []) {
        if (hook?.type !== "command" || typeof hook.command !== "string") continue;
        out.push({
          id: group?.id ?? `${pkg}:${event}${matcher ? `:${matcher}` : ""}`,
          package: pkg,
          host,
          event,
          matcher,
          template,
          commandPreview: truncate(hook.command),
          commandLength: hook.command.length,
          timeout: hook.timeout ?? null,
          source: sourcePath,
        });
      }
    }
  }
  return out;
}

function hookJsonFilesUnder(root, maxDepth = HOOK_SCAN_MAX_DEPTH) {
  const found = [];
  if (!existsSync(root)) return found;
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length > 0) {
    const { dir, depth } = stack.pop();
    let dirents;
    try {
      dirents = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirent of dirents) {
      const path = join(dir, dirent.name);
      if (dirent.isFile() && dirent.name === "hooks.json") {
        found.push(path);
        continue;
      }
      if (!dirent.isDirectory() && !dirent.isSymbolicLink()) continue;
      if (SKIP_DIRS.has(dirent.name)) continue;
      if (depth >= maxDepth) continue;
      stack.push({ dir: path, depth: depth + 1 });
    }
  }
  return found;
}

// Inventory across all roots. Deduped by (source-relative) identity so the
// same package mirrored in cache + marketplaces isn't double-counted.
export function discoverEmbeddedHooks(roots = defaultHookScanRoots()) {
  const seen = new Map();
  for (const root of roots) {
    for (const file of hookJsonFilesUnder(root)) {
      let json;
      try {
        json = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        continue; // a malformed hooks.json must not break the whole scan
      }
      for (const entry of parseEmbeddedHooks(json, file)) {
        const key = `${entry.package}:${entry.host}:${entry.event}:${entry.matcher ?? ""}:${entry.commandPreview}`;
        if (!seen.has(key)) seen.set(key, entry);
      }
    }
  }
  return [...seen.values()];
}

// Compact summary for doctor / surface matrix.
export function summarizeEmbeddedHooks(entries = discoverEmbeddedHooks()) {
  const byPackage = {};
  const byHost = {};
  let templates = 0;
  for (const e of entries) {
    byPackage[e.package] = (byPackage[e.package] ?? 0) + 1;
    byHost[e.host] = (byHost[e.host] ?? 0) + 1;
    if (e.template) templates += 1;
  }
  return { total: entries.length, active: entries.length - templates, templates, byHost, byPackage };
}
