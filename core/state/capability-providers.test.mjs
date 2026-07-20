import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

import { PROVIDER_SPECIFIERS, loadProviders } from "./capability-providers.mjs";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const HOOK = join(ROOT, "adapters", "hooks", "universal-hook.mjs");
// portawhip tests the seam, never a particular capability — see the fixture's
// own header for why.
const FIXTURE = pathToFileURL(join(ROOT, "core", "fixtures", "test-provider.mjs")).href;
const WITH_FIXTURE = { PORTAWHIP_EXTRA_PROVIDERS: `fixture=${FIXTURE}` };

test("a provider that is not installed is an absence, not an error", async () => {
  const errors = [];
  const providers = await loadProviders({
    registry: { ghost: ["portawhip-nonexistent/provider", "./does-not-exist.mjs"] },
    onError: (event) => errors.push(event),
    env: {},
  });
  assert.deepEqual(providers, []);
  assert.deepEqual(errors, [], "a missing provider must never be reported as a fault");
});

// The inverse matters just as much: an installed provider that throws on import
// is a broken install, and a harness that quietly does less than it advertises
// is worse than one that complains.
test("a provider that is installed but broken is reported, not swallowed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "portawhip-provider-"));
  const broken = join(dir, "broken-provider.mjs");
  writeFileSync(broken, "throw new Error('provider blew up on import');\n");
  const errors = [];
  try {
    const providers = await loadProviders({
      // An absolute path is only a valid ESM specifier as a file:// URL on
      // Windows; real specifiers are bare package names or relative paths.
      registry: { broken: [pathToFileURL(broken).href] },
      onError: (event) => errors.push(event),
      env: {},
    });
    assert.deepEqual(providers, []);
    assert.equal(errors.length, 1);
    assert.match(errors[0].error.message, /provider blew up on import/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the router is looked up as a package first, then in-repo", () => {
  assert.deepEqual(PROVIDER_SPECIFIERS.router, ["portawhip-router/provider", "../router/provider.mjs"]);
});

test("PORTAWHIP_EXTRA_PROVIDERS registers a provider that is not built in", async () => {
  const providers = await loadProviders({ env: WITH_FIXTURE });
  const fixture = providers.find((provider) => provider.name === "fixture");
  assert.ok(fixture, "the fixture provider should have been registered from the environment");
  assert.equal(fixture.module.configSchema.id, "fixture");
  assert.equal(typeof fixture.module.hooks.onUserPrompt, "function");
});

// Asserted by name, not by count: whether a real provider is also installed
// alongside the fixture depends on the machine, and a count would make this
// pass or fail on that rather than on the disabling itself.
test("providers can be disabled by name, or all at once", async () => {
  const names = async (disable) =>
    (await loadProviders({ env: { ...WITH_FIXTURE, PORTAWHIP_DISABLE_PROVIDERS: disable } }))
      .map((provider) => provider.name);

  assert.deepEqual(await names("all"), []);
  assert.ok(!(await names("fixture")).includes("fixture"));
  assert.ok((await names("something-else")).includes("fixture"), "an unrelated name must disable nothing");
});

function runHook(event, payload, env = {}) {
  return spawnSync(process.execPath, [HOOK, "--host", "claude-code", "--event", event], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, PORTAWHIP_DISABLE_PROVIDERS: "router", ...env },
  });
}

// The point of the extraction: portawhip with no contributing provider is a
// working install. The hook must exit cleanly and print nothing at all — not a
// crash, not a warning, and not an empty JSON envelope a host would try to parse.
test("with no provider contributing, the hook stays silent and exits clean", () => {
  const result = runHook("user_prompt", { prompt: "fixture-please say something", cwd: ROOT });
  assert.equal(result.status, 0, "hook must exit 0 with no provider installed");
  assert.equal(result.stdout, "", "hook must emit nothing when no provider has anything to say");
  assert.equal(result.stderr, "", "an absent provider must not produce warnings");
});

test("a provider that has something to say reaches the host through the hook", () => {
  const result = runHook("user_prompt", { prompt: "fixture-please say something", cwd: ROOT }, WITH_FIXTURE);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(parsed.hookSpecificOutput.additionalContext, /fixture provider says hello to claude-code/);
});

test("the same provider stays silent on a prompt it has no opinion about", () => {
  const result = runHook("user_prompt", { prompt: "something entirely unrelated to it", cwd: ROOT }, WITH_FIXTURE);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "", "returning null must produce no output at all");
});
