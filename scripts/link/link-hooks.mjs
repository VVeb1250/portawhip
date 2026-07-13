#!/usr/bin/env node
// Sync native lifecycle hooks across agent hosts from hooks.manifest.yaml.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { detectHosts } from "../hosts.mjs";
import { HOOK_TARGETS, LOGICAL_HOOKS, LOGICAL_EVENT_TO_MANIFEST, hookTargetForHost } from "../../core/surface/hook-targets.mjs";

const VALID_COMMANDS = new Set(["status", "install", "remove"]);
const VALID_SCOPES = new Set(["project", "global"]);
const RUNNER = resolve("adapters", "hooks", "universal-hook.mjs");
const MARKER = "universal-hook.mjs";

// HARNESS_ROUTER_STUB_HOME override exists only so tests can point this at a
// tmp dir instead of touching the real home directory.
const STUB_HOME = process.env.HARNESS_ROUTER_STUB_HOME || homedir();
const STUB_PATH = resolve(STUB_HOME, ".harness-router", "hook-stub.mjs");

function ensureStub() {
  const source = readFileSync(resolve("adapters", "hooks", "hook-stub.mjs"), "utf8");
  mkdirSync(dirname(STUB_PATH), { recursive: true });
  const current = existsSync(STUB_PATH) ? readFileSync(STUB_PATH, "utf8") : null;
  if (current !== source) writeFileSync(STUB_PATH, source);
}

