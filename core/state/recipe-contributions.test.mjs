import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { recipeEntriesFromProviders } from "./recipe-contributions.mjs";
import { buildIndex } from "../registry/registry.mjs";
import { FIXTURE_ENV } from "../fixtures/provider-env.mjs";

const CONTRIBUTED = [
  {
    id: "fixture-server",
    type: "mcp",
    source: "fixture-provider",
    route: {
      description: "A capability contributed by a provider, for tests",
      triggers: ["fixture server", "contributed capability"],
    },
  },
];

function recipeFixture(body) {
  const root = mkdtempSync(join(tmpdir(), "portawhip-contrib-"));
  const path = join(root, "recipe.yaml");
  writeFileSync(path, body);
  return { root, path };
}

const MINIMAL_RECIPE = [
  "- id: local-only",
  "  type: cli",
  "  source: local-only",
  "  route:",
  "    description: An entry the project itself declares",
  "    triggers: [local only]",
  "",
].join("\n");

test("a provider's entries reach the index", async () => {
  const { root, path } = recipeFixture(MINIMAL_RECIPE);
  try {
    const index = await buildIndex(path, { discover: false, providerEntries: CONTRIBUTED });
    const entry = index.entries.find((e) => e.id === "fixture-server");
    assert.ok(entry, "the contributed entry should be in the index");
    assert.equal(entry.type, "mcp");
    assert.ok(index.entries.some((e) => e.id === "local-only"), "the project's own entries survive");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The bundle gate drops entries discovery cannot independently confirm, because
// opting into a bundle is not the same as installing it. A provider is
// different: it ships what it declares, so requiring discovery would mean the
// entry only appears once the user has already wired it by hand — the exact
// problem this mechanism removes.
test("a contributed entry is not gated behind discovery", async () => {
  const { root, path } = recipeFixture(MINIMAL_RECIPE);
  try {
    const index = await buildIndex(path, { discover: true, providerEntries: CONTRIBUTED });
    assert.ok(
      index.entries.some((e) => e.id === "fixture-server"),
      "installing the provider is itself the confirmation the gate wants",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("provenance survives into the index", async () => {
  const { root, path } = recipeFixture(MINIMAL_RECIPE);
  try {
    const index = await buildIndex(path, {
      discover: false,
      providerEntries: CONTRIBUTED.map((entry) => ({ ...entry, origin: "provider:fixture" })),
    });
    assert.equal(index.entries.find((e) => e.id === "fixture-server").origin, "provider:fixture");
    assert.equal(index.entries.find((e) => e.id === "local-only").origin, "recipe");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Precedence: providers declare a capability, the project keeps the last word
// on how it is described.
test("the project's recipe overrides a contributed entry of the same id", async () => {
  const { root, path } = recipeFixture([
    "- id: fixture-server",
    "  type: mcp",
    "  source: overridden-by-project",
    "  route:",
    "    description: The project's own description wins",
    "    triggers: [fixture server]",
    "",
  ].join("\n"));
  try {
    const index = await buildIndex(path, { discover: false, providerEntries: CONTRIBUTED });
    const entry = index.entries.find((e) => e.id === "fixture-server");
    assert.equal(entry.source, "overridden-by-project");
    assert.equal(entry.origin, "recipe");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// A broken contribution must name its source. Without that, a malformed entry
// reads as a fault in the project's own recipe.yaml and gets debugged there.
test("a malformed contribution names the provider that supplied it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "portawhip-bad-provider-"));
  const modulePath = join(dir, "bad-provider.mjs");
  writeFileSync(modulePath, 'export const recipe = [{ type: "mcp", source: "nameless" }];\n');
  try {
    await assert.rejects(
      () => recipeEntriesFromProviders({
        registry: { impostor: [pathToFileURL(modulePath).href] },
        env: {},
      }),
      /provider "impostor" contributed a malformed recipe entry/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no providers installed means no contributed entries", async () => {
  assert.deepEqual(await recipeEntriesFromProviders({ env: { PORTAWHIP_DISABLE_PROVIDERS: "all" } }), []);
});

test("the fixture provider contributes nothing, and that is not an error", async () => {
  // core/fixtures/test-provider.mjs deliberately exports no `recipe`, proving a
  // provider may implement only the parts of the contract it needs.
  assert.deepEqual(await recipeEntriesFromProviders({ env: FIXTURE_ENV }), []);
});
