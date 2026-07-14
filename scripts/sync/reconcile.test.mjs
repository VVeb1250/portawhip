import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, runReconcile } from "./reconcile.mjs";

function rulesyncJson(paths, hasDiff) {
  return JSON.stringify({
    success: true,
    data: {
      features: { mcp: { count: paths.length, paths } },
      totalFiles: paths.length,
      hasDiff,
    },
  });
}

test("reconcile: parses safe manual commands and guards apply", () => {
  assert.deepEqual(parseArgs(["node", "reconcile.mjs", "check"]), {
    command: "check",
    scope: "project",
    allowApply: false,
    force: false,
    json: false,
  });
  assert.throws(() => parseArgs(["node", "reconcile.mjs", "apply"]), /explicit --apply/);
  const apply = parseArgs(["node", "reconcile.mjs", "apply", "--scope", "global", "--apply", "--force", "--json"]);
  assert.equal(apply.scope, "global");
  assert.equal(apply.allowApply, true);
  assert.equal(apply.force, true);
  assert.equal(apply.json, true);
});

test("reconcile: check reports rulesync drift without writing", async () => {
  const calls = [];
  // A Windows-style "C:/work/project" root only resolves as absolute on
  // Windows - on Linux/macOS `resolve()` treats it as a relative segment and
  // prepends cwd, which is what CI caught. Use `resolve()` itself to build a
  // root that's genuinely absolute on whatever OS the test runs on.
  const root = resolve("work-project-fixture");
  const result = await runReconcile({
    command: "check",
    root,
    runner: (_command, args) => {
      calls.push(args);
      return { status: 1, stdout: rulesyncJson([".mcp.json"], true), stderr: "" };
    },
  });
  assert.equal(result.status, "drift");
  assert.deepEqual(calls[0].slice(-3), ["--json", "generate", "--dry-run"]);
  assert.equal(result.targets[0], resolve(root, ".mcp.json"));
});

test("reconcile: apply backs up, writes, verifies, and records ownership", async () => {
  const root = mkdtempSync(join(tmpdir(), "reconcile-"));
  const target = join(root, ".mcp.json");
  writeFileSync(target, "before");
  const calls = [];
  const runner = (_command, args) => {
    calls.push(args);
    if (args.includes("--dry-run")) return { status: 0, stdout: rulesyncJson([".mcp.json"], true), stderr: "" };
    if (args.includes("--check")) return { status: 0, stdout: rulesyncJson([".mcp.json"], false), stderr: "" };
    writeFileSync(target, "after");
    return { status: 0, stdout: rulesyncJson([".mcp.json"], true), stderr: "" };
  };
  const result = await runReconcile({ command: "apply", root, allowApply: true, runner, now: () => "20260714T000000Z" });
  assert.equal(result.status, "success");
  assert.equal(readFileSync(target, "utf8"), "after");
  assert.deepEqual(calls.map((args) => {
    const generate = args.indexOf("generate");
    return args.slice(generate, generate + 2);
  }), [
    ["generate", "--dry-run"],
    ["generate"],
    ["generate", "--check"],
  ]);
  const manifest = JSON.parse(readFileSync(join(result.backupDir, "manifest.json"), "utf8"));
  assert.equal(manifest.files[0].existed, true);
  const ledger = JSON.parse(readFileSync(join(root, ".hp-state", "ownership-ledger.json"), "utf8"));
  assert.equal(ledger.paths[".mcp.json"].writer, "rulesync");
});

test("reconcile: failed verify restores the backup", async () => {
  const root = mkdtempSync(join(tmpdir(), "reconcile-rollback-"));
  const target = join(root, ".mcp.json");
  writeFileSync(target, "before");
  const runner = (_command, args) => {
    if (args.includes("--dry-run")) return { status: 0, stdout: rulesyncJson([".mcp.json"], true), stderr: "" };
    if (args.includes("--check")) return { status: 1, stdout: rulesyncJson([".mcp.json"], true), stderr: "" };
    writeFileSync(target, "broken");
    return { status: 0, stdout: rulesyncJson([".mcp.json"], true), stderr: "" };
  };
  const result = await runReconcile({ command: "apply", root, allowApply: true, runner, now: () => "20260714T000001Z" });
  assert.equal(result.status, "rolled-back");
  assert.equal(readFileSync(target, "utf8"), "before");
});

