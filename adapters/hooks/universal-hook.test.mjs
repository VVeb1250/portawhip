import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, rmSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Integration-level: runs the real hook as a subprocess against this
// repo's real recipe.yaml (same style as core/router.test.mjs's
// discovery tests, which already exercise the live machine state).
// Feedback events land in this repo's real .hp-state/feedback, so every
// test clears it first/after to avoid cross-test and cross-run pollution.

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const HOOK = join(ROOT, "adapters", "hooks", "universal-hook.mjs");
const FEEDBACK_PATH = join(ROOT, ".hp-state", "feedback", "events.jsonl");

function clearFeedback() {
  if (existsSync(FEEDBACK_PATH)) rmSync(FEEDBACK_PATH);
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
    clearFeedback();
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
    clearFeedback();
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
    clearFeedback();
  }
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
    clearFeedback();
  }
});
