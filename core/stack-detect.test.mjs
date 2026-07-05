import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectStack, stackFactors, combineFactors } from "./stack-detect.mjs";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "stack-detect-test-"));
}

test("detectStack: empty dir detects nothing", () => {
  const dir = tempDir();
  try {
    assert.deepEqual(detectStack(dir), new Set());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("detectStack: requirements.txt marks python", () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, "requirements.txt"), "pytest\n");
    assert.ok(detectStack(dir).has("python"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stackFactors: empty cwd returns no factors (no demotion on unknown project)", () => {
  const dir = tempDir();
  try {
    const index = { entries: [{ id: "cpp-testing" }, { id: "python-testing" }] };
    const factors = stackFactors(index, dir);
    assert.equal(factors.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stackFactors: python project demotes cpp-testing, boosts python-testing, leaves generic docs alone", () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, "requirements.txt"), "pytest\n");
    const index = {
      entries: [{ id: "cpp-testing" }, { id: "python-testing" }, { id: "code-review" }],
    };
    const factors = stackFactors(index, dir);
    assert.equal(factors.get("cpp-testing"), 0.4);
    assert.equal(factors.get("python-testing"), 1.3);
    assert.equal(factors.has("code-review"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("combineFactors: multiplies overlapping ids, keeps non-overlapping ones", () => {
  const a = new Map([["x", 2.0], ["y", 0.5]]);
  const b = new Map([["x", 1.3]]);
  const combined = combineFactors(a, b);
  assert.equal(combined.get("x"), 2.6);
  assert.equal(combined.get("y"), 0.5);
});
