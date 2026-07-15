import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { logEvent, readEvents } from "../state/feedback.mjs";
import { createSessionLedger, logPullEmissions } from "./session-ledger.mjs";

const HIT = {
  id: "codegraph",
  type: "mcp",
  kind: "tool",
  how_to_use: "Trace callers over the indexed graph.",
  pointer: "codegraph",
};

test("session ledger: a full payload is fresh once, then a compact reuse, then mute", () => {
  const ledger = createSessionLedger();

  const first = ledger.emit([HIT]);
  const second = ledger.emit([HIT]);
  const third = ledger.emit([HIT]);

  assert.equal(first[0].state, "fresh");
  assert.equal(second[0].state, "reuse");
  assert.deepEqual(Object.keys(second[0]).sort(), ["id", "note", "state"]);
  assert.ok(JSON.stringify(second[0]).split(/[\s,:{}\"]+/).filter(Boolean).length <= 15);
  assert.deepEqual(third, []);
});

test("session ledger: a muted pull result writes no feedback event", () => {
  const root = mkdtempSync(join(tmpdir(), "portawhip-ledger-mute-"));
  try {
    const ledger = createSessionLedger({ feedbackRoot: root });
    logPullEmissions(root, ledger.emit([HIT]));
    logPullEmissions(root, ledger.emit([HIT]));
    const beforeMute = readEvents(root);

    logPullEmissions(root, ledger.emit([HIT]));

    assert.equal(beforeMute.length, 2);
    assert.deepEqual(readEvents(root), beforeMute);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("session ledger: used feedback from a hook makes the next pull a reuse", () => {
  const root = mkdtempSync(join(tmpdir(), "portawhip-ledger-used-"));
  try {
    const ledger = createSessionLedger({ feedbackRoot: root });
    logEvent(root, { type: "used", id: HIT.id, source: "hook" });

    const emitted = ledger.emit([HIT]);

    assert.equal(emitted[0].state, "reuse");
    assert.deepEqual(Object.keys(emitted[0]).sort(), ["id", "note", "state"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
