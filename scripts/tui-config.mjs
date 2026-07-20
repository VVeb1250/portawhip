import { HARNESS_SCHEMA } from "../core/state/config.mjs";
import { parseConfigValue } from "../core/state/config.mjs";
import { runConfigCommand } from "./config.mjs";

// Every function here takes the schema explicitly rather than importing a fixed
// key space. Which settings exist depends on which capabilities are installed,
// and that is only known after provider discovery — so the TUI resolves the
// schema once at startup and threads it down. Keeping these functions sync (and
// therefore usable straight from Ink's input handlers) is why it is a parameter
// and not an await.

export const CONFIG_SCOPES = ["user", "project"];

function definitionFor(schema, key) {
  const definition = schema.definitions?.[key];
  if (!definition) throw new Error("unknown config key " + JSON.stringify(key));
  return definition;
}

function valueAt(document, key) {
  return key.split(".").reduce((value, segment) => value?.[segment], document);
}

export function formatConfigValue(value) {
  if (value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function configInputHint(key, { schema = HARNESS_SCHEMA } = {}) {
  const definition = definitionFor(schema, key);
  if (definition.type === "boolean") return "allowed: false | true";
  if (definition.type === "enum") return "allowed: " + definition.values.join(" | ");
  if (definition.min != null && definition.max != null) return "range: " + definition.min + " to " + definition.max;
  if (definition.min != null) return "minimum: " + definition.min;
  if (definition.max != null) return "maximum: " + definition.max;
  if (definition.type === "path") return "file path";
  return definition.type === "string" ? "non-empty text" : "numeric value";
}

export function collectConfigRows({ schema = HARNESS_SCHEMA, runner = runConfigCommand } = {}) {
  const effective = runner(["list", "--scope", "effective"], { schema }).config;
  const user = runner(["list", "--scope", "user"], { schema }).config;
  const project = runner(["list", "--scope", "project"], { schema }).config;
  return Object.keys(schema.definitions ?? {}).map((key) => {
    const effectiveValue = valueAt(effective, key);
    const userValue = valueAt(user, key);
    const projectValue = valueAt(project, key);
    return {
      key,
      type: schema.definitions[key].type,
      description: schema.definitions[key].description,
      inputHint: configInputHint(key, { schema }),
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

export function nextChoiceDraft(key, currentValue, direction = 1, { schema = HARNESS_SCHEMA } = {}) {
  const definition = definitionFor(schema, key);
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

export function appendConfigInput(key, currentValue, input, { schema = HARNESS_SCHEMA } = {}) {
  const definition = definitionFor(schema, key);
  const current = String(currentValue);
  if (definition.type === "boolean" || definition.type === "enum") return current;
  if (definition.type === "integer") return /^[0-9]+$/.test(input) ? current + input : current;
  if (definition.type === "number") {
    const candidate = current + input;
    return /^[0-9]*(?:[.][0-9]*)?$/.test(candidate) ? candidate : current;
  }
  return current + input;
}

export function validateConfigDraft(key, value, { schema = HARNESS_SCHEMA } = {}) {
  return parseConfigValue(key, value, { schema });
}

export function runConfigWrite({ action, key, value, scope, schema = HARNESS_SCHEMA, runner = runConfigCommand }) {
  if (!CONFIG_SCOPES.includes(scope)) throw new Error("invalid TUI config scope " + JSON.stringify(scope));
  if (action === "set") return runner(["set", key, value, "--scope", scope], { schema });
  if (action === "unset") return runner(["unset", key, "--scope", scope], { schema });
  throw new Error("unsupported TUI config action " + JSON.stringify(action));
}
