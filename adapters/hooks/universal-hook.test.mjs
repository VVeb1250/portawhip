import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { resolveId } from "./universal-hook.mjs";

// The hook owns the host side of the contract: which event, which payload
// shape, how additionalContext is framed, and matching a tool call back to a
// registry entry. It owns no opinion about what should be said — that comes
// from a provider. So these drive it with the fixture provider rather than a
// real capability; what a particular provider chooses to say is that
// provider's test to write. See core/fixtures/test-provider.mjs.
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const HOOK = join(ROOT, "adapters", "hooks", "universal-hook.mjs");
const FIXTURE = pathToFileURL(join(ROOT, "core", "fixtures", "test-provider.mjs")).href;

function runHook(args, payload, { env = {} } = {}) {
  const result = spawnSync(process.execPath, [HOOK, ...args], {
    input: JSON.stringify(payload ?? {}),
    encoding: "utf8",
    cwd: ROOT,
    env: {
      ...process.env,
      // Real providers are excluded so this suite never depends on what happens
      // to be installed, and never writes to the live feedback log.
      PORTAWHIP_DISABLE_PROVIDERS: "router",
      PORTAWHIP_EXTRA_PROVIDERS: `fixture=${FIXTURE}`,
      ...env,
    },
  });
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim(), status: result.status };
}

function contextFrom(stdout) {
  return JSON.parse(stdout).hookSpecificOutput;
}

test("universal-hook: a provider's text reaches the host as additionalContext", () => {
  const { stdout, status } = runHook(
    ["--host", "claude-code", "--event", "user_prompt"],
    { prompt: "fixture-please respond to this" },
  );
  assert.equal(status, 0);
  const output = contextFrom(stdout);
  assert.equal(output.hookEventName, "UserPromptSubmit");
  assert.match(output.additionalContext, /fixture provider says hello to claude-code/);
});

// Host event names are not interchangeable; a wrong one is silently ignored by
// the host, which looks exactly like "the hook did not fire".
test("universal-hook: gemini-cli defaults hookEventName to BeforeAgent when no nativeEvent is passed", () => {
  const { stdout } = runHook(
    ["--host", "gemini-cli", "--event", "user_prompt"],
    { prompt: "fixture-please respond to this" },
  );
  assert.equal(contextFrom(stdout).hookEventName, "BeforeAgent");
});

test("universal-hook: an explicit nativeEvent wins over the host default", () => {
  const { stdout } = runHook(
    ["--host", "gemini-cli", "--event", "user_prompt", "--nativeEvent", "CustomEvent"],
    { prompt: "fixture-please respond to this" },
  );
  assert.equal(contextFrom(stdout).hookEventName, "CustomEvent");
});

test("universal-hook: the host is passed through to the provider", () => {
  const { stdout } = runHook(
    ["--host", "codex", "--event", "user_prompt"],
    { prompt: "fixture-please respond to this" },
  );
  assert.match(contextFrom(stdout).additionalContext, /hello to codex/);
});

test("universal-hook: an empty prompt never reaches a provider", () => {
  const { stdout, status } = runHook(["--host", "claude-code", "--event", "user_prompt"], { prompt: "   " });
  assert.equal(status, 0);
  assert.equal(stdout, "");
});

test("universal-hook: a provider returning null produces no output at all", () => {
  const { stdout } = runHook(
    ["--host", "claude-code", "--event", "user_prompt"],
    { prompt: "a prompt the fixture has no opinion about" },
  );
  assert.equal(stdout, "", "silence must be silence, not an empty envelope");
});

// post_tool: the harness resolves the registry entry and hands it over, so this
// asserts the match reached the provider — not what the provider said about it.
test("universal-hook: post_tool matches a Skill invocation and tells the provider", () => {
  const { stdout } = runHook(
    ["--host", "claude-code", "--event", "post_tool"],
    { tool_name: "Skill", tool_input: { skill: "pdf" } },
  );
  assert.match(contextFrom(stdout).additionalContext, /noticed Skill matched pdf/);
});

test("universal-hook: post_tool matches an mcp__<id>__ tool name", () => {
  const { stdout } = runHook(
    ["--host", "claude-code", "--event", "post_tool"],
    { tool_name: "mcp__playwright__browser_click", tool_input: {} },
  );
  assert.match(contextFrom(stdout).additionalContext, /matched playwright/);
});

test("universal-hook: post_tool on an unmatched tool stays silent", () => {
  const { stdout } = runHook(
    ["--host", "claude-code", "--event", "post_tool"],
    { tool_name: "Read", tool_input: { file_path: "/nowhere/at/all.txt" } },
  );
  assert.equal(stdout, "");
});

// A provider that throws must not take the hook down with it: hooks fail open
// by contract, because a harness bug must never block the user's prompt.
test("universal-hook: a provider that throws is reported but does not break the hook", () => {
  const { status, stderr } = runHook(
    ["--host", "claude-code", "--event", "user_prompt"],
    { prompt: "fixture-please respond to this" },
    { PORTAWHIP_EXTRA_PROVIDERS: "broken=./does/not/resolve/anywhere.mjs" },
  );
  assert.equal(status, 0, "the hook must still exit cleanly");
  assert.equal(stderr, "", "an unresolvable provider is an absence, not a fault");
});

const INDEX = {
  entries: [
    { id: "code-review", type: "skill", path: "skills/code-review" },
    { id: "e2e-runner", type: "agent" },
    { id: "playwright", type: "mcp" },
  ],
};

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

test("resolveId: a plugin-namespaced Skill invocation matches the plain-slug registry id", () => {
  assert.equal(resolveId(INDEX, "Skill", { skill: "ecc:code-review" }), "code-review");
});

test("resolveId: an Agent invocation matches an agent entry by subagent_type, not a same-named skill", () => {
  assert.equal(resolveId(INDEX, "Agent", { subagent_type: "e2e-runner" }), "e2e-runner");
  assert.equal(resolveId(INDEX, "Skill", { skill: "e2e-runner" }), null);
});

test("resolveId: an mcp__<id>__ tool name resolves only to an mcp entry", () => {
  assert.equal(resolveId(INDEX, "mcp__playwright__browser_click", {}), "playwright");
  assert.equal(resolveId(INDEX, "mcp__code-review__x", {}), null);
});
