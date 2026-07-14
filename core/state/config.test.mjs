import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  loadRuntimeConfig,
  projectConfigPath,
  userConfigPath,
} from "./config.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "portawhip-config-"));
  const home = join(root, "home");
  const project = join(root, "project");
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
  return { root, home, project };
}

test("runtime config layers package, user, and project values", () => {
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

    const config = loadRuntimeConfig({ basePath, cwd: project, home, env: {}, platform: "linux" });

    assert.equal(config.k, 8);
    assert.equal(config.denseEnabled, false);
    assert.equal(config.graphPath, resolve(root, "base-graph.json"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("PORTAWHIP_CONFIG is the highest-priority explicit config", () => {
  const { root, home, project } = fixture();
  try {
    const explicitPath = join(root, "custom.yaml");
    writeFileSync(explicitPath, "k: 11\ngraphPath: custom-graph.json\n");

    const config = loadRuntimeConfig({
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
