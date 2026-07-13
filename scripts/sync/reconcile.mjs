#!/usr/bin/env node

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  claimOwnership,
  readOwnershipLedger,
  verifyOwnedContent,
  writeOwnershipLedger,
} from "../../core/surface/ownership-ledger.mjs";
import { canonicalRootForScope } from "../../core/surface/rulesync-canonical.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const VALID_COMMANDS = new Set(["check", "apply", "verify"]);
const VALID_SCOPES = new Set(["project", "global", "all"]);

export function parseArgs(argv) {
  const args = {
    command: argv[2] ?? "check",
    scope: "project",
    allowApply: false,
    force: false,
    json: false,
  };
  for (let index = 3; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--scope") {
      args.scope = argv[index + 1];
      index += 1;
    } else if (arg === "--apply") {
      args.allowApply = true;
    } else if (arg === "--force") {
      args.force = true;
    } else if (arg === "--json") {
      args.json = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!VALID_COMMANDS.has(args.command)) {
    throw new Error("usage: portawhip sync <check|apply|verify> [--scope project|global|all] [--apply] [--force] [--json]");
  }
  if (!VALID_SCOPES.has(args.scope)) throw new Error(`invalid scope \"${args.scope}\"`);
  if (args.command === "apply" && !args.allowApply) {
    throw new Error("apply requires an explicit --apply flag; run check first");
  }
  return args;
}

function localRulesync() {
  const cli = join(PACKAGE_ROOT, "node_modules", "rulesync", "dist", "cli", "index.js");
  if (existsSync(cli)) return { command: process.execPath, prefix: [cli] };
  return { command: "rulesync", prefix: [] };
}

function rulesyncArgs(mode, scope) {
  const args = ["--json", "generate"];
  if (mode === "check") args.push("--check");
  if (mode === "preview") args.push("--dry-run");
  if (scope === "global") args.push("-g");
  return args;
}

function parseRulesyncOutput(result) {
  try {
    return JSON.parse(String(result.stdout ?? "").trim());
  } catch {
    return null;
  }
}

function outputPaths(payload) {
  const features = payload?.data?.features ?? {};
  return [...new Set(Object.values(features).flatMap((feature) => feature?.paths ?? []))];
}

function totalOwnershipDirectories(payload) {
  const features = payload?.data?.features ?? {};
  const paths = [];
  for (const feature of ["skills", "commands", "subagents", "rules"]) {
    for (const rawPath of features[feature]?.paths ?? []) {
      const normalized = String(rawPath).replace(/\\/g, "/");
      const markers = feature === "skills" ? ["/skills/"] : feature === "rules" ? ["/rules/"] : [`/${feature}/`];
      for (const marker of markers) {
        const index = normalized.lastIndexOf(marker);
        if (index >= 0) paths.push(normalized.slice(0, index + marker.length - 1));
      }
    }
  }
  return [...new Set(paths)];
}

function targetPath(path, { root, scope, home = homedir() }) {
  if (isAbsolute(path)) return resolve(path);
  if (path.startsWith("~/") || path.startsWith("~\\")) return resolve(home, path.slice(2));
  return resolve(scope === "global" ? home : root, path);
}

function ledgerKey(path, { root, scope }) {
  return scope === "project" ? relative(root, path).replace(/\\/g, "/") : path.replace(/\\/g, "/");
}

function payloadFromGenerate(result) {
  const features = {};
  for (const feature of ["ignore", "mcp", "commands", "subagents", "skills", "hooks", "permissions", "rules"]) {
    features[feature] = {
      count: result[`${feature}Count`] ?? 0,
      paths: result[`${feature}Paths`] ?? [],
    };
  }
  return { success: true, data: { features, totalFiles: Object.values(features).reduce((sum, item) => sum + item.count, 0), hasDiff: result.hasDiff } };
}

