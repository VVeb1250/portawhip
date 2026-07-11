// Auto-discovers already-installed capabilities from live tool state, so
// the registry links whatever is loaded — regardless of which host or tool
// originally installed it — instead of only the entries someone remembered
// to hand-type into recipe.yaml. This extends VISION.md's "cross-host/
// cross-OS by detection, not by list" principle from host detection to
// registry *content*.
//
// Delegates the actual detection to the same backends Step 1 already uses
// (add-mcp, asm, mise) — this module owns zero install/config parsing logic.

import spawnSync from "cross-spawn";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { readEnrichmentCache } from "./enrich.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const DISCOVERY_MAX_BUFFER = 16 * 1024 * 1024;
const SKILL_SCAN_MAX_DEPTH = 9;
const SKIP_DIRS = new Set([".git", "node_modules"]);
const SURFACE_SKIP_DIRS = new Set(["docs"]);

// Small, deliberately conservative stoplist: generic words that appear in
// almost every skill description and would otherwise become high-frequency
// noise triggers (the exact failure mode that made v1's hook misfire).
const STOPWORDS = new Set([
  "this", "that", "with", "from", "your", "have", "been", "using", "used",
  "use", "when", "will", "into", "provides", "provide", "includes",
  "include", "features", "feature", "across", "about", "these", "those",
  "which", "where", "while", "then", "than", "also", "such", "only",
  "some", "more", "most", "each", "every", "other", "make", "makes",
  "making", "need", "needs", "needed", "help", "helps", "helping",
  "user", "users", "their", "them", "they", "file", "files", "data",
  "code", "tool", "tools", "agent", "agents", "claude", "system",
  "essential", "developers", "developer", "building", "builds", "full",
  "stack", "produces", "produce", "designed", "design", "applications",
  "application",
]);

