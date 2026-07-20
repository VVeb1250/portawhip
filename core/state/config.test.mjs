import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  HARNESS_SCHEMA,
  loadRuntimeConfig,
  projectConfigPath,
  resolveSchema,
  userConfigPath,
} from "./config.mjs";
import { FIXTURE_ENV } from "../fixtures/provider-env.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "portawhip-config-"));
  const home = join(root, "home");
  const project = join(root, "project");
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
  return { root, home, project };
}

test("harness config layers package, user, and project values", () => {
  const { root, home, project } = fixture();
  try {
    const basePath = join(root, "router.config.yaml");
    writeFileSync(basePath, "autoSync:\n  enabled: true\n  throttleMinutes: 90\n");

    const userPath = userConfigPath({ home, env: {}, platform: "linux" });
    mkdirSync(join(home, ".config", "portawhip"), { recursive: true });
    writeFileSync(userPath, "autoSync:\n  throttleMinutes: 30\n");

    const config = loadRuntimeConfig({ basePath, cwd: project, home, env: {}, platform: "linux" });

    // A nested mapping declared in mergeKeys stacks key-by-key: the user file
    // overrides throttleMinutes without discarding the packaged enabled flag.
    assert.equal(config.autoSync.throttleMinutes, 30);
    assert.equal(config.autoSync.enabled, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("harness config on its own knows nothing about router keys", () => {
  const { root, home, project } = fixture();
  try {
    const basePath = join(root, "router.config.yaml");
    writeFileSync(basePath, "k: 4\ndenseEnabled: false\n");
    const config = loadRuntimeConfig({ basePath, cwd: project, home, env: {}, platform: "linux" });
    assert.equal(config.k, undefined);
    assert.equal(config.denseEnabled, undefined);
    assert.deepEqual(Object.keys(HARNESS_SCHEMA.definitions), [
      "autoSync.enabled",
      "autoSync.throttleMinutes",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The whole point of the provider seam: the key space grows when a capability
// is installed and shrinks when it is not. Driven by the fixture provider, so
// this asserts the mechanism rather than any particular capability's keys.
test("resolveSchema grows the key space when a provider is installed", async () => {
  const bare = await resolveSchema({ env: {} });
  assert.ok(bare.definitions["autoSync.enabled"], "harness keys are always present");
  assert.equal(bare.definitions.fixtureEnabled, undefined, "no provider, no extra keys");

  const withFixture = await resolveSchema({ env: FIXTURE_ENV });
  assert.ok(withFixture.definitions["autoSync.enabled"]);
  assert.ok(withFixture.definitions.fixtureEnabled, "the provider did not contribute its keys");
  assert.ok(withFixture.definitions.fixtureBudget);
});

test("a schema refuses to let two fragments claim the same key", async () => {
  const { mergeSchemas } = await import("./config-schema.mjs");
  const clash = { id: "impostor", defaults: {}, definitions: { "autoSync.enabled": { type: "boolean" } }, normalize: () => ({}) };
  assert.throws(() => mergeSchemas(HARNESS_SCHEMA, clash), /claimed by both "harness" and "impostor"/);
});

test("user config path follows platform conventions", () => {
  assert.equal(
    userConfigPath({ home: "/home/test", env: { XDG_CONFIG_HOME: "/xdg" }, platform: "linux" }),
    resolve("/xdg", "portawhip", "config.yaml"),
  );
  assert.equal(
    userConfigPath({ home: "C:/Users/test", env: { APPDATA: "C:/Users/test/AppData/Roaming" }, platform: "win32" }),
    resolve("C:/Users/test/AppData/Roaming", "portawhip", "config.yaml"),
  );
});

test("project config path resolves under .portawhip", () => {
  assert.equal(projectConfigPath("/tmp/project"), resolve("/tmp/project", ".portawhip", "config.yaml"));
});
