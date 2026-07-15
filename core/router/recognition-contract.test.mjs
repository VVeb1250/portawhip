import test from "node:test";
import assert from "node:assert/strict";

import { compactRouteResult } from "./route-entry.mjs";

test("recognition contract: multiple hits are declarative candidates with additive fresh state", () => {
  const compact = compactRouteResult({
    status: "success",
    decision: "route",
    results: [
      {
        id: "codegraph",
        type: "mcp",
        kind: "tool",
        tier: "recommended",
        action: "use_capability",
        how_to_use: "Trace callers over the indexed graph.",
        skipWhen: ["plain text search"],
        pointer: "codegraph",
      },
      {
        id: "ripgrep",
        type: "cli",
        kind: "tool",
        tier: "recommended",
        action: "use_capability",
        how_to_use: "Search text across files.",
        skipWhen: ["symbol call-path analysis"],
        pointer: "mise exec -- ripgrep",
      },
    ],
  });

  assert.equal(compact.mode, "candidates");
  assert.match(compact.note, /pick what fits/i);
  assert.ok(compact.results.every((item) => item.state === "fresh"));
  assert.equal(compact.results[0].skip_when, "plain text search");
  assert.equal(compact.results[0].kind, "tool");
  assert.equal(compact.results[0].type, "mcp");
  assert.ok(!("reason" in compact));
});

test("recognition contract: one fresh hit keeps the compact fast path", () => {
  const compact = compactRouteResult({
    status: "success",
    results: [
      {
        id: "codegraph",
        type: "mcp",
        kind: "tool",
        tier: "recommended",
        action: "use_capability",
        how_to_use: "Trace callers over the indexed graph.",
        skipWhen: ["plain text search", "non-code documents"],
        pointer: "codegraph",
      },
    ],
  });

  assert.equal(compact.results[0].state, "fresh");
  assert.equal(compact.results[0].skip_when, "plain text search; non-code documents");
  assert.ok(!("mode" in compact));
});
