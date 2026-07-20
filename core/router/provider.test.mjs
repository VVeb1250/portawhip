import test from "node:test";
import assert from "node:assert/strict";

import { actionDirective, configSchema, hooks } from "./provider.mjs";

test("the router provider exposes the seam portawhip looks for", () => {
  assert.equal(configSchema.id, "router");
  assert.equal(typeof hooks.onUserPrompt, "function");
  assert.equal(typeof hooks.onPostTool, "function");
});

// A prompt the router has no opinion about must produce null, not an empty
// string: the harness treats any truthy return as something worth injecting.
test("onUserPrompt returns null rather than an empty block on a short prompt", async () => {
  const result = await hooks.onUserPrompt({
    root: process.cwd(),
    host: "claude-code",
    cwd: process.cwd(),
    prompt: "hi",
    sessionId: null,
    configPath: "router.config.yaml",
    loadIndex: () => { throw new Error("index must not be built for a rejected prompt"); },
  });
  assert.equal(result, null);
});

test("onPostTool stays silent when nothing matched", async () => {
  assert.equal(await hooks.onPostTool({ root: process.cwd(), id: null }), null);
});

// One table for one pure function. The invariant across every row is the same:
// on claude-code the directive names that host's real invocation syntax, and on
// any other host it must fall back to the pointer rather than invent syntax that
// host does not have.
const SKILL = { kind: "skill", id: "workspace-surface-audit", pointer: "/some/path" };
const MCP = { kind: "tool", type: "mcp", id: "playwright", pointer: "@playwright/mcp@latest" };

for (const { name, hit, host, expect, reject } of [
  { name: "skill on claude-code names the Skill tool by id", hit: SKILL, host: "claude-code", expect: [/Skill tool/, /"workspace-surface-audit"/] },
  { name: "skill elsewhere falls back to reading the pointer", hit: SKILL, host: "gemini-cli", expect: [/\/some\/path/], reject: [/Skill tool/] },
  { name: "mcp on claude-code gives the mcp__<id>__ prefix and a ToolSearch fallback", hit: MCP, host: "claude-code", expect: [/mcp__playwright__/, /ToolSearch/] },
  { name: "mcp elsewhere stays generic, inventing no syntax", hit: MCP, host: "codex", reject: [/mcp__/] },
  { name: "agent on claude-code names the Agent tool by subagent_type", hit: { kind: "agent", id: "e2e-runner", pointer: "/agents/e2e-runner.md" }, host: "claude-code", expect: [/Agent tool/, /"e2e-runner"/] },
  { name: "cli surfaces the pointer as a runnable command", hit: { kind: "tool", type: "cli", id: "ripgrep", pointer: "mise exec -- ripgrep" }, host: "claude-code", expect: [/mise exec -- ripgrep/] },
]) {
  test(`actionDirective: ${name}`, () => {
    const directive = actionDirective(hit, host);
    for (const pattern of expect ?? []) assert.match(directive, pattern);
    for (const pattern of reject ?? []) assert.doesNotMatch(directive, pattern);
  });
}
