#!/usr/bin/env node
// One command to fully retract the harness from every detected host and
// scope. Does not reimplement removal logic — shells out to link-hooks.mjs
// and link-connectors.mjs "remove" (marker-based, so only harness-owned
// entries are touched; the rest of each host's config is untouched) and
// then re-runs doctor to confirm nothing harness-owned is left.
//
// Does NOT touch add-mcp / agent-skill-manager state — those are separate
// tools with their own install/uninstall; see doctor.mjs's closing note.

import spawnSync from "cross-spawn";

function run(cmd, args) {
  const result = spawnSync.sync(process.execPath, [cmd, ...args], { encoding: "utf8" });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  return result.status === 0;
}

const scopes = ["project", "global"];
let ok = true;

for (const scope of scopes) {
  console.log(`\n== removing native hooks (${scope}) ==`);
  ok = run("scripts/link/link-hooks.mjs", ["remove", "--scope", scope]) && ok;
}

for (const scope of scopes) {
  console.log(`\n== removing instruction connectors (${scope}) ==`);
  ok = run("scripts/link/link-connectors.mjs", ["remove", "--scope", scope]) && ok;
}

console.log("\n== verifying via doctor ==");
run("scripts/doctor.mjs", []);

if (!ok) {
  console.error("\nuninstall-all: one or more remove steps exited non-zero — check output above.");
  process.exitCode = 1;
}
