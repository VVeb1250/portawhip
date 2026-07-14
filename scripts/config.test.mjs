import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as yaml from "js-yaml";

import { runConfigCommand } from "./config.mjs";

test("config command sets, reads, and unsets validated user values", () => {
  const root = mkdtempSync(join(tmpdir(), "portawhip-config-cli-"));
  const home = join(root, "home");
  const cwd = join(root, "project");
  const context = { home, cwd, env: {}, platform: "linux" };
  try {
    const setResult = runConfigCommand(["set", "denseEnabled", "false"], context);
    assert.equal(setResult.value, false);
    assert.match(setResult.path.replace(/\\/g, "/"), /\.config\/portawhip\/config\.yaml$/);
    assert.equal(yaml.load(readFileSync(setResult.path, "utf8")).denseEnabled, false);

    const getResult = runConfigCommand(["get", "denseEnabled"], context);
    assert.equal(getResult.value, false);

    const unsetResult = runConfigCommand(["unset", "denseEnabled"], context);
    assert.equal(unsetResult.removed, true);
    assert.equal(runConfigCommand(["get", "denseEnabled"], context).value, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("config command supports nested project settings", () => {
  const root = mkdtempSync(join(tmpdir(), "portawhip-config-project-"));
  const context = { home: join(root, "home"), cwd: join(root, "project"), env: {}, platform: "linux" };
  try {
    const result = runConfigCommand(
      ["set", "autoSync.throttleMinutes", "15", "--scope", "project"],
      context,
    );
    assert.equal(result.value, 15);
    assert.match(result.path.replace(/\\/g, "/"), /project\/\.portawhip\/config\.yaml$/);
    assert.deepEqual(yaml.load(readFileSync(result.path, "utf8")), {
      autoSync: { throttleMinutes: 15 },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("config command rejects unknown keys and invalid values", () => {
  const context = { home: "/tmp/home", cwd: "/tmp/project", env: {}, platform: "linux" };
  assert.throws(() => runConfigCommand(["set", "unknown", "x"], context), /unknown config key/i);
  assert.throws(() => runConfigCommand(["set", "k", "zero"], context), /must be a number/i);
  assert.throws(() => runConfigCommand(["set", "denseThreshold", "2"], context), /between 0 and 1/i);
});
