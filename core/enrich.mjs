// Enriches bare-name auto-discovered MCP/CLI tools with real
// triggers/descriptions. Runs at init/update time ONLY, via
// `router-cli enrich` — never inside loadIndex()/discoverAll(), which
// rebuild and re-discover on every single route() call. Connecting to
// every installed MCP server (and shelling out to package registries for
// CLI tools) on every prompt would make the router itself the bottleneck
// it exists to avoid.
//
// Found live 2026-07-06: add-mcp/mise only ever return a bare server/tool
// NAME with no description, so discover.mjs's auto:mcp/auto:cli entries end
// up with `triggers:[name]` — they only ever fire when a prompt names the
// tool literally ("use playwright to..."), and stay dead on the natural
// phrasing a real task actually uses ("open a browser and click login").
//
// Grounded-first ladder, LLM fallback deliberately NOT built yet (see
// memory: dead-auto-tools-enrichment.md) — spiked and confirmed this covers
// the large majority without one:
//   MCP: add-mcp's own launch config -> @modelcontextprotocol/sdk listTools()
//   CLI: `--help` first meaningful line -> `pip show` summary for pipx-
//        installed tools only (a bare npm-view-by-name fallback was tried
//        and dropped: no reliable name-to-package mapping without a
//        registry/ecosystem hint mise doesn't expose, and it produced a
//        real wrong-description collision - see enrichCli below) ->
//        (LLM(name), future work, not built)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import spawnSync from "cross-spawn";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const DEFAULT_CACHE_PATH = join(".hp-state", "tool-descriptions.json");
const MAX_DESCRIPTION_CHARS = 300;
const MAX_MCP_SUBTOOL_TRIGGERS = 20;

export function readEnrichmentCache(cachePath = DEFAULT_CACHE_PATH) {
  if (!existsSync(cachePath)) return {};
  try {
    return JSON.parse(readFileSync(cachePath, "utf8"));
  } catch {
    return {};
  }
}

function writeEnrichmentCache(entries, cachePath = DEFAULT_CACHE_PATH) {
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(entries, null, 2));
}

// --- MCP: connect via the launch config add-mcp already gave us, ask the
// server itself what its tools do. Fails closed (returns null, leaving the
// bare-name entry as-is) on anything unreachable/slow/misconfigured — this
// is best-effort enrichment, never a requirement for the tool to route at
// all (VISION.md: live-probe, never overclaim).

async function enrichMcpServer(server, { timeoutMs = 8000 } = {}) {
  const { serverName, config } = server;
  if (!config) return null;
  let client;
  try {
    const transport = config.url
      ? new StreamableHTTPClientTransport(new URL(config.url))
      : new StdioClientTransport({ command: config.command, args: config.args ?? [] });
    client = new Client({ name: "portawhip-enrich", version: "0.1.0" }, { capabilities: {} });
    await Promise.race([
      client.connect(transport),
      new Promise((_, reject) => setTimeout(() => reject(new Error("enrich timeout")), timeoutMs)),
    ]);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).filter(Boolean);
    const descriptions = tools.map((t) => t.description).filter(Boolean);
    const description = descriptions.length
      ? `MCP server: ${serverName} — ${descriptions.slice(0, 3).join("; ")}`.slice(0, MAX_DESCRIPTION_CHARS)
      : `MCP server: ${serverName}${names.length ? ` (tools: ${names.slice(0, 8).join(", ")})` : ""}`;
    return {
      triggers: [serverName, ...names].slice(0, MAX_MCP_SUBTOOL_TRIGGERS),
      description,
    };
  } catch {
    return null;
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {
        // best-effort teardown only
      }
    }
  }
}

export async function enrichMcp({ timeoutMs = 8000 } = {}) {
  const { listInstalledServers } = await import("add-mcp");
  const hosts = await listInstalledServers({ global: true });
  const seen = new Map();
  for (const host of hosts) {
    for (const server of host.servers ?? []) {
      if (!seen.has(server.serverName)) seen.set(server.serverName, server);
    }
  }
  const results = {};
  for (const server of seen.values()) {
    const enriched = await enrichMcpServer(server, { timeoutMs });
    if (enriched) {
      results[server.serverName] = { type: "mcp", ...enriched, enrichedAt: new Date().toISOString() };
    }
  }
  return results;
}

