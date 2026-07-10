import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import assert from "node:assert/strict";
import { installableEntries, parseArgs, syncSurfaces } from "./sync-surfaces.mjs";

test("sync-surfaces: parses sync/check/watch commands", () => {
  assert.equal(parseArgs(["node", "sync-surfaces.mjs"]).command, "sync");
  assert.equal(parseArgs(["node", "sync-surfaces.mjs", "check", "--json"]).json, true);
  assert.equal(parseArgs(["node", "sync-surfaces.mjs", "watch", "--once", "--interval", "50"]).once, true);
  assert.throws(() => parseArgs(["node", "sync-surfaces.mjs", "wat"]), /usage/);
  assert.throws(() => parseArgs(["node", "sync-surfaces.mjs", "sync", "--scope", "all"]), /invalid scope/);
});

test("sync-surfaces: only CLI and skill entries are installable", () => {
  const entries = [
    { id: "docs", type: "mcp" },
    { id: "rg", type: "cli" },
    { id: "pdf", type: "skill" },
    { id: "route-only", type: "skill", install: false },
    { id: "sync", type: "config-sync" },
  ];
  assert.deepEqual(
    installableEntries(entries).map((entry) => entry.id),
    ["rg", "pdf"],
  );
});

test("sync-surfaces: check runs agents sync --check and does not install CLI/skills", async () => {
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
    runner: (cmd, args) => {
      calls.push([cmd, args]);
      return true;
    },
  });
  assert.equal(result.lanes.length, 2);
  assert.equal(result.lanes[0].lane, "mcp");
  assert.deepEqual(calls[0][1], ["sync", "--verbose", "--check"]);
  assert.equal(result.lanes[1].lane, "cli+skills");
  assert.equal(result.lanes[1].action, "planned");
  assert.equal(result.lanes[1].count, 2);
});
