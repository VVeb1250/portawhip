import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// portawhip collects capabilities; other packages consume what it collected.
// The router is the first such consumer, and this is the surface it needs. The
// exports map is what makes that a contract rather than a set of deep relative
// paths that break on any internal move — so the map and the symbols behind it
// are pinned here.
//
// Adding to this list is a deliberate act: it widens what portawhip promises to
// keep working. Removing from it is a breaking change.
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const PUBLIC_API = {
  "./registry": ["buildIndex", "loadIndex", "readCachedIndex", "readRawEntries", "mergeRawEntries"],
  "./registry/docs": ["buildCapabilityDocs", "pointerFor"],
  "./registry/kind": ["capabilityKind", "matchesSuggestKind"],
  "./registry/enrich": ["runEnrichment", "DEFAULT_CACHE_PATH"],
  "./state/config": ["loadRuntimeConfig", "loadConfig", "HARNESS_SCHEMA", "mergeSchemas", "resolveSchema"],
  "./state/stack-detect": ["stackFactors", "combineFactors"],
  "./state/bundle-state": ["readActiveSelection", "resolveRecipePaths"],
};

test("the exports map declares exactly the documented public surface", () => {
  const declared = Object.keys(packageJson.exports ?? {}).filter((key) => key !== "./package.json");
  assert.deepEqual(declared.sort(), Object.keys(PUBLIC_API).sort());
});

for (const [subpath, symbols] of Object.entries(PUBLIC_API)) {
  test(`public API ${subpath} resolves and exports its documented symbols`, async () => {
    const target = packageJson.exports[subpath];
    assert.ok(target, `${subpath} is not in the exports map`);
    const module = await import(new URL(`.${target.slice(1)}`, new URL("../", import.meta.url)));
    for (const symbol of symbols) {
      assert.ok(symbol in module, `${subpath} no longer exports ${symbol}`);
    }
  });
}

// Anything reachable only by deep relative path is internal, and a consumer
// reaching for it is a bug we want to hear about at import time.
test("the router's own modules are not part of the public surface", () => {
  const targets = Object.values(packageJson.exports ?? {});
  assert.ok(
    !targets.some((target) => target.includes("core/router/")),
    "core/router/ must not be exported: it is a separate package, not portawhip's API",
  );
});
