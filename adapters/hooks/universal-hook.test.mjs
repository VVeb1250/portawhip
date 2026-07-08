import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { actionDirective, resolveId } from "./universal-hook.mjs";

// Integration-level: runs the real hook as a subprocess against this
// repo's real recipe.yaml (same style as core/router.test.mjs's
// discovery tests, which already exercise the live machine state).
// Feedback events land in this repo's real .hp-state/feedback, so every
// test needs a clean slate to assert against - but a plain rm here was
// found live (2026-07-06) to permanently delete real dogfood events
// (this repo's own push-hook firing during actual use), the first time
// this suite happened to run right after a real hook fire. Snapshot and
// restore instead of deleting, so running tests never costs real history.
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const HOOK = join(ROOT, "adapters", "hooks", "universal-hook.mjs");
const FEEDBACK_PATH = join(ROOT, ".hp-state", "feedback", "events.jsonl");

let feedbackBackup;

function clearFeedback() {
  feedbackBackup = existsSync(FEEDBACK_PATH) ? readFileSync(FEEDBACK_PATH, "utf8") : null;
  if (existsSync(FEEDBACK_PATH)) rmSync(FEEDBACK_PATH);
}

function restoreFeedback() {
  if (existsSync(FEEDBACK_PATH)) rmSync(FEEDBACK_PATH);
  if (feedbackBackup != null) {
    mkdirSync(dirname(FEEDBACK_PATH), { recursive: true });
    writeFileSync(FEEDBACK_PATH, feedbackBackup);
  }
}

function runHook(args, payload) {
  const result = spawnSync(process.execPath, [HOOK, ...args], {
    input: JSON.stringify(payload ?? {}),
    encoding: "utf8",
    cwd: ROOT,
  });
  return result.stdout.trim();
}

test("universal-hook: user_prompt emits additionalContext on a confident match", () => {
  clearFeedback();
  try {
    const stdout = runHook(
      ["--host", "claude-code", "--event", "user_prompt", "--nativeEvent", "UserPromptSubmit"],
      { prompt: "search codebase for the word foo" },
    );
    assert.ok(stdout, "expected non-empty stdout for a matching prompt");
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.hookSpecificOutput.hookEventName, "UserPromptSubmit");
    assert.ok(parsed.hookSpecificOutput.additionalContext.includes("ripgrep"));
  } finally {
    restoreFeedback();
  }
});

test("universal-hook: user_prompt renders tersely once a capability was already suggested this session", () => {
  clearFeedback();
  try {
    const args = ["--host", "claude-code", "--event", "user_prompt", "--nativeEvent", "UserPromptSubmit"];
    const payload = { prompt: "search codebase for the word foo", session_id: "test-session-repeat" };

    const first = JSON.parse(runHook(args, payload));
    assert.match(first.hookSpecificOutput.additionalContext, /ripgrep/);
    assert.match(first.hookSpecificOutput.additionalContext, /run it directly now/);

    const second = JSON.parse(runHook(args, payload));
    assert.match(second.hookSpecificOutput.additionalContext, /- ripgrep - still relevant, use it again/);
    assert.doesNotMatch(second.hookSpecificOutput.additionalContext, /run it directly now/);
  } finally {
    restoreFeedback();
  }
});

test("universal-hook: user_prompt stays silent on a short/unrelated prompt", () => {
  clearFeedback();
  try {
    const stdout = runHook(
      ["--host", "claude-code", "--event", "user_prompt", "--nativeEvent", "UserPromptSubmit"],
      { prompt: "hi" },
    );
    assert.equal(stdout, "");
  } finally {
    restoreFeedback();
  }
});

test("universal-hook: gemini-cli defaults hookEventName to BeforeAgent when no nativeEvent is passed", () => {
  clearFeedback();
  try {
    const stdout = runHook(["--host", "gemini-cli", "--event", "user_prompt"], {
      prompt: "search codebase for the word foo",
    });
    assert.ok(stdout);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.hookSpecificOutput.hookEventName, "BeforeAgent");
  } finally {
    restoreFeedback();
  }
});

test("actionDirective: skill on claude-code names the Skill tool by id", () => {
  const directive = actionDirective({ kind: "skill", id: "workspace-surface-audit", pointer: "/some/path" }, "claude-code");
  assert.match(directive, /Skill tool/);
  assert.match(directive, /"workspace-surface-audit"/);
});

test("actionDirective: skill on a non-claude-code host falls back to reading the pointer", () => {
  const directive = actionDirective({ kind: "skill", id: "workspace-surface-audit", pointer: "/some/path" }, "gemini-cli");
  assert.doesNotMatch(directive, /Skill tool/);
  assert.match(directive, /\/some\/path/);
});

test("actionDirective: mcp on claude-code gives the mcp__<id>__ prefix and a ToolSearch fallback", () => {
  const directive = actionDirective({ kind: "tool", type: "mcp", id: "playwright", pointer: "@playwright/mcp@latest" }, "claude-code");
  assert.match(directive, /mcp__playwright__/);
  assert.match(directive, /ToolSearch/);
});

test("actionDirective: mcp on a non-claude-code host stays generic, no invented syntax", () => {
  const directive = actionDirective({ kind: "tool", type: "mcp", id: "playwright", pointer: "@playwright/mcp@latest" }, "codex");
  assert.doesNotMatch(directive, /mcp__/);
});