// --- CLI: `--help` gives a real one-line description for some tools
// (jq/gitleaks/biome/hyperfine) but for many others the first line is just
// usage syntax or a version/author banner (pandoc/node/ripgrep) — those
// patterns are filtered out rather than accepted as a "description".

const NOT_A_DESCRIPTION = [
  /^usage[:\s]/i,
  /^\[options?\]/i,
  /^[\w.-]+\.exe\b/i,
  /^[\w.-]+ v?\d+(\.\d+)+/i, // "ripgrep 15.1.0", "tool v2.3"
  /^-[\w-]+[,\s]/, // a bare flag list line
];

// Exported for unit testing without shelling out — no other module needs it.
export function firstMeaningfulLine(text) {
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (NOT_A_DESCRIPTION.some((pattern) => pattern.test(line))) return null;
    return line;
  }
  return null;
}

function runCapture(command, args, { timeout = 6000 } = {}) {
  const result = spawnSync.sync(command, args, { encoding: "utf8", timeout });
  if (result.error || (result.status !== 0 && result.status !== null)) return null;
  return (result.stdout || result.stderr || "").toString();
}

// Exported for unit testing — no other module needs it.
export function cliBinary(id) {
  // "pipx:markitdown" -> "markitdown"; plain names pass through unchanged.
  return id.includes(":") ? id.split(":").pop() : id;
}

// Same rule core/capability-docs.mjs's pointerFor() already established for
// resolving a mise-installed CLI at all: a bare binary name only resolves
// if the invoking shell happens to have `mise activate` wired in. Found
// live here too — bare `biome --help` failed with ENOENT even though
// `mise exec -- biome --help` works fine. `mise exec --` always works, on
// every OS, with zero setup.
function tryHelp(bin) {
  const out = runCapture("mise", ["exec", "--", bin, "--help"]);
  return out ? firstMeaningfulLine(out) : null;
}

function tryPipShow(bin) {
  const out = runCapture("pip", ["show", bin]);
  const match = out?.match(/^Summary:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

// No blind npm-view fallback: found live that "rust" (a mise-installed
// language toolchain) collides with an unrelated npm package literally
// named "rust" ("Install the rust toolchain using npm"), producing a
// plausible-looking but WRONG description. `mise ls --json` exposes no
// ecosystem/backend field to confirm a bare tool name is actually the npm
// package of the same name, so there's no safe way to gate this — a wrong
// description actively misleads future matches, which is worse than the
// bare-name fallback. `pip show` stays safe because pipx installs are
// always a 1:1 name-to-PyPI-package mapping, never a name collision.

export function enrichCli(ids) {
  const results = {};
  for (const id of ids) {
    const bin = cliBinary(id);
    const description = tryHelp(bin) ?? (id.startsWith("pipx:") ? tryPipShow(bin) : null);
    if (!description) continue;
    results[id] = {
      type: "cli",
      triggers: [id, bin],
      description: `CLI tool: ${bin} — ${description}`.slice(0, MAX_DESCRIPTION_CHARS),
      enrichedAt: new Date().toISOString(),
    };
  }
  return results;
}

function discoveredCliIds() {
  const result = spawnSync.sync("mise", ["ls", "--json"], { encoding: "utf8" });
  if (result.status !== 0) return [];
  try {
    return Object.keys(JSON.parse(result.stdout || "{}"));
  } catch {
    return [];
  }
}

export async function runEnrichment({ cachePath = DEFAULT_CACHE_PATH, cliIds = null, timeoutMs = 8000 } = {}) {
  const existing = readEnrichmentCache(cachePath);
  const mcp = await enrichMcp({ timeoutMs });
  const cli = enrichCli(cliIds ?? discoveredCliIds());
  const merged = { ...existing, ...mcp, ...cli };
  writeEnrichmentCache(merged, cachePath);
  return merged;
}
