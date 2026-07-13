import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claimOwnership,
  contentHash,
  verifyOwnedContent,
} from "./ownership-ledger.mjs";

test("ownership ledger: records writer and generated content hash", () => {
  const ledger = claimOwnership({}, {
    path: ".claude/settings.json",
    writer: "rulesync",
    content: "generated-v1",
  });
  assert.deepEqual(ledger.paths[".claude/settings.json"], {
    writer: "rulesync",
    hash: contentHash("generated-v1"),
  });
});

test("ownership ledger: reports clean, drift, and non-owner attempts", () => {
  const ledger = claimOwnership({}, {
    path: "AGENTS.md",
    writer: "rulesync",
    content: "generated-v1",
  });
  assert.equal(verifyOwnedContent(ledger, { path: "AGENTS.md", writer: "rulesync", content: "generated-v1" }).status, "clean");
  assert.equal(verifyOwnedContent(ledger, { path: "AGENTS.md", writer: "rulesync", content: "edited" }).status, "drift");
  assert.equal(verifyOwnedContent(ledger, { path: "AGENTS.md", writer: "legacy-linker", content: "generated-v1" }).status, "non-owner");
});
