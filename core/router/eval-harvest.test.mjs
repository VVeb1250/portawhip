import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logEvent } from "./feedback.mjs";
import { harvestHardNegatives } from "./eval-harvest.mjs";

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "eval-harvest-test-"));
}

test("harvestHardNegatives: below the ignored-count bar produces nothing", () => {
  const root = tempRoot();
  try {
    logEvent(root, { type: "suggested", id: "noisy-skill", prompt: "design the architecture for X" });
    const cases = harvestHardNegatives(root, { minIgnoredCount: 2 });
    assert.equal(cases.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("harvestHardNegatives: repeated ignore across different prompts for the same id crosses the bar", () => {
  const root = tempRoot();
  try {
    logEvent(root, { type: "suggested", id: "noisy-skill", prompt: "design the architecture for X" });
    logEvent(root, { type: "suggested", id: "noisy-skill", prompt: "how should a router avoid bloat" });
    const cases = harvestHardNegatives(root, { minIgnoredCount: 2 });
    assert.equal(cases.length, 2);
    assert.ok(cases.every((c) => c.shouldRoute === false));
    assert.ok(cases.every((c) => c.category === "auto-harvested"));
    assert.ok(cases.every((c) => c.id.startsWith("auto-noisy-skill-")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("harvestHardNegatives: a suggestion later confirmed used is not harvested", () => {
  const root = tempRoot();
  try {
    logEvent(root, { type: "suggested", id: "real-skill", prompt: "prompt one" });
    logEvent(root, { type: "used", id: "real-skill" });
    logEvent(root, { type: "suggested", id: "real-skill", prompt: "prompt two" });
    logEvent(root, { type: "used", id: "real-skill" });
    const cases = harvestHardNegatives(root, { minIgnoredCount: 2 });
    assert.equal(cases.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("harvestHardNegatives: duplicate prompt text for the same id is only harvested once", () => {
  const root = tempRoot();
  try {
    logEvent(root, { type: "suggested", id: "noisy-skill", prompt: "same prompt" });
    logEvent(root, { type: "suggested", id: "noisy-skill", prompt: "same prompt" });
    logEvent(root, { type: "suggested", id: "noisy-skill", prompt: "same prompt" });
    const cases = harvestHardNegatives(root, { minIgnoredCount: 2 });
    assert.equal(cases.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
