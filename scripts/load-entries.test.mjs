import { test } from "node:test";
import assert from "node:assert/strict";

import { installEntries } from "./load.mjs";

test("route-only entries are skipped by the loader", () => {
  const result = installEntries([{ id: "alias-only", type: "skill", source: "missing", install: false }], {
    mcpHosts: ["codex"],
    skillHosts: ["codex"],
  });
  assert.deepEqual(result, [{ id: "alias-only", ok: true, skipped: true }]);
});