function extractKeywords(name, description, max = 6) {
  const text = `${name} ${description || ""}`.toLowerCase();
  const words = text.match(/[a-z][a-z-]{3,}/g) || [];
  const nameLower = name.toLowerCase();
  const freq = new Map();
  for (const w of words) {
    if (STOPWORDS.has(w) || w === nameLower) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
  return [name, ...ranked.slice(0, max)];
}

function truncate(text, max = 160) {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function parseSkillFrontmatter(text, fallbackName) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { name: fallbackName, description: "" };
  const frontmatter = match[1];
  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? fallbackName;
  const description =
    frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
  return { name, description };
}

function parseMarkdownFrontmatter(text, fallbackName) {
  const match = String(text ?? "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const data = {};
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!field) continue;
      data[field[1]] = field[2].replace(/^["']|["']$/g, "").trim();
    }
  }
  const heading = String(text ?? "").match(/^#\s+(.+)$/m)?.[1]?.trim();
  return {
    name: data.name || fallbackName,
    description: data.description || heading || "",
  };
}

function markdownFilesUnder(root, segmentName, maxDepth = SKILL_SCAN_MAX_DEPTH) {
  const found = [];
  if (!existsSync(root)) return found;
  // When the root itself IS the segment dir (a host-native leaf like
  // ~/.claude/commands), start already in-segment so its .md files are
  // collected directly — without this, only the segment-walk case (a
  // "commands"/"agents" dir nested in a plugin tree) is found, and the
  // host-native user dirs are silently missed.
  const startInSegment = root.split(/[\\/]/).pop() === segmentName;
  const stack = [{ dir: root, depth: 0, inSegment: startInSegment }];
  while (stack.length > 0) {
    const { dir, depth, inSegment } = stack.pop();
    let dirents;
    try {
      dirents = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirent of dirents) {
      const path = join(dir, dirent.name);
      if (dirent.isFile() && inSegment && dirent.name.endsWith(".md")) {
        found.push(path);
        continue;
      }
      if (!dirent.isDirectory() && !dirent.isSymbolicLink()) continue;
      if (SKIP_DIRS.has(dirent.name)) continue;
      if (!inSegment && SURFACE_SKIP_DIRS.has(dirent.name)) continue;
      if (depth >= maxDepth) continue;
      stack.push({ dir: path, depth: depth + 1, inSegment: inSegment || dirent.name === segmentName });
    }
  }
  return found;
}

function fileStem(path) {
  return path.split(/[\\/]/).pop().replace(/\.md$/i, "");
}

function discoverMarkdownSurface(type, segmentName, roots = defaultPluginRoots()) {
  const seen = new Map();
  for (const root of roots) {
    for (const path of markdownFilesUnder(root, segmentName)) {
      try {
        const fallback = fileStem(path);
        const metadata = parseMarkdownFrontmatter(readFileSync(path, "utf8"), fallback);
        const id = metadata.name || fallback;
        if (seen.has(id)) continue;
        const description = truncate(metadata.description || `${type}: ${id}`);
        const slash = type === "command" ? `/${fallback}` : fallback;
        seen.set(id, {
          id,
          type,
          source: path,
          path,
          origin: `auto:${type}`,
          route: {
            triggers: [id, slash, ...extractKeywords(id, description)],
            description,
            when: ["user_prompt"],
            inject: "hint",
          },
        });
      } catch {
        // A malformed markdown file should not block the whole surface scan.
      }
    }
  }
  return [...seen.values()];
}

export function defaultSkillRoots() {
  return [
    join(homedir(), ".codex", "skills"),
    join(homedir(), ".agents", "skills"),
    join(homedir(), ".claude", "skills"),
    join(homedir(), ".claude", "plugins", "cache"),
    join(homedir(), ".claude", "plugins", "marketplaces"),
  ];
}

export function defaultPluginRoots() {
  return [
    join(homedir(), ".claude", "plugins", "cache"),
    join(homedir(), ".claude", "plugins", "marketplaces"),
  ];
}

// Host-native command/agent dirs (leaf dirs whose basename IS the segment, so
// markdownFilesUnder collects them directly), on top of the plugin roots.
// Data catalog, not decision logic — each path is a documented host
// convention (Claude Code: ~/.claude/{commands,agents} + project .claude/…).
// Codex prompts (~/.codex/prompts) use a different segment name and are added
// once a codex install is present to verify against. cwd-relative project
// dirs are resolved by the caller's process cwd, matching the router's
// per-project behavior.
export function defaultCommandRoots() {
  return [
    ...defaultPluginRoots(),
    join(homedir(), ".claude", "commands"),
    resolve(".claude", "commands"),
  ];
}

export function defaultAgentRoots() {
  return [
    ...defaultPluginRoots(),
    join(homedir(), ".claude", "agents"),
    resolve(".claude", "agents"),
  ];
}

function scanSkillDirs(root, maxDepth = SKILL_SCAN_MAX_DEPTH) {
  const found = [];
  if (!existsSync(root)) return found;
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length > 0) {
    const { dir, depth } = stack.pop();
    const skillFile = join(dir, "SKILL.md");
    if (existsSync(skillFile)) {
      try {
        if (!statSync(skillFile).isFile()) continue;
        const frontmatter = parseSkillFrontmatter(readFileSync(skillFile, "utf8"), dir.split(/[\\/]/).pop());
        found.push({
          name: frontmatter.name,
          description: frontmatter.description,
          path: dir,
        });
      } catch {
        // A broken symlink or unreadable skill should not break all discovery.
      }
      continue;
    }
    if (depth >= maxDepth) continue;
    let dirents;
    try {
      dirents = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirent of dirents) {
      if (!dirent.isDirectory() && !dirent.isSymbolicLink()) continue;
      if (SKIP_DIRS.has(dirent.name)) continue;
      stack.push({ dir: join(dir, dirent.name), depth: depth + 1 });
    }
  }
  return found;
}

export function discoverSkillsFromDirs(roots = defaultSkillRoots()) {
  const found = [];
  for (const root of roots) {
    found.push(...scanSkillDirs(root));
  }
  return found;
}

function runJsonCommand(candidates) {
  let lastError = null;
  for (const [command, args] of candidates) {
    const result = spawnSync.sync(command, args, {
      encoding: "utf8",
      maxBuffer: DISCOVERY_MAX_BUFFER,
    });
    if (result.status === 0) return { ok: true, stdout: result.stdout };
    lastError = result.error ?? new Error(result.stderr || `status ${result.status}`);
  }
  return { ok: false, error: lastError };
}

export async function discoverMcp(enrichCachePath) {
  const { listInstalledServers } = await import("add-mcp");
  const cache = enrichCachePath ? readEnrichmentCache(enrichCachePath) : {};
  const hosts = await listInstalledServers({ global: true });
  const seen = new Map();
  for (const host of hosts) {
    for (const server of host.servers ?? []) {
      if (seen.has(server.serverName)) continue;
      // `router-cli enrich` (core/enrich.mjs) precomputes real triggers by
      // connecting to the server and asking its own tools/list — a bare
      // server name alone only ever matches a prompt that names the server
      // literally. Falls back to the bare name when nothing's cached yet
      // (unenriched behavior, unchanged).
      const enriched = cache[server.serverName];
      seen.set(server.serverName, {
        id: server.serverName,
        type: "mcp",
        source: server.identity,
        path: null,
        origin: "auto:mcp",
        route: {
          triggers: enriched?.triggers ?? [server.serverName],
          description: enriched?.description ?? `MCP server: ${server.serverName}`,
          when: ["user_prompt"],
          inject: "hint",
        },
      });
    }
  }
  return [...seen.values()];
}

export function discoverSkills() {
  const localAsm = resolve(ROOT, "node_modules", "agent-skill-manager", "dist", "agent-skill-manager.js");
  const candidates = existsSync(localAsm)
    ? [[process.execPath, [localAsm, "list", "--json"]]]
    : [];
  candidates.push(["npx", ["--yes", "agent-skill-manager", "list", "--json"]]);

  const result = runJsonCommand(candidates);
  let skills = discoverSkillsFromDirs();
  if (!result.ok) {
    // Filesystem discovery above is the fallback source of truth.
  } else {
    try {
      skills = [...JSON.parse(result.stdout), ...skills];
    } catch {
      // Keep filesystem discovery if ASM returns malformed JSON.
    }
  }
  // The same skill is commonly installed under the same name in several
  // hosts (e.g. Claude Code, Codex, Cursor all carry "pdf") — one real
  // capability, so one entry; first-seen wins, same as discoverMcp.
  const seen = new Map();
  for (const s of skills) {
    if (seen.has(s.name)) continue;
    seen.set(s.name, {
      id: s.name,
      type: "skill",
      source: s.path,
      path: s.path ?? null,
      origin: "auto:skill",
      route: {
        triggers: extractKeywords(s.name, s.description),
        description: truncate(s.description),
        when: ["user_prompt"],
        inject: "hint",
      },
    });
  }
  return [...seen.values()];
}

export function discoverCli(enrichCachePath) {
  const result = spawnSync.sync("mise", ["ls", "--json"], { encoding: "utf8" });
  if (result.status !== 0) return [];
  let tools;
  try {
    tools = JSON.parse(result.stdout);
  } catch {
    return [];
  }
  const cache = enrichCachePath ? readEnrichmentCache(enrichCachePath) : {};
  return Object.keys(tools).map((name) => {
    const enriched = cache[name];
    return {
      id: name,
      type: "cli",
      source: name,
      path: null,
      origin: "auto:cli",
      route: {
        triggers: enriched?.triggers ?? [name],
        description: enriched?.description ?? `CLI tool: ${name}`,
        when: ["user_prompt"],
        inject: "hint",
      },
    };
  });
}

export function discoverCommands(roots = defaultCommandRoots()) {
  return discoverMarkdownSurface("command", "commands", roots);
}

export function discoverAgents(roots = defaultAgentRoots()) {
  return discoverMarkdownSurface("agent", "agents", roots);
}

export async function discoverAll({ enrichCachePath } = {}) {
  const [mcp, skills, cli, commands, agents] = await Promise.all([
    discoverMcp(enrichCachePath),
    Promise.resolve(discoverSkills()),
    Promise.resolve(discoverCli(enrichCachePath)),
    Promise.resolve(discoverCommands()),
    Promise.resolve(discoverAgents()),
  ]);
  const byId = new Map();
  for (const entry of [...mcp, ...skills, ...cli, ...commands, ...agents]) {
    if (byId.has(entry.id)) continue;
    byId.set(entry.id, entry);
  }
  return [...byId.values()];
}
