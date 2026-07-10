import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectSurfaceMatrix, loadSurfaceMatrix } from "./surface-matrix.mjs";

function fixture(contents) {
  const dir = mkdtempSync(join(tmpdir(), "surface-matrix-"));
  const path = join(dir, "surface-matrix.yaml");
  writeFileSync(path, contents);
  return path;
}

test("loadSurfaceMatrix rejects a doc with no surfaces list", () => {
  const path = fixture("nope: true\n");
  assert.throws(() => loadSurfaceMatrix(path), /missing "surfaces" list/);
});

test("declared gap (owner null) reports the gap verbatim, no probe run", async () => {
  const path = fixture(`surfaces:
  - id: embedded
    label: Embedded hooks
    read:
      owner: null
      gap: missing
      note: no scanner yet
    write:
      owner: null
      gap: missing
`);
  const result = await collectSurfaceMatrix({ path });
  const row = result.rows[0];
  assert.equal(row.read.status, "missing");
  assert.equal(row.read.detail, "no scanner yet");
  assert.equal(row.write.status, "missing");
  assert.ok(result.summary.attention.includes("embedded"));
});

test("owner present + gap + no probe = the declared gap (partial lane)", async () => {
  const path = fixture(`surfaces:
  - id: agent
    label: Agents
    read:
      owner: x
      gap: partial
    write:
      owner: ai-config-sync
      gap: partial
      note: claude<->codex only
`);
  const result = await collectSurfaceMatrix({ path });
  assert.equal(result.rows[0].write.status, "partial");
  assert.equal(result.rows[0].write.owner, "ai-config-sync");
  // partial is a known lane, not an attention gap
  assert.deepEqual(result.summary.attention, []);
});

test("command probe: resolvable command covered, bogus command backend-missing", async () => {
  const path = fixture(`surfaces:
  - id: real
    label: Real
    read:
      owner: node
      probe: { kind: command, argv: [node, --version] }
    write:
      owner: nope
      probe: { kind: command, argv: [definitely-not-a-real-binary-xyz, --version] }
`);
  const result = await collectSurfaceMatrix({ path });
  assert.equal(result.rows[0].read.status, "covered");
  assert.equal(result.rows[0].write.status, "backend-missing");
  assert.ok(result.summary.attention.includes("real"));
});

test("heavy probe is skipped (declared) when heavy=false", async () => {
  const path = fixture(`surfaces:
  - id: mcp
    label: MCP
    read:
      owner: discover.mjs:discoverMcp
      probe: { kind: discover, fn: mcp, heavy: true }
    write:
      owner: x
      gap: partial
`);
  const result = await collectSurfaceMatrix({ path, heavy: false });
  assert.equal(result.rows[0].read.status, "declared");
  assert.match(result.rows[0].read.detail, /count skipped/);
});
