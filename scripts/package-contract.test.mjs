import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("npm package exposes one public entry point and no capability bins", () => {
  assert.equal(packageJson.private, false);
  assert.equal(packageJson.publishConfig?.access, "public");
  assert.equal(packageJson.bin?.portawhip, "scripts/portawhip.mjs");
  // Routing ships as portawhip-router and brings its own bins. A stale bin
  // here would resolve to a path that no longer exists.
  assert.deepEqual(Object.keys(packageJson.bin), ["portawhip"]);
});

test("npm package declares a supported runtime and a release-safe file allowlist", () => {
  assert.match(packageJson.engines?.node ?? "", />=20/);
  assert.ok(packageJson.files?.includes("core/"));
  assert.ok(packageJson.files?.includes("scripts/"));
  // The MCP server ships under core/router/server/, so "core/" already covers
  // it; a stale "server/" entry here would be a silently dead allowlist line.
  assert.ok(!packageJson.files?.includes("server/"));
  assert.ok(packageJson.files?.includes("recipe.yaml"));
  assert.ok(!packageJson.files?.some((entry) => entry.startsWith(".hp-state")));
});

test("test script uses Node's cross-platform recursive discovery", () => {
  assert.equal(packageJson.scripts?.test, "node --test");
});

test("public scripts expose one guarded config writer", () => {
  assert.equal(packageJson.scripts?.["connectors:link"], undefined);
  assert.equal(packageJson.scripts?.["hooks:link"], undefined);
  assert.match(packageJson.scripts?.["sync:check"] ?? "", /reconcile\.mjs check/);
  assert.match(packageJson.scripts?.["sync:verify"] ?? "", /reconcile\.mjs verify/);
});
