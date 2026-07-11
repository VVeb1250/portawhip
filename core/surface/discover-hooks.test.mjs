import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEmbeddedHooks, classifyHookPath, summarizeEmbeddedHooks } from "./discover-hooks.mjs";

const HOOKS_JSON = {
  description: "demo",
  hooks: {
    PreToolUse: [
      {
        matcher: "Bash",
        id: "pre:bash",
        hooks: [{ type: "command", command: "node dispatch.js", timeout: 30 }],
      },
    ],
    UserPromptSubmit: [
      { hooks: [{ type: "command", command: "bash remind.sh" }, { type: "other", command: "ignored" }] },
    ],
  },
};

test("parseEmbeddedHooks: extracts command hooks with id/event/matcher, skips non-command", () => {
  const out = parseEmbeddedHooks(HOOKS_JSON, "/home/.claude/plugins/cache/ecc/ecc/2.0.0/hooks/hooks.json");
  assert.equal(out.length, 2);
  const pre = out.find((h) => h.event === "PreToolUse");
  assert.equal(pre.id, "pre:bash");
  assert.equal(pre.matcher, "Bash");
  assert.equal(pre.package, "ecc");
  assert.equal(pre.host, "claude-code");
  assert.equal(pre.commandPreview, "node dispatch.js");
  // synthesized id when none is declared
  const ups = out.find((h) => h.event === "UserPromptSubmit");
  assert.equal(ups.id, "ecc:UserPromptSubmit");
});

test("parseEmbeddedHooks: no hooks key or non-object -> empty", () => {
  assert.deepEqual(parseEmbeddedHooks({}, "/x/hooks.json"), []);
  assert.deepEqual(parseEmbeddedHooks(null, "/x/hooks.json"), []);
});

test("classifyHookPath: host + template + package from path segments", () => {
  assert.equal(classifyHookPath("/h/.codex/hooks.json").host, "codex");
  assert.equal(classifyHookPath("/h/.cursor/x/hooks.json").host, "cursor");
  assert.equal(classifyHookPath("/h/.claude/plugins/cache/ecc/ecc/2.0.0/hooks/hooks.json").host, "claude-code");
  assert.equal(classifyHookPath("/h/.claude/plugins/cache/ecc/ecc/2.0.0/scaffolds/cursor/hooks.json").template, true);
  assert.equal(
    classifyHookPath("/h/.claude/plugins/marketplaces/claude-plugins-official/plugins/hookify/hooks/hooks.json").pkg,
    "hookify",
  );
});

test("summarizeEmbeddedHooks: counts total/active/templates and groups", () => {
  const entries = [
    { package: "a", host: "claude-code", template: false },
    { package: "a", host: "claude-code", template: false },
    { package: "b", host: "codex", template: true },
  ];
  const s = summarizeEmbeddedHooks(entries);
  assert.equal(s.total, 3);
  assert.equal(s.active, 2);
  assert.equal(s.templates, 1);
  assert.deepEqual(s.byPackage, { a: 2, b: 1 });
  assert.deepEqual(s.byHost, { "claude-code": 2, codex: 1 });
});
