#!/usr/bin/env node
// Unified status across 3 backends — proves "load however, verify one way."
// No re-implemented health logic: each check just calls that backend's
// own list/audit command and reports pass/fail.

import spawnSync from "cross-spawn";

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

const checks = [checkMcp(), checkCli(), checkSkill()];
console.log("\n== doctor: unified status ==");
for (const c of checks) console.log(`${c.ok ? "OK  " : "FAIL"} ${c.label}`);
process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