function parseArgs(argv) {
  const args = { command: argv[2] ?? "status", scope: "project", json: false };
  for (let i = 3; i < argv.length; i += 1) {
    if (argv[i] === "--scope") {
      args.scope = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--json") {
      args.json = true;
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  if (!VALID_COMMANDS.has(args.command)) {
    throw new Error("usage: link-hooks.mjs <status|install|remove> [--scope project|global]");
  }
  if (!VALID_SCOPES.has(args.scope)) throw new Error(`invalid scope "${args.scope}"`);
  return args;
}

function readJson(path) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function commandFor(hostId, logicalEvent, nativeEvent) {
  return `"${process.execPath}" "${STUB_PATH}" --target "${RUNNER}" --host ${hostId} --event ${logicalEvent} --nativeEvent ${nativeEvent}`;
}

function hookObject(hostId, logicalEvent, nativeEvent, timeout) {
  return {
    type: "command",
    command: commandFor(hostId, logicalEvent, nativeEvent),
    timeout,
    statusMessage: `harness-router ${logicalEvent}`,
  };
}

function eventGroup(hostId, logicalEvent, nativeEvent, format) {
  const base = {
    matcher: logicalEvent === "post_tool" ? "*" : undefined,
    hooks: [hookObject(hostId, logicalEvent, nativeEvent, format === "gemini-settings-json" ? 5000 : 30)],
  };
  if (format === "gemini-settings-json") {
    base.hooks[0].name = `harness-router-${logicalEvent}`;
    const manifestKey = LOGICAL_EVENT_TO_MANIFEST[logicalEvent];
    if (manifestKey) base.hooks[0].description = LOGICAL_HOOKS[manifestKey].description;
    base.sequential = false;
  }
  return Object.fromEntries(Object.entries(base).filter(([, value]) => value !== undefined));
}

function hasHook(config, nativeEvent) {
  return (config.hooks?.[nativeEvent] ?? []).some((group) =>
    (group.hooks ?? []).some((hook) => typeof hook.command === "string" && hook.command.includes(MARKER)),
  );
}

function removeHook(config, nativeEvent) {
  if (!config.hooks?.[nativeEvent]) return false;
  const before = JSON.stringify(config.hooks[nativeEvent]);
  config.hooks[nativeEvent] = config.hooks[nativeEvent]
    .map((group) => ({
      ...group,
      hooks: (group.hooks ?? []).filter(
        (hook) => !(typeof hook.command === "string" && hook.command.includes(MARKER)),
      ),
    }))
    .filter((group) => (group.hooks ?? []).length > 0);
  if (config.hooks[nativeEvent].length === 0) delete config.hooks[nativeEvent];
  return JSON.stringify(config.hooks[nativeEvent] ?? []) !== before;
}

export function installJsonHooks(hostId, target) {
  ensureStub();
  const config = readJson(target.path);
  config.hooks = config.hooks ?? {};
  let changed = false;

  for (const [logicalEvent, nativeEvent] of Object.entries(target.events)) {
    if (!nativeEvent) continue;
    if (hasHook(config, nativeEvent)) continue;
    config.hooks[nativeEvent] = config.hooks[nativeEvent] ?? [];
    config.hooks[nativeEvent].push(eventGroup(hostId, logicalEvent, nativeEvent, target.format));
    changed = true;
  }

  if (changed) writeJson(target.path, config);
  return changed;
}

export function removeJsonHooks(target) {
  if (!existsSync(target.path)) return false;
  const config = readJson(target.path);
  let changed = false;
  for (const nativeEvent of Object.values(target.events)) {
    if (nativeEvent) changed = removeHook(config, nativeEvent) || changed;
  }
  if (changed) writeJson(target.path, config);
  return changed;
}

export function statusJsonHooks(target) {
  if (!existsSync(target.path)) return { linked: false, details: [] };
  const config = readJson(target.path);
  const details = Object.entries(target.events)
    .filter(([, nativeEvent]) => nativeEvent)
    .map(([logicalEvent, nativeEvent]) => `${logicalEvent}:${hasHook(config, nativeEvent) ? "linked" : "missing"}`);
  return { linked: details.length > 0 && details.every((item) => item.endsWith(":linked")), details };
}

function opencodePluginSource() {
  const runner = RUNNER.replace(/\\/g, "\\\\");
  return `// Generated by portable-harness-v2. Do not hand-edit unless you also update scripts/link-hooks.mjs.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

function run(event, payload) {
  if (!existsSync("${runner}")) return; // harness repo deleted - silent no-op, not an error
  spawnSync(process.execPath, ["${runner}", "--host", "opencode", "--event", event, "--nativeEvent", event], {
    input: JSON.stringify(payload ?? {}),
    encoding: "utf8",
  });
}

export const HarnessRouterPlugin = async () => ({
  "tool.execute.after": async (input, output) => {
    run("post_tool", {
      tool_name: input?.tool,
      tool_input: output?.args,
      session_id: input?.sessionID ?? null,
    });
  },
});
`;
}

function applyTarget(command, hostId, target) {
  if (target.kind === "plugin-file") {
    if (command === "status") return { action: existsSync(target.path) ? "linked" : "missing" };
    if (command === "remove") {
      return { action: existsSync(target.path) ? "manual-remove" : "no-op" };
    }
    mkdirSync(dirname(target.path), { recursive: true });
    const next = opencodePluginSource();
    const changed = !existsSync(target.path) || readFileSync(target.path, "utf8") !== next;
    if (changed) writeFileSync(target.path, next);
    return { action: changed ? "changed" : "no-op" };
  }

  if (command === "status") {
    const status = statusJsonHooks(target);
    return { action: status.linked ? "linked" : "missing", details: status.details };
  }
  const changed = command === "install" ? installJsonHooks(hostId, target) : removeJsonHooks(target);
  return { action: changed ? "changed" : "no-op" };
}

export async function collectHookLinks({ command = "status", scope = "project" } = {}) {
  if (command !== "status") {
    throw new Error("link-hooks is read-only; use portawhip sync apply so Rulesync owns the write");
  }
  const hosts = await detectHosts();
  const hostIds = hosts.mcpHosts;
  const rows = [];

  for (const hostId of hostIds) {
    const target = hookTargetForHost(hostId, { scope });
    if (!target) {
      rows.push({
        type: "hook",
        hostId,
        scope,
        supported: false,
        action: "unsupported",
        status: "unsupported",
        path: null,
        details: [],
        note: null,
      });
      continue;
    }
    const result = applyTarget(command, hostId, target);
    rows.push({
      type: "hook",
      hostId,
      scope,
      supported: true,
      action: result.action,
      status: result.action,
      path: resolve(target.path),
      details: result.details ?? [],
      note: target.note ?? null,
    });
  }

  return { command, scope, hostIds, rows };
}

async function main() {
  const { command, scope, json } = parseArgs(process.argv);
  const result = await collectHookLinks({ command, scope });
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`hook command: ${command}`);
  console.log(`scope: ${scope}`);
  console.log(`detected MCP hosts: ${result.hostIds.join(", ") || "(none)"}`);
  console.log("\n== hook links ==");

  for (const row of result.rows) {
    if (!row.supported) {
      console.log(`${row.hostId}: hooks:unsupported`);
      continue;
    }
    const detail = row.details.length ? ` (${row.details.join(", ")})` : "";
    const note = row.note ? `; ${row.note}` : "";
    console.log(`${row.hostId}: hooks:${row.action}; ${row.path}${detail}${note}`);
  }
}

import { pathToFileURL } from "node:url";

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
