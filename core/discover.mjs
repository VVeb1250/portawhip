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

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DISCOVERY_MAX_BUFFER = 16 * 1024 * 1024;

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

function discoverSkillsFromDirs() {
  const roots = [
    join(homedir(), ".codex", "skills"),
    join(homedir(), ".agents", "skills"),
    join(homedir(), ".claude", "skills"),
  ];
  const found = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const dirent of readdirSync(root, { withFileTypes: true })) {
      if (!dirent.isDirectory() && !dirent.isSymbolicLink()) continue;
      const skillDir = join(root, dirent.name);
      const skillFile = join(skillDir, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      try {
        if (!statSync(skillFile).isFile()) continue;
        const frontmatter = parseSkillFrontmatter(readFileSync(skillFile, "utf8"), dirent.name);
        found.push({
          name: frontmatter.name,
          description: frontmatter.description,
          path: skillDir,
        });
      } catch {
        // A broken symlink or unreadable skill should not break all discovery.
      }
    }
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

export async function discoverMcp() {
  const { listInstalledServers } = await import("add-mcp");
  const hosts = await listInstalledServers({ global: true });
  const seen = new Map();
  for (const host of hosts) {
    for (const server of host.servers ?? []) {
      if (seen.has(server.serverName)) continue;
      seen.set(server.serverName, {
        id: server.serverName,
        type: "mcp",
        source: server.identity,
        path: null,
        origin: "auto:mcp",
        route: {
          triggers: [server.serverName],
          description: `MCP server: ${server.serverName}`,
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
  let skills = [];
  if (!result.ok) {
    skills = discoverSkillsFromDirs();
  } else {
    try {
      skills = JSON.parse(result.stdout);
    } catch {
      skills = discoverSkillsFromDirs();
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

export function discoverCli() {
  const result = spawnSync.sync("mise", ["ls", "--json"], { encoding: "utf8" });
  if (result.status !== 0) return [];
  let tools;
  try {
    tools = JSON.parse(result.stdout);
  } catch {
    return [];
  }
  return Object.keys(tools).map((name) => ({
    id: name,
    type: "cli",
    source: name,
    path: null,
    origin: "auto:cli",
    route: {
      triggers: [name],
      description: `CLI tool: ${name}`,
      when: ["user_prompt"],
      inject: "hint",
    },
  }));
}

export async function discoverAll() {
  const [mcp, skills, cli] = await Promise.all([
    discoverMcp(),
    Promise.resolve(discoverSkills()),
    Promise.resolve(discoverCli()),
  ]);
  return [...mcp, ...skills, ...cli];
}
