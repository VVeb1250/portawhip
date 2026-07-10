import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldRun, lockIsStale, runAutoSync } from "./auto-sync.mjs";
import { loadConfig } from "../core/config.mjs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("shouldRun: throttles until enough time has passed", () => {
  const throttle = 60 * 60 * 1000;
  assert.equal(shouldRun({ lastRunAt: 1_000_000 }, 1_000_000 + throttle - 1, throttle), false);
  assert.equal(shouldRun({ lastRunAt: 1_000_000 }, 1_000_000 + throttle, throttle), true);
  assert.equal(shouldRun({}, Date.now(), throttle), true);
  assert.equal(shouldRun({ lastRunAt: Date.now() }, Date.now(), 0), true);
});

test("lockIsStale: only steals a lock older than the stale window", () => {
  const now = 10_000_000;
  const stale = 15 * 60 * 1000;
  assert.equal(lockIsStale(now - stale + 1, now, stale), false);
  assert.equal(lockIsStale(now - stale, now, stale), true);
});

test("runAutoSync: disabled config skips without touching fan-out", async () => {
  let called = false;
  const res = await runAutoSync({ config: { autoSync: { enabled: false } }, fanOutImpl: () => (called = true) });
  assert.deepEqual(res, { skipped: "disabled" });
  assert.equal(called, false);
});

// The enabled path acquires a real lock + writes real state under ROOT/
// .hp-state, so it is verified live (docs/phaseS1c-verify.md) rather than in
// a unit test that would pollute/contend on that shared state.

test("loadConfig: autoSync defaults on with a 60m throttle; overrides read", () => {
  assert.deepEqual(loadConfig("does-not-exist.yaml").autoSync, { enabled: true, throttleMinutes: 60 });
  const dir = mkdtempSync(join(tmpdir(), "autosync-cfg-"));
  const path = join(dir, "router.config.yaml");
  writeFileSync(path, "autoSync:\n  enabled: false\n  throttleMinutes: 5\n");
  assert.deepEqual(loadConfig(path).autoSync, { enabled: false, throttleMinutes: 5 });
});
