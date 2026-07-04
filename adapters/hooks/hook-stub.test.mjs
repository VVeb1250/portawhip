import { test } from "node:test";
import assert from "node:assert/strict";
import spawnSync from "cross-spawn";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const STUB = resolve("adapters", "hooks", "hook-stub.mjs");

test("hook-stub: missing target is a silent no-op, not an error (the whole point of the stub)", () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-stub-"));
  try {
    const missingTarget = join(dir, "does-not-exist.mjs");
    const result = spawnSync.sync(process.execPath, [STUB, "--target", missingTarget], { encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.equal(result.stderr.trim(), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hook-stub: existing target is imported and runs", () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-stub-"));
  try {
    const markerFile = join(dir, "ran.txt");
    const targetPath = join(dir, "target.mjs");
    writeFileSync(
      targetPath,
      `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(markerFile)}, "ran");\n`,
    );
    const result = spawnSync.sync(process.execPath, [STUB, "--target", targetPath], { encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.ok(existsSync(markerFile));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hook-stub: no --target arg is also a silent no-op", () => {
  const result = spawnSync.sync(process.execPath, [STUB], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.equal(result.stderr.trim(), "");
});
