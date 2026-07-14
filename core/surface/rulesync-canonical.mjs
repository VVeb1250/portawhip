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

function isHostPrivateMcp(server) {
  const source = server.config?.server ?? server.config ?? {};
  const command = String(source.command ?? "").replace(/\\/g, "/");
  return (
    server.serverName === "node_repl" &&
    (/\/OpenAI\/Codex\/runtimes\//i.test(command) || source.env?.SKY_CUA_NATIVE_PIPE === "1")
  );
}

// Merge N variants of the same server (one per host) into a single canonical
// config, or report genuine divergence. Resolvable: the identity core
// (type/command/url/args) is identical everywhere and env/headers union with no
// conflicting value on a shared key — the gortex case (one host merely adds an
// env var). Divergent: any identity-core difference, or a shared env/header key
// whose value disagrees — surfaced (with the exact keys) for the user to pick
// once at import, never guessed through. Scope/merge are DERIVED from the
// configs, not a per-server list, so user-loaded tools follow the same rule.
export function mergeVariants(configs = []) {
  const divergent = [];
  const warnings = [];
  for (const key of ["type", "command", "url", "args"]) {
    const values = new Set(configs.map((config) => JSON.stringify(config?.[key] ?? null)));
    if (values.size > 1) divergent.push(key);
  }
  const merged = { ...(configs[0] ?? {}) };
  for (const bag of ["env", "headers"]) {
    const union = {};
    const seen = {};
    for (const config of configs) {
      for (const [key, value] of Object.entries(config?.[bag] ?? {})) {
        const encoded = JSON.stringify(value);
        if (key in seen && seen[key] !== encoded) {
          if (!divergent.includes(`${bag}.${key}`)) divergent.push(`${bag}.${key}`);
          continue;
        }
        seen[key] = encoded;
        union[key] = value;
      }
    }
    for (const key of Object.keys(union)) {
      const inEvery = configs.every((config) => (config?.[bag] ?? {})[key] !== undefined);
      if (!inEvery && SECRET_KEY.test(key)) {
        warnings.push(`${bag}.${key} propagated to hosts that did not declare it`);
      }
    }
    if (Object.keys(union).length > 0) merged[bag] = union;
    else delete merged[bag];
  }
  if (divergent.length > 0) return { status: "divergent", keys: divergent };
  return { status: "resolved", config: merged, warnings };
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
    const merged = mergeVariants(variants.map((variant) => variant.config));
    if (merged.status === "resolved") {
      servers[name] = merged.config;
      warnings.push(...merged.warnings.map((warning) => `${name}: ${warning}`));
      continue;
    }
    conflicts.push({ name, hosts: variants.map((variant) => variant.host), keys: merged.keys });
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
  // A project-bound server (repo-relative launch path) is meaningless in the
  // user's global config, so it can never be fanned out globally. Drop it from
  // the global canonical — including from the conflict list, so a per-host path
  // difference on a project server never blocks the global seed. Scope is
  // DERIVED from the config, never a hand-kept list, so user-loaded tools flow
  // through the same rule. Project scope keeps everything (host-native merge
  // handles inheritance of anything also declared globally).
  const excluded = [];
  if (scope === "global") {
    const projectBound = new Set();
    for (const host of installed) {
      for (const server of host.servers ?? []) {
        const normalized = normalizeMcpConfig(server.config);
        if (normalized.config && configIsProjectBound(normalized.config, resolve(root))) {
          projectBound.add(server.serverName);
        }
      }
    }
    for (const name of projectBound) {
      if (name in union.servers) delete union.servers[name];
      excluded.push({ name, reason: "project-bound path — project scope only" });
    }
    union.conflicts = union.conflicts.filter((conflict) => !projectBound.has(conflict.name));
  }
  const canonicalRoot = canonicalRootForScope({ root, scope, home });
  const path = join(canonicalRoot, ".rulesync", "mcp.json");
  if (union.conflicts.length > 0) {
    return { status: "blocked", scope, path, excluded, ...union, count: Object.keys(union.servers).length };
  }
  if (!apply) return { status: "preview", scope, path, excluded, ...union, count: Object.keys(union.servers).length };
  mkdirSync(dirname(path), { recursive: true });
  const payload = {
    $schema: "https://github.com/dyoshikawa/rulesync/releases/download/v9.6.3/mcp-schema.json",
    mcpServers: union.servers,
  };
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`);
  renameSync(temporary, path);
  return { status: "success", scope, path, excluded, ...union, count: Object.keys(union.servers).length };
}
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { configIsProjectBound } from "./scope-derive.mjs";
