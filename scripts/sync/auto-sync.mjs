#!/usr/bin/env node
// Auto-sync worker (Phase S1c, decision D — reconciled) — the background
// half of "import once, use everywhere".
//
// Split of responsibilities (locked with owner 2026-07-10):
//   IMPORT (discovered -> canonical) is MANUAL: the user runs
//     `npm run import` and chooses what to canonicalize (auto-enriched there).
//   FAN-OUT (canonical -> all hosts) is AUTO: this worker, fired
//     fire-and-forget from the session-start hook, keeps every host in sync
//     with whatever is already canonical (recipe.yaml + recipes/imported.yaml
//     + selected bundles).
//
// It deliberately does NOT discover-and-import new capabilities on its own —
// that is what made an earlier auto-import design pour hundreds of entries
// across every host unbidden. This worker only propagates deliberate,
// already-canonical entries, so there is no surprise fan-out.
//
// Throttled + locked + logged + fully fail-open. Silence (hosts already in
// sync) is the normal steady state.

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../../core/state/config.mjs";
import { runReconcile } from "./reconcile.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const STATE_DIR = join(ROOT, ".hp-state");
const STATE_PATH = join(STATE_DIR, "auto-sync.state.json");
const LOCK_PATH = join(STATE_DIR, "auto-sync.lock");
const LOG_PATH = join(STATE_DIR, "auto-sync.log");
const LOCK_STALE_MS = 15 * 60 * 1000; // a lock older than this is presumed dead

// Pure: has enough time passed since the last run? (throttle)
export function shouldRun(state, now, throttleMs) {
  if (!throttleMs || throttleMs <= 0) return true;
  const last = Number(state?.lastRunAt ?? 0);
  return now - last >= throttleMs;
}

// Pure: is an existing lock stale (safe to steal)?
export function lockIsStale(lockMtimeMs, now, staleMs = LOCK_STALE_MS) {
  return now - lockMtimeMs >= staleMs;
}

function readState() {
  if (!existsSync(STATE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeState(state) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

function log(line) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    appendFileSync(LOG_PATH, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // logging is best-effort; never throw out of the worker
  }
}

function acquireLock(now = Date.now()) {
  mkdirSync(STATE_DIR, { recursive: true });
  if (existsSync(LOCK_PATH)) {
    let mtime = 0;
    try {
      mtime = Number(readFileSync(LOCK_PATH, "utf8")) || 0;
    } catch {
      mtime = 0;
    }
    if (!lockIsStale(mtime, now)) return false;
  }
  writeFileSync(LOCK_PATH, String(now));
  return true;
}

function releaseLock() {
  try {
    rmSync(LOCK_PATH, { force: true });
  } catch {
    // ignore
  }
}

// Automation and manual sync share the exact same backup/verify/ledger path.
async function fanOut() {
  const result = await runReconcile({ command: "apply", scope: "project", root: ROOT, allowApply: true });
  return result.status === "success";
}

export async function runAutoSync({ now = Date.now(), config = null, fanOutImpl = fanOut } = {}) {
  const cfg = config ?? loadConfig(join(ROOT, "router.config.yaml"));
  const auto = cfg.autoSync ?? {};
  if (auto.enabled !== true) return { skipped: "disabled" };

  const throttleMs = (Number(auto.throttleMinutes ?? 60) || 0) * 60 * 1000;
  const state = readState();
  if (!shouldRun(state, now, throttleMs)) return { skipped: "throttled" };
  if (!acquireLock(now)) return { skipped: "locked" };

  try {
    const ok = await fanOutImpl();
    log(`fan-out ${ok ? "ok" : "FAILED"}`);
    writeState({ ...state, lastRunAt: now, lastResult: ok ? "synced" : "sync-failed" });
    return { synced: ok };
  } catch (error) {
    log(`ERROR ${error.message}`);
    return { error: error.message };
  } finally {
    releaseLock();
  }
}

async function main() {
  const result = await runAutoSync();
  console.log(`auto-sync: ${JSON.stringify(result)}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    log(`FATAL ${error.message}`);
  });
}
