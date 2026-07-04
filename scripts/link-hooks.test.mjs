import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installJsonHooks, removeJsonHooks, statusJsonHooks } from "./link-hooks.mjs";

function fakeTarget(path, overrides = {}) {
  return {
    path,
    events: { user_prompt: "UserPromptSubmit", post_tool: "PostToolUse" },
    format: "claude-code",
    ...overrides,
  };
}

test("link-hooks: install writes a hook containing the universal-hook marker", () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-hooks-"));
  const path = join(dir, "settings.json");
  try {
    const target = fakeTarget(path);
    const changed = installJsonHooks("test-host", target);
    assert.equal(changed, true);
    const config = JSON.parse(readFileSync(path, "utf8"));
    assert.ok(config.hooks.UserPromptSubmit[0].hooks[0].command.includes("universal-hook.mjs"));
    assert.ok(config.hooks.PostToolUse[0].hooks[0].command.includes("universal-hook.mjs"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("link-hooks: install is idempotent (second run is a no-op)", () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-hooks-"));
  const path = join(dir, "settings.json");
  try {
    const target = fakeTarget(path);
    installJsonHooks("test-host", target);
    const before = readFileSync(path, "utf8");
    const changedAgain = installJsonHooks("test-host", target);
    assert.equal(changedAgain, false);
    assert.equal(readFileSync(path, "utf8"), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("link-hooks: status reflects install/remove transitions", () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-hooks-"));
  const path = join(dir, "settings.json");
  try {
    const target = fakeTarget(path);
    assert.equal(statusJsonHooks(target).linked, false);
    installJsonHooks("test-host", target);
    assert.equal(statusJsonHooks(target).linked, true);
    removeJsonHooks(target);
    assert.equal(statusJsonHooks(target).linked, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("link-hooks: remove only strips our hook, leaves unrelated hooks in the same event untouched", () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-hooks-"));
  const path = join(dir, "settings.json");
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [{ hooks: [{ type: "command", command: "some-other-hook.mjs" }] }],
        },
      }),
    );
    const target = fakeTarget(path);
    installJsonHooks("test-host", target);
    removeJsonHooks(target);
    const config = JSON.parse(readFileSync(path, "utf8"));
    const commands = config.hooks.UserPromptSubmit.flatMap((g) => g.hooks.map((h) => h.command));
    assert.deepEqual(commands, ["some-other-hook.mjs"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
