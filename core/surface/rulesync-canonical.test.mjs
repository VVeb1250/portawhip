import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeMcpConfig, seedMcpCanonical, unionMcpServers } from "./rulesync-canonical.mjs";

test("rulesync canonical: normalizes host-specific MCP encodings", () => {
  assert.deepEqual(normalizeMcpConfig({ command: "npx", args: ["-y", "server"], enabled: true }).config, {
    type: "stdio",
    command: "npx",
    args: ["-y", "server"],
  });
  assert.deepEqual(normalizeMcpConfig({ transport: "streamable_http", url: "https://example.test/mcp" }).config, {
    type: "http",
    url: "https://example.test/mcp",
  });
});

test("rulesync canonical: unions identical servers from multiple hosts", () => {
  const result = unionMcpServers([
    { agentType: "codex", servers: [{ serverName: "docs", config: { url: "https://example.test/mcp" } }] },
    { agentType: "claude-code", servers: [{ serverName: "docs", config: { type: "http", url: "https://example.test/mcp" } }] },
  ]);
  assert.deepEqual(result.servers.docs, { type: "http", url: "https://example.test/mcp" });
  assert.deepEqual(result.conflicts, []);
});

test("rulesync canonical: blocks same-name conflicts instead of silently dropping a host", () => {
  const result = unionMcpServers([
    { agentType: "codex", servers: [{ serverName: "docs", config: { url: "https://one.test/mcp" } }] },
    { agentType: "claude-code", servers: [{ serverName: "docs", config: { url: "https://two.test/mcp" } }] },
  ]);
  assert.equal(result.servers.docs, undefined);
  assert.deepEqual(result.conflicts[0].hosts, ["codex", "claude-code"]);
});

test("rulesync canonical: never persists literal secret values", () => {
  const result = normalizeMcpConfig({
    command: "server",
    env: { API_TOKEN: "literal-secret", SAFE_MODE: "read-only", GITHUB_TOKEN: "${GITHUB_TOKEN}" },
    headers: { Authorization: "Bearer literal-secret", "X-Mode": "read-only" },
  });
  assert.deepEqual(result.config.env, { SAFE_MODE: "read-only", GITHUB_TOKEN: "${GITHUB_TOKEN}" });
  assert.deepEqual(result.config.headers, { "X-Mode": "read-only" });
  assert.equal(result.warnings.length, 2);
});

test("rulesync canonical: omits Codex app private node_repl runtime", () => {
  const result = unionMcpServers([
    {
      agentType: "codex",
      servers: [
        {
          serverName: "node_repl",
          config: {
            command: "C:/Users/me/AppData/Local/OpenAI/Codex/runtimes/cua_node/bin/node_repl.exe",
            env: { SKY_CUA_NATIVE_PIPE: "1" },
          },
        },
      ],
    },
  ]);
  assert.deepEqual(result.servers, {});
  assert.match(result.warnings.join("\n"), /host-private.*node_repl/i);
});

test("rulesync canonical: migration previews before atomically seeding the MCP union", async () => {
  const root = mkdtempSync(join(tmpdir(), "rulesync-seed-"));
  const discover = async () => [
    { agentType: "codex", servers: [{ serverName: "docs", config: { url: "https://example.test/mcp" } }] },
  ];
  const preview = await seedMcpCanonical({ root, discover, apply: false });
  assert.equal(preview.status, "preview");
  assert.equal(existsSync(preview.path), false);
  const applied = await seedMcpCanonical({ root, discover, apply: true });
  assert.equal(applied.status, "success");
  assert.deepEqual(JSON.parse(readFileSync(applied.path, "utf8")).mcpServers.docs, {
    type: "http",
    url: "https://example.test/mcp",
  });
});
