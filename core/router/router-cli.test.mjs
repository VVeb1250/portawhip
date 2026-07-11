import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("./router-cli.mjs", import.meta.url));

test("router CLI falls back to the packaged recipe outside a managed workspace", () => {
  const cwd = mkdtempSync(join(tmpdir(), "portawhip-cli-"));
  try {
    const result = spawnSync(process.execPath, [cli, "list", "--type", "mcp", "--no-discover"], {
      cwd,
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    const entries = JSON.parse(result.stdout);
    assert.ok(entries.some((entry) => entry.id === "context7"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
