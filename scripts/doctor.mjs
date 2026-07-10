#!/usr/bin/env node
// Unified status across 3 backends — proves "load however, verify one way."
// No re-implemented health logic: each check just calls that backend's
// own list/audit command and reports pass/fail.

import spawnSync from "cross-spawn";
import { collectSurfaceMatrix } from "../core/surface-matrix.mjs";

function parseArgs(argv) {
  return { json: argv.includes("--json"), heavy: argv.includes("--heavy") };
}

function cellText(cell) {
  const count = cell.count != null ? `(${cell.count})` : "";
  return `${cell.status}${count}`;
}

function capture(cmd, args) {
  const result = spawnSync.sync(cmd, args, { encoding: "utf8" });
  return { ok: result.status === 0, output: (result.stdout || "") + (result.stderr || "") };
}

function checkMcp() {
  const r = capture("npx", ["--yes", "add-mcp", "list", "-g"]);
  const found = r.output.includes("context7");
  return { label: "context7 (mcp via add-mcp)", ok: r.ok && found };
}

function checkCli() {
  const r = capture("mise", ["ls", "ripgrep"]);
  const found = r.output.includes("ripgrep");
  return { label: "ripgrep (cli via mise)", ok: r.ok && found };
}

function checkSkill() {
  const r = capture("npx", ["--yes", "agent-skill-manager", "inspect", "pdf", "--json"]);
  return { label: "pdf (skill via asm)", ok: r.ok };
}

// Router/hooks/connectors added later than the 3 checks above (Step 1) —
// this file went stale until this pass. Same pattern: shell out to each
// piece's own authoritative command, don't re-implement its logic here.
function checkRouter() {
  const r = capture(process.execPath, ["core/router-cli.mjs", "list"]);
  let entries = [];
  try {
    entries = JSON.parse(r.output);
  } catch {
    entries = [];
  }
  return { label: "router registry (recipe + live discovery)", ok: r.ok && Array.isArray(entries) && entries.length > 0 };
}

// Both scopes, not just global — collapsing to one bool at global scope hid
// per-host detail that link-hooks.mjs/link-connectors.mjs status already
// print (path + linked/missing per host). Doctor's job is to surface that,
// not re-summarize it into a single OK/FAIL.
function checkHooks(scope) {
  const r = capture(process.execPath, ["scripts/link-hooks.mjs", "status", "--scope", scope]);
  return { label: `native hooks (link-hooks.mjs, ${scope} scope)`, ok: r.ok, detail: r.output.trim() };
}

function checkConnectors(scope) {
  const r = capture(process.execPath, ["scripts/link-connectors.mjs", "status", "--scope", scope]);
  return { label: `instruction connectors (link-connectors.mjs, ${scope} scope)`, ok: r.ok, detail: r.output.trim() };
}

const { json, heavy } = parseArgs(process.argv.slice(2));

const checks = [
  checkMcp(),
  checkCli(),
  checkSkill(),
  checkRouter(),
  checkHooks("project"),
  checkHooks("global"),
  checkConnectors("project"),
  checkConnectors("global"),
];

// Surface coverage matrix (Phase S0): live-probed read/write lane status per
// portable surface. Light by default so `doctor` stays fast; `--heavy` runs
// the full mcp/skill discovery counts.
const matrix = await collectSurfaceMatrix({ heavy });

if (json) {
  const ok = checks.every((c) => c.ok);
  console.log(JSON.stringify({ status: ok ? "ok" : "fail", checks, matrix }, null, 2));
  process.exitCode = ok ? 0 : 1;
  process.exit();
}

console.log("\n== doctor: unified status ==");
for (const c of checks) console.log(`${c.ok ? "OK  " : "FAIL"} ${c.label}`);

console.log("\n== per-host detail (source of truth for what's loaded where) ==");
for (const c of checks) {
  if (!c.detail) continue;
  console.log(`\n--- ${c.label} ---`);
  console.log(c.detail);
}

console.log("\n== surface coverage matrix (read=import, write=fan-out) ==");
for (const row of matrix.rows) {
  console.log(`${row.label.padEnd(34)} read: ${cellText(row.read).padEnd(20)} write: ${cellText(row.write)}`);
}
if (matrix.summary.attention.length) {
  console.log(`\nAttention (no lane / backend missing): ${matrix.summary.attention.join(", ")}`);
}

console.log(
  "\nNote: add-mcp / agent-skill-manager entries are managed by those tools, not by\n" +
    "this harness. `doctor` reports on them but `scripts/uninstall-all.mjs` cannot\n" +
    "remove them — use each tool's own uninstall if you want those gone too.",
);

process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
