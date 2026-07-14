import { CONFIG_DEFINITIONS, configKeys, parseConfigValue } from "../core/state/config.mjs";
import { runConfigCommand } from "./config.mjs";

export const CONFIG_SCOPES = ["user", "project"];

function valueAt(document, key) {
  return key.split(".").reduce((value, segment) => value?.[segment], document);
}

export function formatConfigValue(value) {
  if (value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function collectConfigRows({ runner = runConfigCommand } = {}) {
  const effective = runner(["list", "--scope", "effective"]).config;
  const user = runner(["list", "--scope", "user"]).config;
  const project = runner(["list", "--scope", "project"]).config;
  return configKeys().map((key) => {
    const effectiveValue = valueAt(effective, key);
    const userValue = valueAt(user, key);
    const projectValue = valueAt(project, key);
    return {
      key,
      type: CONFIG_DEFINITIONS[key].type,
      effective: effectiveValue,
      user: userValue,
      project: projectValue,
      source: projectValue !== undefined ? "project" : userValue !== undefined ? "user" : "packaged",
    };
  });
}

export function draftForRow(row, scope) {
  return formatConfigValue(row[scope] !== undefined ? row[scope] : row.effective);
}

export function nextChoiceDraft(key, currentValue, direction = 1) {
  const definition = CONFIG_DEFINITIONS[key];
  if (!definition) throw new Error("unknown config key " + JSON.stringify(key));
  const values =
    definition.type === "boolean"
      ? ["false", "true"]
      : definition.type === "enum"
        ? definition.values
        : null;
  if (!values) return currentValue;
  const currentIndex = values.indexOf(String(currentValue));
  const start = currentIndex >= 0 ? currentIndex : 0;
  return values[(start + direction + values.length) % values.length];
}

export function appendConfigInput(key, currentValue, input) {
  const definition = CONFIG_DEFINITIONS[key];
  if (!definition) throw new Error("unknown config key " + JSON.stringify(key));
  const current = String(currentValue);
  if (definition.type === "boolean" || definition.type === "enum") return current;
  if (definition.type === "integer") return /^[0-9]+$/.test(input) ? current + input : current;
  if (definition.type === "number") {
    const candidate = current + input;
    return /^[0-9]*(?:[.][0-9]*)?$/.test(candidate) ? candidate : current;
  }
  return current + input;
}
export function validateConfigDraft(key, value) {
  return parseConfigValue(key, value);
}

export function runConfigWrite({ action, key, value, scope, runner = runConfigCommand }) {
  if (!CONFIG_SCOPES.includes(scope)) throw new Error("invalid TUI config scope " + JSON.stringify(scope));
  if (action === "set") return runner(["set", key, value, "--scope", scope]);
  if (action === "unset") return runner(["unset", key, "--scope", scope]);
  throw new Error("unsupported TUI config action " + JSON.stringify(action));
}