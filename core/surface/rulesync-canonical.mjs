const SECRET_KEY = /(token|secret|password|authorization|api[_-]?key)/i;
const ENV_REFERENCE = /^\$\{?[A-Z_][A-Z0-9_]*\}?$/;

function safeKeyValues(values, location) {
  const kept = {};
  const warnings = [];
  for (const [key, value] of Object.entries(values ?? {})) {
    if (SECRET_KEY.test(key) && !ENV_REFERENCE.test(String(value))) {
      warnings.push(`${location}.${key} contained a literal secret and was omitted`);
      continue;
    }
    kept[key] = value;
  }
  return { kept, warnings };
}

export function normalizeMcpConfig(input = {}) {
  const source = input.server ?? input;
  const transport = String(source.type ?? source.transport ?? "").toLowerCase().replace(/-/g, "_");
  const config = {};
  if (source.command) {
    config.type = "stdio";
    config.command = source.command;
    if (Array.isArray(source.args) && source.args.length > 0) config.args = source.args;
  } else if (source.url) {
    config.type = transport === "sse" ? "sse" : "http";
    config.url = source.url;
  } else {
    return { config: null, warnings: ["MCP config had neither command nor URL and was omitted"] };
  }

  const env = safeKeyValues(source.env, "env");
  const headers = safeKeyValues(source.headers, "headers");
  if (Object.keys(env.kept).length > 0) config.env = env.kept;
  if (Object.keys(headers.kept).length > 0) config.headers = headers.kept;
  return { config, warnings: [...env.warnings, ...headers.warnings] };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function identity(config) {
  return JSON.stringify(stable(config));
}

function isHostPrivateMcp(server) {
  const source = server.config?.server ?? server.config ?? {};
  const command = String(source.command ?? "").replace(/\\/g, "/");
  return (
    server.serverName === "node_repl" &&
    (/\/OpenAI\/Codex\/runtimes\//i.test(command) || source.env?.SKY_CUA_NATIVE_PIPE === "1")
  );
}

export function unionMcpServers(agentServers = []) {
  const candidates = new Map();
  const warnings = [];
  for (const host of agentServers) {
    for (const server of host.servers ?? []) {
      if (isHostPrivateMcp(server)) {
        warnings.push(`${host.agentType}:${server.serverName}: host-private node_repl runtime was omitted`);
        continue;
      }
      const normalized = normalizeMcpConfig(server.config);
      warnings.push(...normalized.warnings.map((warning) => `${host.agentType}:${server.serverName}: ${warning}`));
      if (!normalized.config) continue;
      const item = { host: host.agentType, config: normalized.config };
      const list = candidates.get(server.serverName) ?? [];
      list.push(item);
      candidates.set(server.serverName, list);
    }
  }

  const servers = {};
  const conflicts = [];
  for (const [name, variants] of candidates) {
    const unique = new Map(variants.map((variant) => [identity(variant.config), variant.config]));
    if (unique.size === 1) {
      servers[name] = unique.values().next().value;
      continue;
    }
    conflicts.push({ name, hosts: variants.map((variant) => variant.host) });
  }
  return { servers, conflicts, warnings };
}

export function canonicalRootForScope({ root = resolve("."), scope = "project", home = homedir() } = {}) {
  return scope === "global" ? join(home, ".config", "portawhip", "global") : resolve(root);
}

export async function seedMcpCanonical({
  root = resolve("."),
  scope = "project",
  home = homedir(),
  discover = null,
  apply = false,
} = {}) {
  const listInstalledServers =
    discover ??
    (async (options) => {
      const addMcp = await import("add-mcp");
      return addMcp.listInstalledServers(options);
    });
  const installed = await listInstalledServers({ global: scope === "global", cwd: resolve(root) });
  const union = unionMcpServers(installed);
  const canonicalRoot = canonicalRootForScope({ root, scope, home });
  const path = join(canonicalRoot, ".rulesync", "mcp.json");
  if (union.conflicts.length > 0) {
    return { status: "blocked", scope, path, ...union, count: Object.keys(union.servers).length };
  }
  if (!apply) return { status: "preview", scope, path, ...union, count: Object.keys(union.servers).length };
  mkdirSync(dirname(path), { recursive: true });
  const payload = {
    $schema: "https://github.com/dyoshikawa/rulesync/releases/download/v9.6.3/mcp-schema.json",
    mcpServers: union.servers,
  };
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`);
  renameSync(temporary, path);
  return { status: "success", scope, path, ...union, count: Object.keys(union.servers).length };
}
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
