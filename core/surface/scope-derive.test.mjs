import { test } from "node:test";
import assert from "node:assert/strict";
import {
  looksLikeProjectPath,
  configIsProjectBound,
  deriveScope,
} from "./scope-derive.mjs";

test("looksLikeProjectPath: project-relative forms are detected", () => {
  assert.equal(looksLikeProjectPath("server/mcp-server.mjs"), true); // harness-router tell
  assert.equal(looksLikeProjectPath("./dist/index.js"), true);
  assert.equal(looksLikeProjectPath("../shared/run.py"), true);
  assert.equal(looksLikeProjectPath("."), true);
  assert.equal(looksLikeProjectPath("${workspaceFolder}/x"), true);
});

test("looksLikeProjectPath: portable forms are NOT flagged (no false positives)", () => {
  assert.equal(looksLikeProjectPath("node"), false);
  assert.equal(looksLikeProjectPath("npx"), false);
  assert.equal(looksLikeProjectPath("@upstash/context7-mcp"), false); // scoped pkg, not a path
  assert.equal(looksLikeProjectPath("mcp-server-fetch"), false);
  assert.equal(looksLikeProjectPath("https://mcp.context7.com/mcp"), false); // URL
  assert.equal(looksLikeProjectPath("-y"), false);
});

test("looksLikeProjectPath: absolute path only counts inside the given project root", () => {
  const root = "/home/u/repo";
  assert.equal(looksLikeProjectPath("/home/u/repo/server.mjs", root), true);
  assert.equal(looksLikeProjectPath("/usr/local/bin/tool", root), false); // machine-global
  assert.equal(looksLikeProjectPath("/home/u/repo/server.mjs", null), false); // no root known
});

test("configIsProjectBound: harness-router (node server/mcp-server.mjs) is project-bound", () => {
  const cfg = { type: "stdio", command: "node", args: ["server/mcp-server.mjs"] };
  assert.equal(configIsProjectBound(cfg), true);
});

test("configIsProjectBound: git server with --repository <projectpath> is project-bound", () => {
  const root = "/home/u/repo";
  const cfg = { command: "uvx", args: ["mcp-server-git", "--repository", "/home/u/repo"] };
  assert.equal(configIsProjectBound(cfg, root), true);
});

test("configIsProjectBound: portable package and URL servers are NOT bound", () => {
  assert.equal(configIsProjectBound({ command: "npx", args: ["-y", "@upstash/context7-mcp"] }), false);
  assert.equal(configIsProjectBound({ type: "http", url: "https://mcp.context7.com/mcp" }), false);
});

test("deriveScope: project-bound config is forced to project regardless of discovery", () => {
  const cfg = { command: "node", args: ["server/mcp-server.mjs"] };
  assert.equal(deriveScope(cfg, { discoveredGlobal: true }).scope, "project");
  assert.equal(deriveScope(cfg, { discoveredGlobal: false }).scope, "project");
});

test("deriveScope: portable config takes the scope it was discovered at", () => {
  const cfg = { type: "http", url: "https://mcp.context7.com/mcp" };
  assert.equal(deriveScope(cfg, { discoveredGlobal: true }).scope, "global");
  assert.equal(deriveScope(cfg, { discoveredGlobal: false }).scope, "project");
});

test("deriveScope: unknown/ambiguous defaults to project (never pollute global by guessing)", () => {
  const cfg = { command: "npx", args: ["-y", "some-pkg"] };
  assert.equal(deriveScope(cfg, {}).scope, "project");
});

test("deriveScope: reason is reported for transparency", () => {
  const bound = deriveScope({ command: "node", args: ["app/x.mjs"] }, {});
  assert.match(bound.reason, /project-bound/);
  const global = deriveScope({ url: "https://x/mcp", type: "http" }, { discoveredGlobal: true });
  assert.match(global.reason, /portable/);
});
