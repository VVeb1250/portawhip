import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CONNECTOR_TARGETS, targetsForHost } from "./connector-targets.mjs";
import { HOOK_TARGETS, hookTargetForHost } from "./hook-targets.mjs";
import { blockForVariant, upsertBlock } from "../../adapters/instructions/generate.mjs";

// Harness wiring: every host target must be renderable and every logical hook
// event must map to a real host event. Driven by a fixture connector rather
// than the router's real one — this is the mechanism, and portawhip must not
// depend on a capability that may not be installed.
const FIXTURE_CONNECTOR = {
  id: "fixture-connector",
  summary: "Fixture connector for wiring tests",
  body: "new wording for the fixture connector.",
};

function tempRoot(prefix = "portawhip-connector-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("connectors: every instruction target has a renderable harness block", () => {
  for (const [hostId, config] of Object.entries(CONNECTOR_TARGETS)) {
    assert.ok(config.instructionTargets.length > 0, `${hostId} has no instruction targets`);
    for (const target of config.instructionTargets) {
      const block = blockForVariant(target.variant, FIXTURE_CONNECTOR);
      assert.match(block, /fixture-connector:start/);
          }
  }
});

test("connectors: relinking replaces an old route block and remains idempotent", () => {
  const root = tempRoot("harness-router-instruction-upgrade-");
  try {
    const path = join(root, "AGENTS.md");
    writeFileSync(
      path,
      "<!-- harness-router:start -->\nBefore starting, call route(task summary).\n<!-- harness-router:end -->\n",
    );
    assert.equal(upsertBlock(path, blockForVariant("generic", FIXTURE_CONNECTOR)), true);
    const upgraded = readFileSync(path, "utf8");
    assert.match(upgraded, /new wording/);
    assert.equal((upgraded.match(/fixture-connector:start/g) ?? []).length, 1);
    assert.equal(upsertBlock(path, blockForVariant("generic", FIXTURE_CONNECTOR)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("connectors: scope filter returns only requested targets", () => {
  assert.ok(targetsForHost("codex", { scope: "global" }).every((target) => target.scope === "global"));
  assert.ok(targetsForHost("codex", { scope: "project" }).every((target) => target.scope === "project"));
  assert.deepEqual(targetsForHost("claude-desktop", { scope: "project" }), []);
});

test("hooks: native targets map logical events to host events", () => {
  assert.equal(HOOK_TARGETS["claude-code"].events.user_prompt, "UserPromptSubmit");
  assert.equal(HOOK_TARGETS.codex.events.post_tool, "PostToolUse");
  assert.equal(HOOK_TARGETS["gemini-cli"].events.user_prompt, "BeforeAgent");
  assert.equal(HOOK_TARGETS["gemini-cli"].events.post_tool, "AfterTool");
  assert.equal(hookTargetForHost("cursor", { scope: "project" }), null);
});

test("hooks: scoped targets resolve project and global paths", () => {
  const project = hookTargetForHost("codex", { scope: "project" });
  const global = hookTargetForHost("codex", { scope: "global" });
  assert.match(project.path.replace(/\\/g, "/"), /\.codex\/hooks\.json$/);
  assert.match(global.path.replace(/\\/g, "/"), /\.codex\/hooks\.json$/);
  assert.notEqual(project.path, global.path);
});
