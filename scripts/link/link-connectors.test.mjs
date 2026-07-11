import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyTarget } from "./link-connectors.mjs";

test("link-connectors: install writes the harness-router marker block", () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-connectors-"));
  const path = join(dir, "AGENTS.md");
  try {
    const result = applyTarget("install", { path, variant: "generic" });
    assert.equal(result.changed, true);
    assert.equal(result.linked, true);
    const content = readFileSync(path, "utf8");
    assert.ok(content.includes("harness-router:start"));
    assert.ok(content.includes("route(task summary)"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("link-connectors: install is idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-connectors-"));
  const path = join(dir, "AGENTS.md");
  try {
    applyTarget("install", { path, variant: "generic" });
    const before = readFileSync(path, "utf8");
    const result = applyTarget("install", { path, variant: "generic" });
    assert.equal(result.changed, false);
    assert.equal(readFileSync(path, "utf8"), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("link-connectors: status reports linked/missing without mutating the file", () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-connectors-"));
  const path = join(dir, "AGENTS.md");
  try {
    assert.equal(applyTarget("status", { path, variant: "generic" }).linked, false);
    applyTarget("install", { path, variant: "generic" });
    assert.equal(applyTarget("status", { path, variant: "generic" }).linked, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("link-connectors: remove strips the block and preserves surrounding content", () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-connectors-"));
  const path = join(dir, "AGENTS.md");
  try {
    writeFileSync(path, "# My project\n\nSome existing notes.\n");
    applyTarget("install", { path, variant: "generic" });
    applyTarget("remove", { path, variant: "generic" });
    const content = readFileSync(path, "utf8");
    assert.ok(!content.includes("harness-router:start"));
    assert.ok(content.includes("Some existing notes."));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Owned dedicated rule files (cursor .mdc, windsurf .md) carry frontmatter
// BEFORE the marker block. Regression guard for the bug where marker-upsert
// duplicated that frontmatter on every re-run (see applyOwnedTarget).
test("link-connectors: owned cursor-rule install is idempotent (no duplicate frontmatter)", () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-connectors-"));
  const path = join(dir, "harness-router.mdc");
  try {
    const target = { path, variant: "cursor-rule", owned: true };
    assert.equal(applyTarget("install", target).changed, true);
    assert.equal(applyTarget("install", target).changed, false);
    applyTarget("install", target);
    const content = readFileSync(path, "utf8");
    assert.equal((content.match(/alwaysApply: true/g) || []).length, 1);
    assert.ok(content.includes("harness-router:start"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("link-connectors: owned remove deletes the file, leaving no orphan always-on rule", () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-connectors-"));
  const path = join(dir, "harness-router.mdc");
  try {
    const target = { path, variant: "cursor-rule", owned: true };
    applyTarget("install", target);
    assert.ok(existsSync(path));
    const result = applyTarget("remove", target);
    assert.equal(result.changed, true);
    assert.equal(existsSync(path), false);
    // remove on an already-absent owned file is a clean no-op
    assert.equal(applyTarget("remove", target).changed, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("link-connectors: owned windsurf-rule writes always_on frontmatter as the first bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-connectors-"));
  const path = join(dir, "harness-router.md");
  try {
    applyTarget("install", { path, variant: "windsurf-rule", owned: true });
    const content = readFileSync(path, "utf8");
    assert.ok(content.startsWith("---\ntrigger: always_on\n---"));
    assert.ok(content.includes("route(task summary)"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
