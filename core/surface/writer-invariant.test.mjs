import assert from "node:assert/strict";
import test from "node:test";

import { steadyStateWriterInvariant } from "./writer-invariant.mjs";

test("writer invariant accepts Rulesync as the sole fan-out writer", () => {
  const result = steadyStateWriterInvariant({
    rulesync: { steadyStateWriter: true },
    migration: { steadyStateWriter: false },
  });
  assert.deepEqual(result.writers, ["rulesync"]);
  assert.equal(result.ok, true);
});

test("writer invariant rejects zero or multiple fan-out writers", () => {
  assert.equal(steadyStateWriterInvariant({ migration: { steadyStateWriter: false } }).ok, false);
  assert.equal(
    steadyStateWriterInvariant({ rulesync: { steadyStateWriter: true }, legacy: { steadyStateWriter: true } }).ok,
    false,
  );
});
