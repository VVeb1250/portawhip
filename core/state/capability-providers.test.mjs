import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

import { PROVIDER_SPECIFIERS, loadProviders } from "./capability-providers.mjs";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const HOOK = join(ROOT, "adapters", "hooks", "universal-hook.mjs");
const ROUTER_PROVIDER = join(ROOT, "core", "router", "provider.mjs");

test("a provider that is not installed is an absence, not an error", async () => {
  const errors = [];
  const providers = await loadProviders({
    registry: { ghost: ["portawhip-nonexistent/provider", "./does-not-exist.mjs"] },
    onError: (event) => errors.push(event),
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

test("the in-repo router provider resolves today", async () => {
  const providers = await loadProviders();
  const router = providers.find((provider) => provider.name === "router");
  assert.ok(router, "router provider should resolve while it still lives in this repo");
  assert.equal(typeof router.module.hooks.onUserPrompt, "function");
});

test("providers can be disabled by name, or all at once", async () => {
  assert.deepEqual(await loadProviders({ env: { PORTAWHIP_DISABLE_PROVIDERS: "all" } }), []);
  assert.deepEqual(await loadProviders({ env: { PORTAWHIP_DISABLE_PROVIDERS: "router" } }), []);
  assert.equal((await loadProviders({ env: { PORTAWHIP_DISABLE_PROVIDERS: "something-else" } })).length, 1);
});

// The whole point of the extraction: portawhip with no contributing provider is
// a working install. The hook must exit cleanly and print nothing at all — not
// a crash, not a warning, and not an empty JSON envelope a host would try to
// parse. Driven through the env switch rather than by moving files, so it
// cannot disturb tests running alongside it.
test("with no provider contributing, the hook stays silent and exits clean", () => {
  assert.ok(existsSync(ROUTER_PROVIDER), "sanity: the router provider is present in this repo");
  const result = spawnSync(
    process.execPath,
    [HOOK, "--host", "claude-code", "--event", "user_prompt"],
    {
      input: JSON.stringify({ prompt: "search codebase for the word foo", cwd: ROOT }),
      encoding: "utf8",
      env: { ...process.env, PORTAWHIP_PUSH_MODE: "legacy", PORTAWHIP_DISABLE_PROVIDERS: "all" },
    },
  );
  assert.equal(result.status, 0, "hook must exit 0 with no provider contributing");
  assert.equal(result.stdout, "", "hook must emit nothing when no provider has anything to say");
  assert.equal(result.stderr, "", "an absent provider must not produce warnings");
});
