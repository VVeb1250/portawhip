import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logEvent, readEvents, computeFactors } from "./feedback.mjs";

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "harness-feedback-"));
}

test("feedback: no events -> neutral factor", () => {
  const root = tempRoot();
  try {
    const factors = computeFactors(root);
    assert.equal(factors.size, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("feedback: a single used suggestion boosts above 1.0", () => {
  const root = tempRoot();
  try {
    logEvent(root, { type: "suggested", id: "ripgrep" });
    logEvent(root, { type: "used", id: "ripgrep", tool: "Bash" });
    const factors = computeFactors(root);
    assert.equal(factors.get("ripgrep"), 1.2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("feedback: repeated ignores decay toward the 0.5 floor, never below it", () => {
  const root = tempRoot();
  try {
    for (let i = 0; i < 10; i += 1) logEvent(root, { type: "suggested", id: "ripgrep" });
    const factors = computeFactors(root);
    assert.equal(factors.get("ripgrep"), 0.5);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("feedback: repeated uses cap at the 2.0 ceiling, never above it", () => {
  const root = tempRoot();
  try {
    for (let i = 0; i < 10; i += 1) {
      logEvent(root, { type: "suggested", id: "ripgrep" });
      logEvent(root, { type: "used", id: "ripgrep", tool: "Bash" });
    }
    const factors = computeFactors(root);
    assert.equal(factors.get("ripgrep"), 2.0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("feedback: unrelated capability ids don't affect each other's factor", () => {
  const root = tempRoot();
  try {
    for (let i = 0; i < 6; i += 1) logEvent(root, { type: "suggested", id: "pdf" }); // ignored
    logEvent(root, { type: "suggested", id: "context7" });
    logEvent(root, { type: "used", id: "context7", tool: "mcp__context7__resolve-library-id" });
    const factors = computeFactors(root);
    assert.ok(factors.get("pdf") < 1.0);
    assert.ok(factors.get("context7") > 1.0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("feedback: readEvents reflects logged events in order", () => {
  const root = tempRoot();
  try {
    logEvent(root, { type: "suggested", id: "a" });
    logEvent(root, { type: "used", id: "a" });
    const events = readEvents(root);
    assert.equal(events.length, 2);
    assert.equal(events[0].type, "suggested");
    assert.equal(events[1].type, "used");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("feedback: log file is pruned once it crosses the size threshold", () => {
  const root = tempRoot();
  const TOTAL = 12000;
  try {
    // Force many small events so the file crosses the prune-check size
    // (~512KB) at least once — pruning is a size-triggered, approximate
    // cap (checked on append, not re-checked until the next 512KB of
    // growth), not an exact "never more than 5000 lines" guarantee.
    for (let i = 0; i < TOTAL; i += 1) logEvent(root, { type: "suggested", id: `cap-${i % 5}` });
    const events = readEvents(root);
    assert.ok(events.length < TOTAL, `expected pruning to have happened, got ${events.length} of ${TOTAL}`);
    assert.ok(events.length > 0);
    // Most recent event must survive the prune.
    assert.equal(events[events.length - 1].id, `cap-${(TOTAL - 1) % 5}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("feedback: suggestions fired on synthetic prompts are ignored, not counted as decay", () => {
  const root = tempRoot();
  try {
    // 21/26 historical suggested events were harness task-notifications
    // (2026-07-09 audit) - each would count as an "ignored" outcome and
    // decay the capability on pure noise. The read-side filter must skip
    // them without touching the append-only log.
    for (let i = 0; i < 5; i += 1) {
      logEvent(root, {
        type: "suggested",
        id: "ripgrep",
        prompt: "<task-notification>\n<task-id>x</task-id>\n<summary>done</summary>\n</task-notification>",
      });
    }
    // One genuine suggested->used pair: the only signal that should count.
    logEvent(root, { type: "suggested", id: "ripgrep", prompt: "search codebase for foo" });
    logEvent(root, { type: "used", id: "ripgrep", tool: "Bash" });
    const factors = computeFactors(root);
    assert.equal(factors.get("ripgrep"), 1.2); // single-hit boost, no noise decay mixed in
    assert.equal(readEvents(root).length, 7); // log itself untouched
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("feedback: pull-suggested then used earns boost (asymmetric credit, hit side)", () => {
  const root = tempRoot();
  try {
    logEvent(root, { type: "suggested", id: "exa", source: "pull", query: "web search" });
    logEvent(root, { type: "used", id: "exa", tool: "mcp__exa__web_search_exa" });
    const factors = computeFactors(root);
    assert.equal(factors.get("exa"), 1.2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("feedback: pull-suggested but never used stays neutral, no decay", () => {
  const root = tempRoot();
  try {
    // Pull is recall-generous: unused pull results are normal operation.
    for (let i = 0; i < 10; i += 1) {
      logEvent(root, { type: "suggested", id: "exa", source: "pull", query: "web search" });
    }
    const factors = computeFactors(root);
    assert.equal(factors.get("exa"), 1.0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("feedback: push-suggested and ignored still decays (existing behavior preserved)", () => {
  const root = tempRoot();
  try {
    logEvent(root, { type: "suggested", id: "ripgrep", prompt: "search codebase for foo" });
    logEvent(root, { type: "suggested", id: "ripgrep", prompt: "search codebase again" });
    const factors = computeFactors(root);
    assert.ok(factors.get("ripgrep") < 1.0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("feedback: mixed pull-ignored between push events doesn't break push decay", () => {
  const root = tempRoot();
  try {
    // push ignored -> pull ignored (no outcome) -> push ignored: streak of 2 ignores.
    logEvent(root, { type: "suggested", id: "x", prompt: "real prompt one here" });
    logEvent(root, { type: "suggested", id: "x", source: "pull", query: "lookup" });
    logEvent(root, { type: "suggested", id: "x", prompt: "real prompt two here" });
    const factors = computeFactors(root);
    assert.equal(factors.get("x"), Math.max(0.5, 1 - 0.15 * 2));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
