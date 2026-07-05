import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { firstMeaningfulLine, cliBinary, readEnrichmentCache } from "./enrich.mjs";

// enrichMcp/enrichCli/runEnrichment do real IO (spawn processes, connect to
// MCP servers) and are deliberately NOT unit-tested here — same boundary
// core/discover.mjs's own discoverMcp/discoverCli already draw (router.test.mjs
// only covers the filesystem-scan discovery functions). Verified live instead
// via `node core/router-cli.mjs enrich` against real installed tools.

test("firstMeaningfulLine: accepts a real one-line description", () => {
  assert.equal(
    firstMeaningfulLine("Biome official CLI. Use it to check the health of your project."),
    "Biome official CLI. Use it to check the health of your project.",
  );
});

test("firstMeaningfulLine: rejects a Usage: line", () => {
  assert.equal(firstMeaningfulLine("Usage: node [options] [script.js]"), null);
});

test("firstMeaningfulLine: rejects a bare version+author banner", () => {
  assert.equal(firstMeaningfulLine("ripgrep 15.1.0 (rev af60c2de9d)\nAndrew Gallant"), null);
});

test("firstMeaningfulLine: rejects a .exe usage line", () => {
  assert.equal(firstMeaningfulLine("pandoc.exe [OPTIONS] [FILES]"), null);
});

test("firstMeaningfulLine: skips blank lines to find the first real content", () => {
  assert.equal(firstMeaningfulLine("\n\nA command-line benchmarking tool.\nUsage: ..."), "A command-line benchmarking tool.");
});

test("cliBinary: strips a pipx: backend prefix", () => {
  assert.equal(cliBinary("pipx:markitdown"), "markitdown");
});

test("cliBinary: passes a plain name through unchanged", () => {
  assert.equal(cliBinary("ripgrep"), "ripgrep");
});

test("readEnrichmentCache: missing file returns empty object, not an error", () => {
  const dir = mkdtempSync(join(tmpdir(), "enrich-cache-test-"));
  try {
    const cache = readEnrichmentCache(join(dir, "does-not-exist.json"));
    assert.deepEqual(cache, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