test("reconcile: verify checks every ownership-ledger path even when rulesync reports no changed paths", async () => {
  const root = mkdtempSync(join(tmpdir(), "reconcile-ledger-verify-"));
  const target = join(root, ".mcp.json");
  writeFileSync(target, "generated");
  mkdirSync(join(root, ".hp-state"), { recursive: true });
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update("generated").digest("hex");
  writeFileSync(join(root, ".hp-state", "ownership-ledger.json"), JSON.stringify({
    version: 1,
    paths: { ".mcp.json": { writer: "rulesync", hash } },
  }));
  writeFileSync(target, "tampered");
  const result = await runReconcile({
    command: "verify",
    root,
    runner: () => ({ status: 0, stdout: rulesyncJson([], false), stderr: "" }),
  });
  assert.equal(result.status, "drift");
  assert.equal(result.drift[0].path, ".mcp.json");
});

test("reconcile: rollback restores hand-authored files from rulesync total-ownership directories", async () => {
  const root = mkdtempSync(join(tmpdir(), "reconcile-owned-dir-"));
  const manual = join(root, ".agents", "skills", "manual", "SKILL.md");
  mkdirSync(join(root, ".agents", "skills", "manual"), { recursive: true });
  writeFileSync(manual, "manual-content");
  const payload = JSON.stringify({
    success: true,
    data: {
      features: { skills: { count: 1, paths: [".agents/skills/portawhip/SKILL.md"] } },
      totalFiles: 1,
      hasDiff: true,
    },
  });
  const runner = (_command, args) => {
    if (args.includes("--dry-run")) return { status: 0, stdout: payload, stderr: "" };
    if (args.includes("--check")) return { status: 1, stdout: payload, stderr: "" };
    rmSync(join(root, ".agents", "skills"), { recursive: true, force: true });
    mkdirSync(join(root, ".agents", "skills", "portawhip"), { recursive: true });
    writeFileSync(join(root, ".agents", "skills", "portawhip", "SKILL.md"), "generated");
    return { status: 0, stdout: payload, stderr: "" };
  };
  const result = await runReconcile({ command: "apply", root, allowApply: true, runner, now: () => "20260714T000002Z" });
  assert.equal(result.status, "rolled-back");
  assert.equal(readFileSync(manual, "utf8"), "manual-content");
  assert.equal(existsSync(join(root, ".agents", "skills", "portawhip", "SKILL.md")), false);
});

test("reconcile: real check is isolated and never lets rulesync dry-run touch host files", async () => {
  const root = mkdtempSync(join(tmpdir(), "reconcile-isolated-check-"));
  mkdirSync(join(root, ".rulesync"), { recursive: true });
  mkdirSync(join(root, ".codex"), { recursive: true });
  writeFileSync(join(root, "rulesync.jsonc"), JSON.stringify({
    targets: ["codexcli"],
    features: ["mcp"],
    outputRoots: ["."],
    delete: false,
  }));
  writeFileSync(join(root, ".rulesync", "mcp.json"), JSON.stringify({
    mcpServers: { docs: { type: "http", url: "https://example.test/mcp" } },
  }));
  const existing = '[mcp_servers.keep]\nurl = "https://keep.test/mcp"\n';
  writeFileSync(join(root, ".codex", "config.toml"), existing);
  const result = await runReconcile({ command: "check", root });
  assert.equal(result.status, "drift");
  assert.equal(readFileSync(join(root, ".codex", "config.toml"), "utf8"), existing);
  assert.equal(existsSync(join(root, ".mcp.json")), false);
});
