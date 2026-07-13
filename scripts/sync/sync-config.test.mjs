import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG_SYNC_BACKENDS, buildBackendArgs, runBackend } from "../../core/surface/config-sync-backends.mjs";
import { collectSyncConfig, parseArgs } from "./sync-config.mjs";

test("sync-config: rulesync is the only steady-state fan-out writer", () => {
  assert.equal(CONFIG_SYNC_BACKENDS.rulesync.steadyStateWriter, true);
  assert.equal(CONFIG_SYNC_BACKENDS["ai-config-sync"].steadyStateWriter, false);
  assert.equal(CONFIG_SYNC_BACKENDS["agent-skill-manager"].steadyStateWriter, false);
  assert.equal(CONFIG_SYNC_BACKENDS["agents-dotdir"], undefined);
  assert.equal(parseArgs(["node", "sync-config.mjs", "status"]).backends[0], "rulesync");
});

test("sync-config: rulesync preview builds a dry-run project command", () => {
  assert.deepEqual(
    buildBackendArgs("rulesync", "preview", { scope: "project" }),
    ["generate", "--dry-run"],
  );
  assert.deepEqual(buildBackendArgs("rulesync", "status", { scope: "global" }), ["generate", "--check", "-g"]);
});

test("sync-config: apply is retired in favor of the guarded reconciler", () => {
  assert.throws(() => parseArgs(["node", "sync-config.mjs", "apply"]), /explicit --apply/);
  assert.throws(
    () => parseArgs(["node", "sync-config.mjs", "apply", "--apply", "--include", "mcp:notion"]),
    /portawhip sync apply.*backup.*ownership/i,
  );
});

test("sync-config: all apply selectors are routed through the reconciler", () => {
  assert.throws(
    () => parseArgs(["node", "sync-config.mjs", "apply", "--apply", "--include", "skills"]),
    /portawhip sync apply/i,
  );
  assert.throws(
    () => parseArgs(["node", "sync-config.mjs", "apply", "--apply", "--include", "skills:pdf"]),
    /portawhip sync apply/i,
  );
});

test("sync-config: profiles fill safe defaults", () => {
  const args = parseArgs(["node", "sync-config.mjs", "preview", "--profile", "project-instructions"]);
  assert.equal(args.backends[0], "rulesync");
  assert.equal(args.scope, "project");
  assert.equal(args.include, "instructions");
});

test("sync-config: agent-skill-manager is probe-only", () => {
  assert.deepEqual(buildBackendArgs("asm", "status"), ["config", "show"]);
  assert.throws(() => buildBackendArgs("asm", "preview"), /does not support preview/);
});

test("sync-config: rulesync check drift is not an invocation failure", () => {
  const runner = () => ({
    status: 1,
    stdout: "Generated files are out of date.\n",
    stderr: "",
  });
  const row = runBackend("rulesync", "status", {}, runner);
  assert.equal(row.ok, true);
  assert.equal(row.status, "changed");
  assert.equal(row.installHint, null);
  assert.match(row.summary, /planned changes/);
});

test("sync-config: collect marks probe-only unsupported actions without failing all", () => {
  const result = collectSyncConfig({
    action: "preview",
    backends: ["agent-skill-manager"],
    options: {},
  });
  assert.equal(result.status, "success");
  assert.equal(result.rows[0].ok, true);
  assert.equal(result.rows[0].status, "unsupported");
  assert.match(result.rows[0].summary, /does not support preview/);
});

test("sync-config: collect reports backend output in stable shape", () => {
  const calls = [];
  const runner = (cmd, args) => {
    calls.push([cmd, args]);
    return { status: 0, stdout: "{\"ok\":true}\n", stderr: "" };
  };
  const row = runBackend("rulesync", "status", {}, runner);
  assert.equal(row.status, "success");
  assert.equal(row.backend, "rulesync");
  assert.match(row.command[0].replace(/\\/g, "/"), /(node_modules\/\.bin\/rulesync|rulesync)(\.cmd)?$/);
  assert.deepEqual(row.command.slice(1), ["generate", "--check"]);

  const result = collectSyncConfig({
    action: "status",
    backends: ["agent-skill-manager"],
    options: {},
    runner,
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].backend, "agent-skill-manager");
  assert.match(calls[0][0].replace(/\\/g, "/"), /(node_modules\/\.bin\/rulesync|rulesync)(\.cmd)?$/);
  assert.deepEqual(calls[0][1], ["generate", "--check"]);
  assert.match(calls[1][0].replace(/\\/g, "/"), /agent-skill-manager(\.cmd)?$/);
  assert.deepEqual(calls[1][1], ["config", "show"]);
});

test("sync-config: pinned local backend wins even when npx fallback is allowed", () => {
  const calls = [];
  const runner = (cmd, args) => {
    calls.push([cmd, args]);
    return { status: 0, stdout: "{\"ok\":true}\n", stderr: "" };
  };
  const args = parseArgs(["node", "sync-config.mjs", "status", "--allow-npx"]);
  assert.equal(args.allowNpx, true);
  runBackend("rulesync", "status", { allowNpx: true }, runner);
  assert.match(calls[0][0].replace(/\\/g, "/"), /(node_modules\/\.bin\/rulesync|rulesync)(\.cmd)?$/);
  assert.deepEqual(calls[0][1], ["generate", "--check"]);
});

test("sync-config: backend ledger inner errors make the wrapper fail", () => {
  const runner = () => ({
    status: 0,
    stdout: '{"summary":{"applied":0,"error":1}}\nextra human output\n',
    stderr: "",
  });
  const row = runBackend("ai-config-sync", "apply", { include: "instructions" }, runner);
  assert.equal(row.ok, false);
  assert.equal(row.status, "error");
  assert.match(row.summary, /inner error/);
  assert.deepEqual(row.parsedSummary, { applied: 0, error: 1 });
});
