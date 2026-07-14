import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeVariants, normalizeMcpConfig, seedMcpCanonical, unionMcpServers } from "./rulesync-canonical.mjs";

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

test("rulesync canonical: global seed excludes project-bound servers (derived, not listed)", async () => {
  const root = mkdtempSync(join(tmpdir(), "rulesync-scope-"));
  // harness-router-style server: repo-relative launch path across hosts with
  // differing configs (would otherwise be a blocking global conflict).
  const discover = async () => [
    {
      agentType: "codex",
      servers: [
        { serverName: "harness-router", config: { command: "node", args: [`${root}/server/mcp-server.mjs`] } },
        { serverName: "docs", config: { url: "https://example.test/mcp" } },
      ],
    },
    {
      agentType: "claude-code",
      servers: [
        { serverName: "harness-router", config: { command: "node", args: ["server/mcp-server.mjs"] } },
        { serverName: "docs", config: { type: "http", url: "https://example.test/mcp" } },
      ],
    },
  ];
  const result = await seedMcpCanonical({ root, scope: "global", discover, apply: false });
  // project-bound server dropped from global (and not counted as a conflict)
  assert.equal("harness-router" in result.servers, false);
  assert.ok(result.excluded.some((e) => e.name === "harness-router"));
  assert.equal(result.status, "preview");
  // portable server survives at global scope
  assert.deepEqual(result.servers.docs, { type: "http", url: "https://example.test/mcp" });
});

test("mergeVariants: identical configs resolve unchanged", () => {
  const c = { type: "http", url: "https://x/mcp" };
  const r = mergeVariants([c, { ...c }]);
  assert.equal(r.status, "resolved");
  assert.deepEqual(r.config, c);
});

test("mergeVariants: env superset resolves via union (the gortex case)", () => {
  const r = mergeVariants([
    { type: "stdio", command: "gortex", args: ["mcp"] },
    { type: "stdio", command: "gortex", args: ["mcp"], env: { GORTEX_INDEX_WORKERS: "8" } },
  ]);
  assert.equal(r.status, "resolved");
  assert.deepEqual(r.config.env, { GORTEX_INDEX_WORKERS: "8" });
});

test("mergeVariants: partial envs union when no value conflict", () => {
  const r = mergeVariants([
    { command: "x", env: { A: "1" } },
    { command: "x", env: { B: "2" } },
  ]);
  assert.equal(r.status, "resolved");
  assert.deepEqual(r.config.env, { A: "1", B: "2" });
});

test("mergeVariants: conflicting env value is divergent on that key", () => {
  const r = mergeVariants([
    { command: "x", env: { WORKERS: "8" } },
    { command: "x", env: { WORKERS: "4" } },
  ]);
  assert.equal(r.status, "divergent");
  assert.deepEqual(r.keys, ["env.WORKERS"]);
});

test("mergeVariants: differing command/url/args are divergent", () => {
  assert.equal(mergeVariants([{ command: "gortex" }, { command: "/bin/gortex" }]).status, "divergent");
  assert.equal(mergeVariants([{ url: "https://a/mcp", type: "http" }, { url: "https://b/mcp", type: "http" }]).status, "divergent");
  assert.equal(mergeVariants([{ command: "x", args: ["mcp"] }, { command: "x", args: ["mcp", "--verbose"] }]).status, "divergent");
});

test("mergeVariants: propagating a security-sensitive header to a host that lacked it warns", () => {
  const r = mergeVariants([
    { type: "http", url: "https://x/mcp" },
    { type: "http", url: "https://x/mcp", headers: { Authorization: "${TOKEN}" } },
  ]);
  assert.equal(r.status, "resolved");
  assert.match(r.warnings.join("\n"), /headers\.Authorization propagated/i);
});

test("unionMcpServers: a superset variant no longer reports a conflict", () => {
  const { servers, conflicts } = unionMcpServers([
    { agentType: "claude-code", servers: [{ serverName: "gortex", config: { type: "stdio", command: "gortex", args: ["mcp"] } }] },
    { agentType: "codex", servers: [{ serverName: "gortex", config: { command: "gortex", args: ["mcp"], env: { GORTEX_INDEX_WORKERS: "8" } } }] },
  ]);
  assert.equal(conflicts.length, 0);
  assert.deepEqual(servers.gortex.env, { GORTEX_INDEX_WORKERS: "8" });
});
