import test from "node:test";
import assert from "node:assert/strict";

import { compactRouteResult } from "./route-entry.mjs";
import { createSessionLedger } from "./session-ledger.mjs";
import { assertRouteContract, RouteResultSchema } from "./route-contract.mjs";

// Shaped like a real scorer/hybrid-router hit, internal fields included: the
// contract's job is proving compactHit STRIPS score/confidence/why/origin, which
// a slimmed-down fixture would have nothing to strip (caught by mutating
// compactHit to leak `score` — only the live server test failed).
function hit(overrides = {}) {
  return {
    id: "codegraph",
    type: "mcp",
    kind: "tool",
    score: 420,
    tier: "recommended",
    confidence: 1,
    why: "matched 3 route triggers",
    action: "use_capability",
    how_to_use: "Trace callers over the indexed graph.",
    skipWhen: ["plain text search"],
    pointer: "codegraph",
    origin: "auto:mcp",
    ...overrides,
  };
}

test("route contract: every shape compactRouteResult produces satisfies the published schema", () => {
  const empty = compactRouteResult({ status: "empty", results: [], reason: "below threshold" });
  assertRouteContract(empty);

  const single = compactRouteResult({ status: "success", results: [hit()] });
  assertRouteContract(single);
  assert.ok(!("mode" in single));

  const candidates = compactRouteResult({
    status: "success",
    results: [hit(), hit({ id: "ripgrep", type: "cli", pointer: "mise exec -- ripgrep" })],
  });
  assertRouteContract(candidates);
  assert.equal(candidates.mode, "candidates");
});

test("route contract: a ledger reuse emission stays inside the three-key budget", () => {
  const ledger = createSessionLedger();
  compactRouteResult({ status: "success", results: [hit()] }, { ledger });
  const second = compactRouteResult({ status: "success", results: [hit()] }, { ledger });

  assertRouteContract(second);
  assert.deepEqual(Object.keys(second.results[0]).sort(), ["id", "note", "state"]);
});

test("route contract: a fully muted session still emits a valid empty payload", () => {
  const ledger = createSessionLedger();
  for (let i = 0; i < 2; i += 1) compactRouteResult({ status: "success", results: [hit()] }, { ledger });
  const muted = compactRouteResult({ status: "success", results: [hit()] }, { ledger });

  assertRouteContract(muted);
  assert.equal(muted.status, "empty");
});

// A valid already-compacted fresh hit: exactly the fields the contract allows.
function compactedHit(overrides = {}) {
  return {
    id: "codegraph",
    type: "mcp",
    kind: "tool",
    state: "fresh",
    tier: "recommended",
    action: "use_capability",
    how_to_use: "Trace callers over the indexed graph.",
    pointer: "codegraph",
    skip_when: "plain text search",
    ...overrides,
  };
}

test("route contract: compactRouteResult strips the internal scoring fields a real hit carries", () => {
  const single = compactRouteResult({ status: "success", results: [hit()] });

  assertRouteContract(single);
  for (const internal of ["score", "confidence", "why", "origin"]) {
    assert.ok(!(internal in single.results[0]), `${internal} must not reach a published payload`);
  }
});

test("route contract: internal scoring fields cannot leak into a published payload", () => {
  for (const leak of [{ score: 4 }, { confidence: 0.9 }, { why: "matched 4 triggers" }, { origin: "recipe" }]) {
    const payload = { status: "success", results: [{ ...compactedHit(), ...leak }] };
    assert.throws(() => assertRouteContract(payload), /violates the published contract/, Object.keys(leak)[0]);
  }
});

test("route contract: a reuse nudge may not carry a full payload", () => {
  assert.throws(
    () =>
      assertRouteContract({
        status: "success",
        mode: "candidates",
        note: "candidates - pick what fits, ignoring all is fine",
        results: [{ id: "codegraph", state: "reuse", note: "already available - reuse it", how_to_use: "Trace callers." }],
      }),
    /violates the published contract/,
  );
});

test("route contract: weak matches and half-declared candidate sets are rejected", () => {
  const weak = { status: "success", results: [compactedHit({ tier: "weak_match" })] };
  assert.throws(() => assertRouteContract(weak), /violates the published contract/);

  const modeWithoutNote = { status: "success", mode: "candidates", results: [compactedHit()] };
  assert.equal(RouteResultSchema.safeParse(modeWithoutNote).success, false);
});
