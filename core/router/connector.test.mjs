import { test } from "node:test";
import assert from "node:assert/strict";

import { ROUTER_CONNECTOR } from "./connector.mjs";

// The wording is load-bearing, not decoration. Each of these assertions maps to
// a live finding: the generic block had to name route() explicitly to get
// called at all, and it had to ask for a distilled action rather than the raw
// prompt because routing the raw prompt was 81% noise. The mechanism that
// writes these blocks is tested in core/surface/connector-wiring.test.mjs.
for (const [name, body] of [
  ["generic", ROUTER_CONNECTOR.body],
  ["claude-code", ROUTER_CONNECTOR.bodyFor("claude-code")],
]) {
  test(`router connector (${name}): asks for a reasoned action summary, not the raw prompt`, () => {
    assert.match(body, /route\(task summary\)/);
    assert.match(body, /requested action/i);
    assert.match(body, /not copy the raw prompt/i);
    assert.match(body, /empty result/i, "an abstain must be described as normal, or it reads as a failure");
  });
}

test("router connector: only the claude-code variant mentions ToolSearch", () => {
  // Claude Code defers MCP tool schemas until looked up by name; every other
  // host would be confused by an instruction naming a tool it does not have.
  assert.match(ROUTER_CONNECTOR.bodyFor("claude-code"), /ToolSearch/);
  assert.doesNotMatch(ROUTER_CONNECTOR.body, /ToolSearch/);
  assert.doesNotMatch(ROUTER_CONNECTOR.bodyFor("codex"), /ToolSearch/);
});

test("router connector: declares the id and summary the writer needs", () => {
  assert.equal(ROUTER_CONNECTOR.id, "harness-router");
  assert.ok(ROUTER_CONNECTOR.summary.length > 10);
});
