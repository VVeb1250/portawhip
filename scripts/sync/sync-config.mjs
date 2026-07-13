#!/usr/bin/env node
// Cross-host config sync facade.
//
// This script deliberately delegates real sync to existing backends instead of
// inventing another config reconciler here. It gives portawhip one stable
// command surface for status/preview/apply while preserving backend ownership.

import { CONFIG_SYNC_BACKENDS, backendById, normalizeBackendId, runBackend } from "../../core/surface/config-sync-backends.mjs";

const VALID_ACTIONS = new Set(["status", "preview", "apply"]);
const VALID_SCOPES = new Set(["all", "project", "global"]);
const PROFILES = {
  "project-instructions": {
    backends: ["rulesync"],
    scope: "project",
    include: "instructions",
  },
  "global-instructions": {
    backends: ["rulesync"],
    scope: "global",
    include: "instructions",
  },
  "project-mcp": {
    backends: ["rulesync"],
    scope: "project",
    include: "mcp",
  },
  "asm-status": {
    backends: ["agent-skill-manager"],
  },
};

function parseCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseArgs(argv) {
  const args = {
    action: argv[2] ?? "status",
    backends: ["rulesync"],
    json: false,
    allowApply: false,
    allowNpx: false,
    scope: "all",
    include: null,
    exclude: null,
    from: null,
    to: null,
    profile: null,
  };

  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--backend") {
      args.backends = [argv[i + 1]];
      i += 1;
    } else if (arg === "--backends") {
      args.backends = parseCsv(argv[i + 1]);
      i += 1;
    } else if (arg === "--all-backends") {
      args.backends = Object.keys(CONFIG_SYNC_BACKENDS);
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--apply") {
      args.allowApply = true;
    } else if (arg === "--allow-npx") {
      args.allowNpx = true;
    } else if (arg === "--profile") {
      args.profile = argv[i + 1];
      i += 1;
    } else if (arg === "--scope") {
      args.scope = argv[i + 1];
      i += 1;
    } else if (arg === "--include") {
      args.include = argv[i + 1];
      i += 1;
    } else if (arg === "--exclude") {
      args.exclude = argv[i + 1];
      i += 1;
    } else if (arg === "--from") {
      args.from = argv[i + 1];
      i += 1;
    } else if (arg === "--to") {
      args.to = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!VALID_ACTIONS.has(args.action)) {
    throw new Error(
      "usage: sync-config.mjs <status|preview|apply> [--backend id|--profile name|--all-backends] [--json] [--allow-npx]",
    );
  }
  applyProfile(args);
  if (!VALID_SCOPES.has(args.scope)) {
    throw new Error(`invalid scope "${args.scope}"`);
  }
  if (args.action === "apply" && !args.allowApply) {
    throw new Error("apply requires an explicit --apply flag; run preview first");
  }
  if (args.action === "apply") {
    throw new Error(
      "direct apply is retired; use `portawhip sync apply --scope <scope> --apply` for backup, rollback, and ownership checks",
    );
  }
  args.backends = args.backends.map(normalizeBackendId);
  for (const backend of args.backends) backendById(backend);
  return args;
}

function applyProfile(args) {
  if (!args.profile) return;
  const profile = PROFILES[args.profile];
  if (!profile) throw new Error(`unknown profile "${args.profile}". valid: ${Object.keys(PROFILES).join(", ")}`);
  args.backends = profile.backends ?? args.backends;
  args.scope = profile.scope ?? args.scope;
  args.include = profile.include ?? args.include;
  args.exclude = profile.exclude ?? args.exclude;
}

function optionsFromArgs(args) {
  return {
    scope: args.scope,
    include: args.include,
    exclude: args.exclude,
    from: args.from,
    to: args.to,
    cwd: process.cwd(),
    allowNpx: args.allowNpx,
  };
}

export function collectSyncConfig({
  action = "status",
  backends = ["rulesync"],
  options = {},
  runner = null,
} = {}) {
  const rows = [];
  for (const backend of backends) {
    try {
      rows.push(runner ? runBackend(backend, action, options, runner) : runBackend(backend, action, options));
    } catch (error) {
      const unsupported = /does not support/.test(error.message);
      rows.push({
        backend: normalizeBackendId(backend),
        label: normalizeBackendId(backend),
        action,
        command: [],
        ok: unsupported,
        status: unsupported ? "unsupported" : "error",
        summary: error.message,
        output: "",
        installHint: null,
        next_actions: unsupported ? ["Use status for probe-only backends."] : ["Use a supported backend/action combination."],
        artifacts: [],
      });
    }
  }
  const ok = rows.every((row) => row.ok);
  return {
    status: ok ? "success" : "warning",
    summary: ok ? `${action} succeeded for ${rows.length} backend(s)` : `${action} needs attention`,
    action,
    rows,
    next_actions: ok ? ["Review backend output for drift details."] : summarizeNextActions(rows),
    artifacts: [],
  };
}

function summarizeNextActions(rows) {
  const actions = rows.flatMap((row) => row.next_actions ?? []);
  return [...new Set(actions.length ? actions : ["Inspect failed backend output."])];
}

function printText(result) {
  console.log(`sync-config action: ${result.action}`);
  console.log(`status: ${result.status}`);
  console.log(result.summary);
  console.log("\n== backends ==");
  for (const row of result.rows) {
    const command = row.command.length ? ` (${row.command.join(" ")})` : "";
    console.log(`${row.backend}: ${row.ok ? "OK" : "FAIL"} ${row.summary}${command}`);
    if (!row.ok && row.installHint) console.log(`  install: ${row.installHint}`);
    if (row.output.trim()) {
      const lines = row.output.trim().split(/\r?\n/).slice(0, 20);
      for (const line of lines) console.log(`  ${line}`);
      if (row.output.trim().split(/\r?\n/).length > lines.length) console.log("  ...");
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const result = collectSyncConfig({
    action: args.action,
    backends: args.backends,
    options: optionsFromArgs(args),
  });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printText(result);
  }
  process.exitCode = result.status === "success" ? 0 : 1;
}

import { pathToFileURL } from "node:url";

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
