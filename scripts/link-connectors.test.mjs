import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
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