async function runRulesync(mode, { root, scope, runner }) {
  const args = rulesyncArgs(mode, scope);
  if (runner) {
    const invocation = localRulesync();
    const invocationArgs = [...invocation.prefix, ...args];
    const raw = runner(invocation.command, invocationArgs, { cwd: root });
    return { raw, payload: parseRulesyncOutput(raw), args: invocationArgs };
  }
  const canonicalRoot = canonicalRootForScope({ root, scope });
  try {
    const { generate } = await import("rulesync");
    const result = await generate({
      configPath: join(canonicalRoot, "rulesync.jsonc"),
      inputRoot: canonicalRoot,
      ...(scope === "project" ? { outputRoots: [root] } : {}),
      global: scope === "global",
      dryRun: mode === "preview",
      check: mode === "check",
      silent: true,
    });
    return { raw: { status: 0, stdout: "", stderr: "" }, payload: payloadFromGenerate(result), args };
  } catch (error) {
    return { raw: { status: 1, stdout: "", stderr: error.message }, payload: { success: false, error: { message: error.message } }, args };
  }
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

function backupTargets(targets, { root, scope, now, ownedDirectories = [] }) {
  const backupDir = join(root, ".hp-state", "sync-backups", now());
  mkdirSync(backupDir, { recursive: true });
  const files = targets.map((path, index) => {
    const existed = existsSync(path);
    const backup = existed ? `${String(index).padStart(4, "0")}-${basename(path)}` : null;
    if (backup) copyFileSync(path, join(backupDir, backup));
    return { path, key: ledgerKey(path, { root, scope }), existed, backup };
  });
  const directories = ownedDirectories.map((path, index) => {
    const existed = existsSync(path);
    const backup = existed ? `directory-${String(index).padStart(4, "0")}` : null;
    if (backup) cpSync(path, join(backupDir, backup), { recursive: true });
    return { path, existed, backup };
  });
  atomicJson(join(backupDir, "manifest.json"), { version: 1, scope, files, directories });
  return { backupDir, files, directories };
}

function restoreBackup(backupDir, files, directories = []) {
  for (const directory of directories) {
    rmSync(directory.path, { recursive: true, force: true });
    if (directory.existed) cpSync(join(backupDir, directory.backup), directory.path, { recursive: true });
  }
  for (const file of files) {
    if (file.existed) {
      mkdirSync(dirname(file.path), { recursive: true });
      copyFileSync(join(backupDir, file.backup), file.path);
    } else {
      rmSync(file.path, { force: true });
    }
  }
}

function ownershipDrift(targets, { root, scope }) {
  const ledgerPath = join(root, ".hp-state", "ownership-ledger.json");
  const ledger = readOwnershipLedger(ledgerPath);
  return targets.flatMap((path) => {
    if (!existsSync(path)) return [];
    const key = ledgerKey(path, { root, scope });
    if (!ledger.paths?.[key]) return [];
    const check = verifyOwnedContent(ledger, { path: key, writer: "rulesync", content: readFileSync(path) });
    return check.status === "clean" ? [] : [check];
  });
}

function ledgerTargets({ root, scope }) {
  const ledger = readOwnershipLedger(join(root, ".hp-state", "ownership-ledger.json"));
  return Object.entries(ledger.paths ?? {}).flatMap(([key, claim]) => {
    if (claim.writer !== "rulesync") return [];
    if (scope === "project" && (claim.scope === "global" || isAbsolute(key))) return [];
    if (scope === "global" && claim.scope !== "global" && !isAbsolute(key)) return [];
    return [isAbsolute(key) ? resolve(key) : resolve(root, key)];
  });
}

function recordOwnership(targets, { root, scope }) {
  const ledgerPath = join(root, ".hp-state", "ownership-ledger.json");
  let ledger = readOwnershipLedger(ledgerPath);
  for (const path of targets) {
    if (!existsSync(path)) continue;
    ledger = claimOwnership(ledger, {
      path: ledgerKey(path, { root, scope }),
      writer: "rulesync",
      content: readFileSync(path),
      scope,
    });
  }
  writeOwnershipLedger(ledgerPath, ledger);
  return ledgerPath;
}

async function runOne({ command, scope, root, allowApply, force, runner, now }) {
  if (command === "check" || command === "verify") {
    const checked = await runRulesync(command === "check" ? "preview" : "check", { root, scope, runner });
    const targets = [...new Set([
      ...outputPaths(checked.payload).map((path) => targetPath(path, { root, scope })),
      ...ledgerTargets({ root, scope }),
    ])];
    const drift = ownershipDrift(targets, { root, scope });
    const rulesyncClean = checked.raw.status === 0 && checked.payload?.data?.hasDiff !== true;
    return {
      command,
      scope,
      status: rulesyncClean && drift.length === 0 ? "success" : "drift",
      targets,
      drift,
      output: checked.payload,
    };
  }

  if (!allowApply) throw new Error("apply requires an explicit --apply flag; run check first");
  const preview = await runRulesync("preview", { root, scope, runner });
  if (preview.raw.status !== 0 || !preview.payload?.success) {
    return { command, scope, status: "error", stage: "preview", targets: [], output: preview.payload };
  }
  const targets = outputPaths(preview.payload).map((path) => targetPath(path, { root, scope }));
  const ownedDirectories = totalOwnershipDirectories(preview.payload).map((path) => targetPath(path, { root, scope }));
  const drift = ownershipDrift(targets, { root, scope });
  if (drift.length > 0 && !force) {
    return { command, scope, status: "blocked", stage: "ownership", targets, drift };
  }
  const backup = backupTargets(targets, { root, scope, now, ownedDirectories });
  const applied = await runRulesync("apply", { root, scope, runner });
  if (applied.raw.status !== 0 || !applied.payload?.success) {
    restoreBackup(backup.backupDir, backup.files, backup.directories);
    return { command, scope, status: "rolled-back", stage: "apply", targets, backupDir: backup.backupDir };
  }
  const verified = await runRulesync("check", { root, scope, runner });
  const clean = verified.raw.status === 0 && verified.payload?.data?.hasDiff !== true;
  if (!clean) {
    restoreBackup(backup.backupDir, backup.files, backup.directories);
    return { command, scope, status: "rolled-back", stage: "verify", targets, backupDir: backup.backupDir };
  }
  const ledgerPath = recordOwnership(targets, { root, scope });
  return { command, scope, status: "success", targets, backupDir: backup.backupDir, ledgerPath };
}

export async function runReconcile({
  command = "check",
  scope = "project",
  root = resolve("."),
  allowApply = false,
  force = false,
  runner = null,
  now = () => new Date().toISOString().replace(/[-:.]/g, ""),
} = {}) {
  const absoluteRoot = resolve(root);
  if (scope === "all") {
    const results = [];
    for (const itemScope of ["project", "global"]) {
      results.push(await runOne({ command, scope: itemScope, root: absoluteRoot, allowApply, force, runner, now }));
    }
    return {
      command,
      scope,
      status: results.every((result) => result.status === "success") ? "success" : "attention",
      results,
    };
  }
  return runOne({ command, scope, root: absoluteRoot, allowApply, force, runner, now });
}

function printResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`sync ${result.command} (${result.scope}): ${result.status}`);
  const rows = result.results ?? [result];
  for (const row of rows) {
    console.log(`${row.scope}: ${row.status} (${row.targets?.length ?? 0} target(s))`);
    if (row.backupDir) console.log(`  backup: ${row.backupDir}`);
    for (const item of row.drift ?? []) console.log(`  drift: ${item.path} (${item.status})`);
  }
}

export async function runCli(argv = process.argv) {
  const args = parseArgs(argv);
  const result = runReconcile({ ...args, root: resolve(".") });
  const resolvedResult = await result;
  printResult(resolvedResult, args.json);
  process.exitCode = resolvedResult.status === "success" ? 0 : 1;
  return resolvedResult;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
