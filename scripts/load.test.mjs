import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { longTailSkillHosts, stageMcpEntry } from "./load.mjs";

test("ASM is limited to skill hosts not covered by Rulesync", () => {
  assert.deepEqual(
    longTailSkillHosts(["claude", "codex", "cursor", "gemini", "windsurf", "antigravity"]),
    ["gemini", "windsurf", "antigravity"],
  );
});

test("load stages MCP in Rulesync canonical instead of writing host configs", () => {
  const root = mkdtempSync(join(tmpdir(), "portawhip-load-"));
  try {
    const result = stageMcpEntry(
      { id: "context7", type: "mcp", source: "https://mcp.context7.com/mcp", scope: "project" },
      { root, scope: "project" },
    );
    assert.equal(result.status, "changed");
    const json = JSON.parse(readFileSync(join(root, ".rulesync", "mcp.json"), "utf8"));
    assert.deepEqual(json.mcpServers.context7, { type: "http", url: "https://mcp.context7.com/mcp" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("load refuses to overwrite a conflicting canonical MCP declaration", () => {
  const root = mkdtempSync(join(tmpdir(), "portawhip-load-"));
  try {
    stageMcpEntry({ id: "shared", source: "https://one.example/mcp", scope: "project" }, { root, scope: "project" });
    assert.throws(
      () => stageMcpEntry({ id: "shared", source: "https://two.example/mcp", scope: "project" }, { root, scope: "project" }),
      /conflicts with canonical/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
