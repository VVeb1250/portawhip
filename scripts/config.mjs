#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as yaml from "js-yaml";
import { HARNESS_SCHEMA, configKeys, loadRuntimeConfig, parseConfigValue, projectConfigPath, resolveSchema, userConfigPath } from "../core/state/config.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE_CONFIG_PATH = join(ROOT, "router.config.yaml");
const ACTIONS = new Set(["list", "get", "set", "unset", "path"]);
const SCOPES = new Set(["effective", "user", "project"]);

function parseArgs(argv) {
  const action = argv[0] ?? "list";
  if (!ACTIONS.has(action)) throw new Error("unknown config action " + JSON.stringify(action));
  const args = { action, scope: null, json: false, positional: [] };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--scope") {
      args.scope = argv[index + 1];
      index += 1;
    } else if (arg === "--json") {
      args.json = true;
    } else {
      args.positional.push(arg);
    }
  }
  args.scope ??= ["list", "get"].includes(action) ? "effective" : "user";
  if (!SCOPES.has(args.scope)) throw new Error("invalid config scope " + JSON.stringify(args.scope));
  if (["set", "unset"].includes(action) && args.scope === "effective") {
    throw new Error("set and unset require --scope user or --scope project");
  }
  return args;
}

function readDocument(path) {
  if (!existsSync(path)) return {};
  const raw = yaml.load(readFileSync(path, "utf8")) ?? {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("config file must contain a YAML mapping: " + path);
  return raw;
}

function writeDocument(path, document) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = path + "." + process.pid + ".tmp";
  writeFileSync(temporary, yaml.dump(document, { noRefs: true, lineWidth: 100 }) || "{}\n");
  renameSync(temporary, path);
}

function valueAt(document, key) {
  return key.split(".").reduce((value, segment) => value?.[segment], document);
}

function setValue(document, key, value) {
  const segments = key.split(".");
  let cursor = document;
  for (const segment of segments.slice(0, -1)) {
    if (!cursor[segment] || typeof cursor[segment] !== "object" || Array.isArray(cursor[segment])) cursor[segment] = {};
    cursor = cursor[segment];
  }
  cursor[segments.at(-1)] = value;
}

function unsetValue(document, key) {
  const segments = key.split(".");
  const parents = [];
  let cursor = document;
  for (const segment of segments.slice(0, -1)) {
    if (!cursor[segment] || typeof cursor[segment] !== "object") return false;
    parents.push([cursor, segment]);
    cursor = cursor[segment];
  }
  const leaf = segments.at(-1);
  if (!Object.hasOwn(cursor, leaf)) return false;
  delete cursor[leaf];
  for (const [parent, segment] of parents.reverse()) {
    if (Object.keys(parent[segment]).length === 0) delete parent[segment];
  }
  return true;
}

function targetPath(scope, context) {
  return scope === "project" ? projectConfigPath(context.cwd) : userConfigPath(context);
}

function configForScope(scope, context) {
  if (scope !== "effective") return readDocument(targetPath(scope, context));
  return loadRuntimeConfig({
    schema: context.schema,
    basePath: context.basePath ?? BASE_CONFIG_PATH,
    cwd: context.cwd,
    home: context.home,
    env: context.env,
    platform: context.platform,
  });
}

// `schema` decides which keys exist. Callers that want the full installed key
// space — the CLI, the TUI — resolve it once with resolveSchema() and pass it
// in; the harness schema alone is the floor, not a guess at what is installed.
export function runConfigCommand(argv, options = {}) {
  const context = {
    cwd: options.cwd ?? process.cwd(),
    home: options.home ?? homedir(),
    env: options.env ?? process.env,
    platform: options.platform ?? process.platform,
    basePath: options.basePath,
    schema: options.schema ?? HARNESS_SCHEMA,
  };
  const args = parseArgs(argv);
  if (args.action === "path") {
    if (args.scope === "effective") throw new Error("path requires --scope user or --scope project");
    return { action: "path", scope: args.scope, path: targetPath(args.scope, context) };
  }
  if (args.action === "list") return { action: "list", scope: args.scope, config: configForScope(args.scope, context) };
  const key = args.positional[0];
  if (!key) throw new Error(args.action + " requires a config key");
  const { schema } = context;
  if (!configKeys({ schema }).includes(key)) throw new Error("unknown config key " + JSON.stringify(key) + ". Valid keys: " + configKeys({ schema }).join(", "));
  if (args.action === "get") {
    return { action: "get", scope: args.scope, key, value: valueAt(configForScope(args.scope, context), key) };
  }
  const path = targetPath(args.scope, context);
  const document = readDocument(path);
  if (args.action === "set") {
    if (args.positional.length < 2) throw new Error("set requires a value");
    const value = parseConfigValue(key, args.positional[1], { schema });
    setValue(document, key, value);
    writeDocument(path, document);
    return { action: "set", scope: args.scope, path, key, value };
  }
  const removed = unsetValue(document, key);
  if (removed) writeDocument(path, document);
  return { action: "unset", scope: args.scope, path, key, removed };
}

function printHelp() {
  console.log([
    "usage:",
    "  portawhip config list [--scope effective|user|project] [--json]",
    "  portawhip config get <key> [--scope effective|user|project]",
    "  portawhip config set <key> <value> [--scope user|project]",
    "  portawhip config unset <key> [--scope user|project]",
    "  portawhip config path --scope user|project",
    "",
    "Writes default to user scope. Project settings live in .portawhip/config.yaml.",
    "Set PORTAWHIP_CONFIG to use an explicit highest-priority config file.",
  ].join("\n"));
}

function printResult(result, json) {
  if (json) console.log(JSON.stringify(result, null, 2));
  else if (result.action === "list") process.stdout.write(yaml.dump(result.config, { noRefs: true, lineWidth: 100 }));
  else if (result.action === "get") console.log(typeof result.value === "object" ? yaml.dump(result.value).trim() : String(result.value));
  else if (result.action === "path") console.log(result.path);
  else if (result.action === "set") {
    console.log("set " + result.key + "=" + String(result.value) + " (" + result.scope + ")");
    console.log(result.path);
  } else {
    console.log((result.removed ? "unset " : "not set ") + result.key + " (" + result.scope + ")");
    console.log(result.path);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (["--help", "-h", "help"].includes(argv[0])) return printHelp();
  printResult(runConfigCommand(argv, { schema: await resolveSchema() }), argv.includes("--json"));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});