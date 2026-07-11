import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBackendArgs, runBackend } from "../../core/surface/config-sync-backends.mjs";
import { collectSyncConfig, parseArgs } from "./sync-config.mjs";

test("sync-config: ai-config-sync preview builds a dry-run plan command", () => {
  assert.deepEqual(
    buildBackendArgs("ai-config-sync", "preview", {
      from: "claude",
      to: "codex",
      scope: "project",
      include: "instructions,skills",
      exclude: "mcp",
    }),
    [
      "sync",
      "--dry-run",
      "--plan-json",
      "--from",
      "claude",
      "--to",
      "codex",
      "--scope",
      "project",
      "--include",
      "instructions,skills",
      "--exclude",
      "mcp",
    ],
  );
});

test("sync-config: apply is guarded by an explicit flag", () => {
  assert.throws(() => parseArgs(["node", "sync-config.mjs", "apply"]), /explicit --apply/);
  assert.throws(() => parseArgs(["node", "sync-config.mjs", "apply", "--apply"]), /requires --include/);
  assert.equal(parseArgs(["node", "sync-config.mjs", "apply", "--apply", "--include", "mcp:notion"]).allowApply, true);
});

test("sync-config: apply blocks broad all-skills writes", () => {
  assert.throws(
    () => parseArgs(["node", "sync-config.mjs", "apply", "--apply", "--include", "skills"]),
    /all skills is blocked/,
  );
  assert.equal(
    parseArgs(["node", "sync-config.mjs", "apply", "--apply", "--include", "skills:pdf"]).include,
    "skills:pdf",
  );
});

test("sync-config: profiles fill safe defaults", () => {
  const args = parseArgs(["node", "sync-config.mjs", "preview", "--profile", "ai-project-instructions"]);
  assert.equal(args.backends[0], "ai-config-sync");
  assert.equal(args.scope, "project");
  assert.equal(args.include, "instructions");
});

test("sync-config: agent-skill-manager is probe-only", () => {
  assert.deepEqual(buildBackendArgs("asm", "status"), ["config", "show"]);
  assert.throws(() => buildBackendArgs("asm", "preview"), /does not support preview/);
});

test("sync-config: .agents preview maps to sync --check", () => {
  assert.deepEqual(buildBackendArgs(".agents", "preview"), ["sync", "--check"]);
});

test("sync-config: .agents preview planned changes are not install failures", () => {
  const runner = () => ({
    status: 1,
    stdout: "\u001b[36m[info]\u001b[39m Would update 1 item(s):\n  -> .agents/agents.json\n",
    stderr: "",
  });
  const row = runBackend("agents-dotdir", "preview", {}, runner);
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
  const row = runBackend("ai-config-sync", "status", {}, runner);
  assert.equal(row.status, "success");
  assert.equal(row.backend, "ai-config-sync");
  assert.match(row.command[0].replace(/\\/g, "/"), /(node_modules\/\.bin\/ai-config-sync|ai-config-sync)(\.cmd)?$/);
  assert.deepEqual(row.command.slice(1), ["status", "--json"]);

  const result = collectSyncConfig({
    action: "status",
    backends: ["agent-skill-manager"],
    options: {},
    runner,
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].backend, "agent-skill-manager");
  assert.match(calls[0][0].replace(/\\/g, "/"), /(node_modules\/\.bin\/ai-config-sync|ai-config-sync)(\.cmd)?$/);
  assert.deepEqual(calls[0][1], ["status", "--json"]);
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
  runBackend("ai-config-sync", "status", { allowNpx: true }, runner);
  assert.match(calls[0][0].replace(/\\/g, "/"), /(node_modules\/\.bin\/ai-config-sync|ai-config-sync)(\.cmd)?$/);
  assert.deepEqual(calls[0][1], ["status", "--json"]);
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
