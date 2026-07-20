import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import * as yaml from "js-yaml";
import { HARNESS_SCHEMA, mergeSchemas } from "./config-schema.mjs";
import { providerConfigSchemas } from "./capability-providers.mjs";

// This module owns the config *machinery* — where files live, how layers stack,
// how a value is validated. It does not own the key space; a schema does. The
// harness schema is the default so every caller that only cares about harness
// settings keeps working unchanged, and callers that need the full installed key
// space (the CLI, the TUI settings tab) resolve one first.
export { HARNESS_SCHEMA, mergeSchemas } from "./config-schema.mjs";

// Assembles the harness schema plus whatever installed providers contribute.
// Async because provider discovery is; resolve it once at an entry point and
// thread the result down rather than re-resolving per call.
export async function resolveSchema(options = {}) {
  return mergeSchemas(HARNESS_SCHEMA, ...(await providerConfigSchemas(options)));
}

function readConfigDocument(path) {
  if (!path || !existsSync(path)) return {};
  try {
    const raw = yaml.load(readFileSync(path, "utf8")) ?? {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("top level must be a mapping");
    return raw;
  } catch (error) {
    throw new Error("cannot read portawhip config " + path + ": " + error.message);
  }
}

export function userConfigPath({ home = homedir(), env = process.env, platform = process.platform } = {}) {
  if (env.PORTAWHIP_CONFIG) return resolve(env.PORTAWHIP_CONFIG);
  const configHome = platform === "win32"
    ? env.APPDATA || join(home, "AppData", "Roaming")
    : env.XDG_CONFIG_HOME || join(home, ".config");
  return resolve(configHome, "portawhip", "config.yaml");
}

export function projectConfigPath(cwd = process.cwd()) {
  return resolve(cwd, ".portawhip", "config.yaml");
}

export function loadRuntimeConfig({ schema = HARNESS_SCHEMA, basePath = null, cwd = process.cwd(), home = homedir(), env = process.env, platform = process.platform } = {}) {
  const standardEnv = { ...env };
  delete standardEnv.PORTAWHIP_CONFIG;
  const paths = [
    basePath ? resolve(basePath) : null,
    userConfigPath({ home, env: standardEnv, platform }),
    projectConfigPath(cwd),
    env.PORTAWHIP_CONFIG ? resolve(env.PORTAWHIP_CONFIG) : null,
  ].filter(Boolean);
  let raw = {};
  // Tracks which file last set a relative path value, so it can be resolved
  // against that file's directory rather than the process cwd.
  const pathSources = {};
  for (const path of [...new Set(paths)]) {
    if (!existsSync(path)) continue;
    const layer = readConfigDocument(path);
    // Nested mappings a schema marks as mergeable stack key-by-key across
    // layers; everything else is replaced by the higher-priority layer. The
    // merge is computed from the accumulator BEFORE the spread overwrites it.
    const merged = {};
    for (const key of schema.mergeKeys ?? []) {
      if (layer[key] && typeof layer[key] === "object") merged[key] = { ...(raw[key] ?? {}), ...layer[key] };
    }
    raw = { ...raw, ...layer, ...merged };
    for (const [key, definition] of Object.entries(schema.definitions ?? {})) {
      if (definition.type === "path" && typeof layer[key] === "string" && layer[key].trim()) pathSources[key] = path;
    }
  }
  const config = schema.normalize(raw);
  for (const [key, source] of Object.entries(pathSources)) {
    if (typeof config[key] === "string" && !isAbsolute(config[key])) config[key] = resolve(dirname(source), config[key]);
  }
  return config;
}

export function loadConfig(path = "router.config.yaml", { schema = HARNESS_SCHEMA } = {}) {
  if (!existsSync(path)) return schema.normalize({});
  return schema.normalize(readConfigDocument(path));
}

export function configKeys({ schema = HARNESS_SCHEMA } = {}) {
  return Object.keys(schema.definitions ?? {});
}

export function parseConfigValue(key, rawValue, { schema = HARNESS_SCHEMA } = {}) {
  const definition = schema.definitions?.[key];
  if (!definition) throw new Error("unknown config key " + JSON.stringify(key) + ". Valid keys: " + configKeys({ schema }).join(", "));
  let value;
  if (definition.type === "boolean") {
    if (!["true", "false"].includes(rawValue)) throw new Error(key + " must be true or false");
    value = rawValue === "true";
  } else if (definition.type === "number" || definition.type === "integer") {
    if (String(rawValue).trim() === "" || !Number.isFinite(Number(rawValue))) throw new Error(key + " must be a number");
    value = Number(rawValue);
    if (definition.type === "integer" && !Number.isInteger(value)) throw new Error(key + " must be an integer");
  } else if (definition.type === "enum") {
    if (!definition.values.includes(rawValue)) throw new Error(key + " must be one of: " + definition.values.join(", "));
    value = rawValue;
  } else {
    if (!String(rawValue).trim()) throw new Error(key + " must not be empty");
    value = String(rawValue);
  }
  if (definition.min != null && definition.max != null && (value < definition.min || value > definition.max)) {
    throw new Error(key + " must be between " + definition.min + " and " + definition.max);
  }
  if (definition.min != null && value < definition.min) throw new Error(key + " must be at least " + definition.min);
  if (definition.max != null) {
    if (value > definition.max) throw new Error(key + " must be at most " + definition.max);
  }
  return value;
}