test("actionDirective: agent on claude-code names the Agent tool by subagent_type", () => {
  const directive = actionDirective({ kind: "agent", id: "e2e-runner", pointer: "/agents/e2e-runner.md" }, "claude-code");
  assert.match(directive, /Agent tool/);
  assert.match(directive, /"e2e-runner"/);
});

test("actionDirective: cli surfaces the pointer as a runnable command", () => {
  const directive = actionDirective({ kind: "tool", type: "cli", id: "ripgrep", pointer: "mise exec -- ripgrep" }, "claude-code");
  assert.match(directive, /mise exec -- ripgrep/);
});

test("resolveId: a CLI binary name with a regex metacharacter still matches its own command", () => {
  // "." is unescaped-regex "any character" - a dot-containing name sitting
  // between word characters (unlike a trailing "g++") still hits \b on
  // both sides, so this exercises the escaping fix without the separate,
  // pre-existing \b-at-a-symbol-edge limitation (word boundaries don't
  // fire between two non-word characters, e.g. "+" then a space - a
  // different, lower-priority gap left as-is since no registered CLI name
  // ends in a symbol today).
  const index = {
    entries: [{ id: "foo-dot-bar", type: "cli", source: "foo.bar", route: {} }],
  };
  assert.doesNotThrow(() => {
    const id = resolveId(index, "Bash", { command: "foo.bar --version" });
    assert.equal(id, "foo-dot-bar");
  });
});

test("resolveId: an unescaped '.' would false-match a lookalike command; escaped it does not", () => {
  const index = {
    entries: [{ id: "foo-dot-bar", type: "cli", source: "foo.bar", route: {} }],
  };
  // Unescaped, "." in the regex means "any character" - "fooXbar" would
  // wrongly match a binary named "foo.bar". Escaped, it correctly doesn't.
  const id = resolveId(index, "Bash", { command: "run fooXbar now" });
  assert.equal(id, null);
});

test("universal-hook: user_prompt stays silent on a harness-generated task-notification payload", () => {
  clearFeedback();
  try {
    // Real shape from a live session: a background-task completion notice
    // that arrives through UserPromptSubmit. Long enough and vocabulary-rich
    // enough that it WOULD route (21/26 historical suggested events were
    // exactly this) - only the synthetic-prompt gate keeps it silent.
    const stdout = runHook(
      ["--host", "claude-code", "--event", "user_prompt", "--nativeEvent", "UserPromptSubmit"],
      {
        prompt:
          "<task-notification>\n<task-id>b9ugezqg8</task-id>\n<summary>Background command \"search codebase for the word foo\" completed (exit code 0)</summary>\n</task-notification>",
      },
    );
    assert.equal(stdout, "");
    assert.ok(!existsSync(FEEDBACK_PATH), "no suggested events should be logged for synthetic prompts");
  } finally {
    restoreFeedback();
  }
});

test("universal-hook: post_tool with the Skill tool logs a used event for the skill id", () => {
  clearFeedback();
  try {
    runHook(["--host", "claude-code", "--event", "post_tool"], {
      tool_name: "Skill",
      tool_input: { skill: "workspace-surface-audit" },
    });
    assert.ok(existsSync(FEEDBACK_PATH));
    const contents = readFileSync(FEEDBACK_PATH, "utf8");
    assert.ok(contents.includes('"type":"used"'));
    assert.ok(contents.includes('"id":"workspace-surface-audit"'));
  } finally {
    restoreFeedback();
  }
});

test("resolveId: a plugin-namespaced Skill invocation matches the plain-slug registry id", () => {
  const index = {
    entries: [{ id: "code-review", type: "skill", route: {} }],
  };
  assert.equal(resolveId(index, "Skill", { skill: "ecc:code-review" }), "code-review");
});

test("resolveId: an Agent invocation matches an agent entry by subagent_type, not a same-named skill", () => {
  const index = {
    entries: [
      { id: "e2e-runner", type: "skill", route: {} },
      { id: "e2e-runner", type: "agent", route: {} },
    ],
  };
  // Both exist; the Agent tool must attribute to the agent-type entry.
  const id = resolveId(index, "Agent", { subagent_type: "ecc:e2e-runner" });
  assert.equal(id, "e2e-runner");
  // And an id that only exists as a skill must NOT match via the Agent tool.
  const skillOnly = { entries: [{ id: "pdf", type: "skill", route: {} }] };
  assert.equal(resolveId(skillOnly, "Agent", { subagent_type: "pdf" }), null);
});

test("universal-hook: post_tool with an mcp__<id>__ tool name logs a used event for that id", () => {
  clearFeedback();
  try {
    runHook(["--host", "claude-code", "--event", "post_tool"], {
      tool_name: "mcp__context7__resolve-library-id",
      tool_input: {},
    });
    assert.ok(existsSync(FEEDBACK_PATH));
    const contents = readFileSync(FEEDBACK_PATH, "utf8");
    assert.ok(contents.includes('"type":"used"'));
    assert.ok(contents.includes('"id":"context7"'));
  } finally {
    restoreFeedback();
  }
});
