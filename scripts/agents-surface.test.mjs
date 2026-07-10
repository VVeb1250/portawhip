import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldSyncAfterAgents } from "./agents-surface.mjs";

test("agents-surface: auto-syncs after source-changing agents commands", () => {
  assert.equal(shouldSyncAfterAgents(["connect", "--llm", "codex"]), true);
  assert.equal(shouldSyncAfterAgents(["disconnect", "--llm", "codex"]), true);
  assert.equal(shouldSyncAfterAgents(["mcp", "add", "harness-router"]), true);
  assert.equal(shouldSyncAfterAgents(["mcp", "import", "--file", "servers.json"]), true);
  assert.equal(shouldSyncAfterAgents(["mcp", "remove", "harness-router"]), true);
});

test("agents-surface: read-only agents commands do not trigger full sync", () => {
  assert.equal(shouldSyncAfterAgents(["status", "--verbose"]), false);
  assert.equal(shouldSyncAfterAgents(["mcp", "list"]), false);
  assert.equal(shouldSyncAfterAgents(["mcp", "test", "harness-router"]), false);
  assert.equal(shouldSyncAfterAgents(["sync", "--check"]), false);
});
