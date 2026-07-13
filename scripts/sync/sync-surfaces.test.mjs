import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import assert from "node:assert/strict";
import { installableEntries, parseArgs, syncSurfaces } from "./sync-surfaces.mjs";

test("sync-surfaces: exposes manual sync/check only (no watchdog command)", () => {
  assert.equal(parseArgs(["node", "sync-surfaces.mjs"]).command, "sync");
  assert.equal(parseArgs(["node", "sync-surfaces.mjs", "check", "--json"]).json, true);
  assert.throws(() => parseArgs(["node", "sync-surfaces.mjs", "watch"]), /usage/);
  assert.throws(() => parseArgs(["node", "sync-surfaces.mjs", "wat"]), /usage/);
  assert.throws(() => parseArgs(["node", "sync-surfaces.mjs", "sync", "--scope", "all"]), /invalid scope/);
});

test("sync-surfaces: only CLI entries bypass rulesync", () => {
  const entries = [
    { id: "docs", type: "mcp" },
    { id: "rg", type: "cli" },
    { id: "pdf", type: "skill" },
    { id: "route-only", type: "skill", install: false },
    { id: "sync", type: "config-sync" },
  ];
  assert.deepEqual(
    installableEntries(entries).map((entry) => entry.id),
    ["rg"],
  );
});

test("sync-surfaces: check delegates fan-out to the guarded reconciler and leaves only CLI to mise", async () => {
  const root = mkdtempSync(join(tmpdir(), "surface-check-"));
  writeFileSync(
    join(root, "recipe.yaml"),
    [
      "- id: rg",
      "  type: cli",
      "  source: ripgrep",
      "- id: pdf",
      "  type: skill",
      "  source: pdf",
      "- id: docs",
      "  type: mcp",
      "  source: context7",
      "",
    ].join("\n"),
  );
  const calls = [];
  const result = await syncSurfaces({
    root,
    check: true,
    reconciler: async (options) => {
      calls.push(options);
      return { status: "success", targets: [] };
    },
  });
  assert.equal(result.lanes.length, 2);
  assert.equal(result.lanes[0].lane, "fan-out");
  assert.equal(result.lanes[0].backend, "rulesync via reconciler");
  assert.deepEqual(calls[0], { command: "check", scope: "project", root, allowApply: false });
  assert.equal(result.lanes[1].lane, "cli");
  assert.equal(result.lanes[1].action, "planned");
  assert.equal(result.lanes[1].count, 1);
});
