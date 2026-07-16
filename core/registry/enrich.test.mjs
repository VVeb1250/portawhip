import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  firstMeaningfulLine,
  cliBinary,
  readEnrichmentCache,
  mcpEnrichmentFrom,
  cliEnrichmentFrom,
} from "./enrich.mjs";

// enrichMcp/enrichCli/runEnrichment do real IO (spawn processes, connect to
// MCP servers) and are deliberately NOT unit-tested here — same boundary
// core/discover.mjs's own discoverMcp/discoverCli already draw (router.test.mjs
// only covers the filesystem-scan discovery functions). Verified live instead
// via `node core/router-cli.mjs enrich` against real installed tools.
//
// mcpEnrichmentFrom is the exception: it is the pure tools/list -> route
// metadata formula, split out of that IO so the shape an enriched server ends
// up with is pinned here rather than only observable against a live server.

test("mcpEnrichmentFrom: triggers are the server name followed by its tool names", () => {
  const { triggers } = mcpEnrichmentFrom("github", [
    { name: "create_issue", description: "Create a new issue" },
    { name: "search_code", description: "Search code" },
  ]);
  assert.deepEqual(triggers, ["github", "create_issue", "search_code"]);
});

test("mcpEnrichmentFrom: description joins the first three tool descriptions", () => {
  const { description } = mcpEnrichmentFrom("github", [
    { name: "a", description: "Create a new issue" },
    { name: "b", description: "Search code" },
    { name: "c", description: "List commits" },
    { name: "d", description: "Never shown" },
  ]);
  assert.equal(description, "MCP server: github — Create a new issue; Search code; List commits");
});

test("mcpEnrichmentFrom: a server whose tools carry no descriptions falls back to naming them", () => {
  const { description } = mcpEnrichmentFrom("thing", [{ name: "do_stuff" }, { name: "do_more" }]);
  assert.equal(description, "MCP server: thing (tools: do_stuff, do_more)");
});

test("mcpEnrichmentFrom: a server with no tools at all still yields a bare-name description", () => {
  assert.deepEqual(mcpEnrichmentFrom("empty", []), {
    triggers: ["empty"],
    description: "MCP server: empty",
  });
});

test("mcpEnrichmentFrom: trigger and description caps hold", () => {
  const tools = Array.from({ length: 40 }, (_, i) => ({ name: `tool_${i}`, description: "x".repeat(200) }));
  const { triggers, description } = mcpEnrichmentFrom("big", tools);
  assert.equal(triggers.length, 20);
  assert.ok(description.length <= 300);
});

test("cliEnrichmentFrom: a CLI's triggers are only its own name", () => {
  // Pinning the known-thin case, not endorsing it: unlike an MCP server, a CLI
  // exposes no sub-tool names, so nothing but the binary name reaches the
  // trigger field and natural phrasing cannot match it. See this module's
  // header — enrichment carries the whole load through `description`.
  assert.deepEqual(cliEnrichmentFrom("ripgrep", "recursively search for a pattern").triggers, [
    "ripgrep",
    "ripgrep",
  ]);
  assert.deepEqual(cliEnrichmentFrom("pipx:markitdown", "convert files to markdown").triggers, [
    "pipx:markitdown",
    "markitdown",
  ]);
});

test("cliEnrichmentFrom: description is prefixed with the binary and capped", () => {
  assert.equal(
    cliEnrichmentFrom("jq", "Command-line JSON processor").description,
    "CLI tool: jq — Command-line JSON processor",
  );
  assert.ok(cliEnrichmentFrom("x", "y".repeat(500)).description.length <= 300);
});

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
