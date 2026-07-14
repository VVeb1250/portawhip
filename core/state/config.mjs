import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import * as yaml from "js-yaml";

export const DEFAULTS = {
  engine: "hybrid",
  threshold: 2,
  recipeThreshold: 1,
  hybridThreshold: 350,
  hybridRecipeThreshold: 130,
  hybridToolThreshold: 80,
  graphPath: ".hp-state/capability-graph.json",
  graphBoost: 0.25,
  k: 5,
  peakednessRatio: 1.05,
  denseEnabled: true,
  denseThreshold: 0.6,
  pushMode: "silent",
  pushBudgetChars: 640,
  pushMinConfidence: 0.75,
  pushMaxMentionsPerSession: 2,
  autoSync: { enabled: false, throttleMinutes: 60 },
};

export const CONFIG_DEFINITIONS = {
  engine: { type: "enum", values: ["keyword", "hybrid"] },
  threshold: { type: "number", min: 0 },
  recipeThreshold: { type: "number", min: 0 },
  hybridThreshold: { type: "number", min: 0 },
  hybridRecipeThreshold: { type: "number", min: 0 },
  hybridToolThreshold: { type: "number", min: 0 },
  graphPath: { type: "string" },
  graphBoost: { type: "number", min: 0 },
  k: { type: "integer", min: 1 },
  peakednessRatio: { type: "number", min: 1 },
  denseEnabled: { type: "boolean" },
  denseThreshold: { type: "number", min: 0, max: 1 },
  pushMode: { type: "enum", values: ["silent", "legacy"] },
  pushBudgetChars: { type: "integer", min: 1 },
  pushMinConfidence: { type: "number", min: 0, max: 1 },
  pushMaxMentionsPerSession: { type: "integer", min: 0 },
  "autoSync.enabled": { type: "boolean" },
  "autoSync.throttleMinutes": { type: "number", min: 0 },
};

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

function normalizeConfig(raw) {
  return {
    engine: ["keyword", "hybrid"].includes(raw.engine) ? raw.engine : DEFAULTS.engine,
    threshold: typeof raw.threshold === "number" ? raw.threshold : DEFAULTS.threshold,
    recipeThreshold: typeof raw.recipeThreshold === "number" ? raw.recipeThreshold : DEFAULTS.recipeThreshold,
    hybridThreshold: typeof raw.hybridThreshold === "number" ? raw.hybridThreshold : DEFAULTS.hybridThreshold,
    hybridRecipeThreshold: typeof raw.hybridRecipeThreshold === "number" ? raw.hybridRecipeThreshold : DEFAULTS.hybridRecipeThreshold,
    hybridToolThreshold: typeof raw.hybridToolThreshold === "number" ? raw.hybridToolThreshold : DEFAULTS.hybridToolThreshold,
    graphPath: typeof raw.graphPath === "string" && raw.graphPath.trim() ? raw.graphPath : DEFAULTS.graphPath,
    graphBoost: typeof raw.graphBoost === "number" ? raw.graphBoost : DEFAULTS.graphBoost,
    k: typeof raw.k === "number" ? raw.k : DEFAULTS.k,
    peakednessRatio: typeof raw.peakednessRatio === "number" ? raw.peakednessRatio : DEFAULTS.peakednessRatio,
    denseEnabled: typeof raw.denseEnabled === "boolean" ? raw.denseEnabled : DEFAULTS.denseEnabled,
    denseThreshold: typeof raw.denseThreshold === "number" ? raw.denseThreshold : DEFAULTS.denseThreshold,
    pushMode: ["legacy", "silent"].includes(raw.pushMode) ? raw.pushMode : DEFAULTS.pushMode,
    pushBudgetChars: typeof raw.pushBudgetChars === "number" ? raw.pushBudgetChars : DEFAULTS.pushBudgetChars,
    pushMinConfidence: typeof raw.pushMinConfidence === "number" ? raw.pushMinConfidence : DEFAULTS.pushMinConfidence,
    pushMaxMentionsPerSession: typeof raw.pushMaxMentionsPerSession === "number" ? raw.pushMaxMentionsPerSession : DEFAULTS.pushMaxMentionsPerSession,
    autoSync: normalizeAutoSync(raw.autoSync),
  };
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

export function loadRuntimeConfig({ basePath = null, cwd = process.cwd(), home = homedir(), env = process.env, platform = process.platform } = {}) {
  const standardEnv = { ...env };
  delete standardEnv.PORTAWHIP_CONFIG;
  const paths = [
    basePath ? resolve(basePath) : null,
    userConfigPath({ home, env: standardEnv, platform }),
    projectConfigPath(cwd),
    env.PORTAWHIP_CONFIG ? resolve(env.PORTAWHIP_CONFIG) : null,
  ].filter(Boolean);
  let raw = {};
  let graphSource = null;
  for (const path of [...new Set(paths)]) {
    if (!existsSync(path)) continue;
    const layer = readConfigDocument(path);
    raw = {
      ...raw,
      ...layer,
      autoSync: { ...(raw.autoSync ?? {}), ...(layer.autoSync ?? {}) },
    };
    if (typeof layer.graphPath === "string" && layer.graphPath.trim()) graphSource = path;
  }
  const config = normalizeConfig(raw);
  if (graphSource && !isAbsolute(config.graphPath)) config.graphPath = resolve(dirname(graphSource), config.graphPath);
  return config;
}

export function loadConfig(path = "router.config.yaml") {
  if (!existsSync(path)) return { ...DEFAULTS, autoSync: { ...DEFAULTS.autoSync } };
  return normalizeConfig(readConfigDocument(path));
}

export function configKeys() {
  return Object.keys(CONFIG_DEFINITIONS);
}

export function parseConfigValue(key, rawValue) {
  const definition = CONFIG_DEFINITIONS[key];
  if (!definition) throw new Error("unknown config key " + JSON.stringify(key) + ". Valid keys: " + configKeys().join(", "));
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
  if (definition.max != null && value > definition.max) throw new Error(key + " must be at most " + definition.max);
  return value;
}

function normalizeAutoSync(raw) {
  if (!raw || typeof raw !== "object") return { ...DEFAULTS.autoSync };
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULTS.autoSync.enabled,
    throttleMinutes: typeof raw.throttleMinutes === "number" ? raw.throttleMinutes : DEFAULTS.autoSync.throttleMinutes,
  };
}