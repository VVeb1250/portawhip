// PLAN.md Phase 4 step 1/2: append-only usage log + bounded weight
// adjustment. Append-only JSONL, never rewritten in place — matches the
// "no daemon, cheap, live-probed" style already used elsewhere in this
// repo, and avoids concurrent-write corruption risk from two hook
// processes editing the same file.
//
// Simplification (documented, not hidden): correlation is per-capability-id
// across all events, not strictly scoped to one session — a "used" event
// for id X counts as a hit for whatever the most recent unresolved
// "suggested" event for X was, regardless of which session logged either
// one. Good enough for the boost/decay signal this phase asks for; revisit
// only if cross-session bleed is actually observed causing a wrong weight.

import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { isSyntheticPrompt } from "./prompt-hygiene.mjs";

// Unbounded append-only growth was a real gap (found during a project
// review, not a live incident): this log has no rotation, so heavy daily
// use would grow it forever and slow computeFactors()'s full-file scan.
// Cheap fix: check file SIZE (no read) on every append — only pay the cost
// of a full read+rewrite the rare time the file actually crosses the cap.
const PRUNE_CHECK_BYTES = 512 * 1024; // ~512KB before we even look closer
const MAX_EVENTS = 5000; // keep the most recent N events after a prune

export function feedbackPathFor(root) {
  return join(root, ".hp-state", "feedback", "events.jsonl");
}

function pruneIfOversized(path) {
  let size;
  try {
    size = statSync(path).size;
  } catch {
    return;
  }
  if (size < PRUNE_CHECK_BYTES) return;

  const lines = readFileSync(path, "utf8").split("\n").filter((line) => line.trim());
  if (lines.length <= MAX_EVENTS) return;
  writeFileSync(path, lines.slice(-MAX_EVENTS).join("\n") + "\n");
}

export function logEvent(root, event) {
  const path = feedbackPathFor(root);
  mkdirSync(dirname(path), { recursive: true });
  pruneIfOversized(path);
  appendFileSync(path, JSON.stringify({ ts: Date.now(), ...event }) + "\n");
}

export function readEvents(root) {
  const path = feedbackPathFor(root);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// Bounded per PLAN.md spec: x0.5 (ignored streak) .. x2.0 (used streak).
// Streak = consecutive most-recent suggestions for this id with the same
// used/ignored outcome, walking back from the newest event.
export function computeFactors(root) {
  const events = readEvents(root).sort((a, b) => a.ts - b.ts);
  const byId = new Map();
  for (const e of events) {
    if (e.type !== "suggested" && e.type !== "used") continue;
    // Read-side hygiene, not a log rewrite: suggestions fired against
    // harness-generated payloads (the hook now skips them at the source, but
    // 21/26 historical suggested events were exactly this) must not count as
    // "ignored" outcomes - that decayed genuinely good capabilities on noise.
    // Filtering here retroactively cleans history while keeping the JSONL
    // append-only.
    if (e.type === "suggested" && isSyntheticPrompt(e.prompt)) continue;
    if (!byId.has(e.id)) byId.set(e.id, []);
    byId.get(e.id).push(e);
  }

  const factors = new Map();
  for (const [id, idEvents] of byId) {
    // Resolve each "suggested" against the next "used" that follows it in
    // time for the same id -> a bounded sequence of hit/miss outcomes.
    //
    // Asymmetric credit (2026-07-09): suggestions with source:"pull" (MCP
    // route() results - Claude asked) count toward boost when followed by a
    // "used", but an unused pull suggestion resolves to NO outcome, not an
    // ignored one. Pull is recall-generous by design - most returned
    // candidates going unused is normal operation, not negative signal.
    // Only push suggestions (unsolicited injections the model definitely
    // saw) earn decay when ignored.
    const outcomes = [];
    let pending = null; // null | "push" | "pull"
    const resolveIgnored = () => {
      if (pending === "push") outcomes.push(false);
      pending = null;
    };
    for (const e of idEvents) {
      if (e.type === "suggested") {
        resolveIgnored();
        pending = e.source === "pull" ? "pull" : "push";
      } else if (e.type === "used" && pending) {
        outcomes.push(true);
        pending = null;
      }
    }
    resolveIgnored();

    if (outcomes.length === 0) {
      factors.set(id, 1.0);
      continue;
    }
    let streak = 0;
    const last = outcomes[outcomes.length - 1];
    for (let i = outcomes.length - 1; i >= 0 && outcomes[i] === last; i -= 1) streak += 1;

    const factor = last
      ? Math.min(2.0, 1 + 0.2 * streak)
      : Math.max(0.5, 1 - 0.15 * streak);
    factors.set(id, Number(factor.toFixed(3)));
  }
  return factors;
}
