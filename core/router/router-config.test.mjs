import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { projectConfigPath, userConfigPath } from "../state/config.mjs";
import { ROUTER_DEFAULTS, loadRouterRuntimeConfig } from "./router-config.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "portawhip-router-config-"));
  const home = join(root, "home");
  const project = join(root, "project");
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
  return { root, home, project };
}

test("router config layers package, user, and project values", () => {
  const { root, home, project } = fixture();
  try {
    const basePath = join(root, "router.config.yaml");
    writeFileSync(basePath, "k: 4\ndenseEnabled: true\ngraphPath: base-graph.json\n");

    const userPath = userConfigPath({ home, env: {}, platform: "linux" });
    mkdirSync(join(home, ".config", "portawhip"), { recursive: true });
    writeFileSync(userPath, "k: 6\ndenseEnabled: false\n");

    const projectPath = projectConfigPath(project);
    mkdirSync(join(project, ".portawhip"), { recursive: true });
    writeFileSync(projectPath, "k: 8\n");

    const config = loadRouterRuntimeConfig({ basePath, cwd: project, home, env: {}, platform: "linux" });

    assert.equal(config.k, 8);
    assert.equal(config.denseEnabled, false);
    // A relative path resolves against the file that set it, not the cwd.
    assert.equal(config.graphPath, resolve(root, "base-graph.json"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The router's normalize() is a hand-written allowlist, so a key added to
// ROUTER_DEFAULTS and to router.config.yaml but not to that list is dropped in
// silence: the packaged value looks present in both files and arrives at the
// router as undefined. That is how pullHybridThreshold shipped broken for one
// commit — unit tests passed because they hand the option in directly, and only
// an end-to-end read caught it. Guard every knob, not just the new one.
test("every packaged routing default survives the config allowlist", () => {
  const { root, home, project } = fixture();
  try {
    const basePath = join(root, "router.config.yaml");
    writeFileSync(basePath, "k: 4\n");
    const config = loadRouterRuntimeConfig({ basePath, cwd: project, home, env: {}, platform: "linux" });

    for (const key of Object.keys(ROUTER_DEFAULTS)) {
      assert.notEqual(config[key], undefined, `${key} is defaulted but never reaches a caller`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a pull threshold set in a config file reaches the router", () => {
  const { root, home, project } = fixture();
  try {
    const basePath = join(root, "router.config.yaml");
    writeFileSync(basePath, "pullHybridThreshold: 42\n");
    const config = loadRouterRuntimeConfig({ basePath, cwd: project, home, env: {}, platform: "linux" });
    assert.equal(config.pullHybridThreshold, 42);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("PORTAWHIP_CONFIG is the highest-priority explicit config", () => {
  const { root, home, project } = fixture();
  try {
    const explicitPath = join(root, "custom.yaml");
    writeFileSync(explicitPath, "k: 11\ngraphPath: custom-graph.json\n");

    const config = loadRouterRuntimeConfig({
      cwd: project,
      home,
      env: { PORTAWHIP_CONFIG: explicitPath },
      platform: "linux",
    });

    assert.equal(config.k, 11);
    assert.equal(config.graphPath, resolve(root, "custom-graph.json"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The router needs harness keys too — autoSync gates whether a routing run may
// kick off a background sync — so its runtime schema must carry both fragments.
test("router runtime config still carries the harness autoSync keys", () => {
  const { root, home, project } = fixture();
  try {
    const basePath = join(root, "router.config.yaml");
    writeFileSync(basePath, "autoSync:\n  enabled: true\n");
    const config = loadRouterRuntimeConfig({ basePath, cwd: project, home, env: {}, platform: "linux" });
    assert.equal(config.autoSync.enabled, true);
    assert.equal(config.engine, ROUTER_DEFAULTS.engine);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
