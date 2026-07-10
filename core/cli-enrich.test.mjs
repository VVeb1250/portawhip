import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCliEnrichment,
  fetchJsonGuarded,
  packageMetaUrl,
  parseMiseRegistry,
  parsePackageMeta,
  parseSubcommands,
  parseTldr,
  pickBackend,
  tldrUrls,
} from "./cli-enrich.mjs";

test("parseMiseRegistry: name -> backend tokens, blank/short lines skipped", () => {
  const map = parseMiseRegistry("ripgrep  aqua:BurntSushi/ripgrep cargo:ripgrep\n\nrust core:rust\nbad-no-tokens\n");
  assert.deepEqual(map.get("ripgrep"), ["aqua:BurntSushi/ripgrep", "cargo:ripgrep"]);
  assert.deepEqual(map.get("rust"), ["core:rust"]);
  assert.equal(map.has("bad-no-tokens"), false);
});

test("pickBackend: honors priority (npm>cargo>aqua) and skips unfetchable", () => {
  assert.deepEqual(pickBackend(["aqua:x/y", "cargo:z", "npm:@a/b"]), { backend: "npm", pkg: "@a/b" });
  assert.deepEqual(pickBackend(["core:rust"]), null);
  assert.deepEqual(pickBackend(["aqua:BurntSushi/ripgrep", "cargo:ripgrep"]), {
    backend: "cargo",
    pkg: "ripgrep",
  });
});

test("packageMetaUrl: per-ecosystem endpoints, github for aqua/github/go", () => {
  assert.equal(packageMetaUrl("npm", "amp").kind, "npm");
  assert.equal(packageMetaUrl("pipx", "ruff").url, "https://pypi.org/pypi/ruff/json");
  assert.equal(packageMetaUrl("cargo", "ripgrep").url, "https://crates.io/api/v1/crates/ripgrep");
  assert.equal(packageMetaUrl("aqua", "BurntSushi/ripgrep").url, "https://api.github.com/repos/BurntSushi/ripgrep");
  assert.equal(packageMetaUrl("go", "github.com/rhysd/actionlint/cmd/actionlint").url, "https://api.github.com/repos/rhysd/actionlint");
  assert.equal(packageMetaUrl("core", "rust"), null);
});

test("parsePackageMeta: reads each registry shape", () => {
  assert.deepEqual(parsePackageMeta("npm", { description: "Fast CLI", keywords: ["Cli", "fast"] }), {
    description: "Fast CLI",
    keywords: ["cli", "fast"],
  });
  assert.equal(parsePackageMeta("pypi", { info: { summary: "A linter", keywords: "lint,python" } }).keywords.length, 2);
  assert.equal(parsePackageMeta("crates", { crate: { description: "grep", keywords: ["search"] } }).description, "grep");
  assert.equal(parsePackageMeta("github", { description: "tool", topics: ["cli"] }).description, "tool");
  assert.equal(parsePackageMeta("npm", { description: "", keywords: [] }), null);
});

test("tldrUrls: common first, then platform dir", () => {
  const urls = tldrUrls("rg", "win32");
  assert.match(urls[0], /pages\/common\/rg\.md$/);
  assert.match(urls[1], /pages\/windows\/rg\.md$/);
});

test("parseTldr: extracts summary and lowercased example phrases", () => {
  const md = `# rg

> Search for patterns using regex.
> More information: https://example.com.

- Recursively search for a pattern:

\`rg {{pattern}}\`

- Search a specific file type:

\`rg -t {{py}} {{pattern}}\``;
  const out = parseTldr(md);
  assert.equal(out.summary, "Search for patterns using regex.");
  assert.deepEqual(out.examples, ["recursively search for a pattern", "search a specific file type"]);
});

test("parseSubcommands: harvests a Commands: section, stops at dedent", () => {
  const help = `Usage: tool [cmd]

Commands:
  gain     show savings
  discover analyze history
  proxy    run raw

Options:
  --help`;
  assert.deepEqual(parseSubcommands(help), ["gain", "discover", "proxy"]);
  assert.deepEqual(parseSubcommands("no commands here"), []);
});

test("buildCliEnrichment: merges sources, description quality order, provenance", () => {
  const out = buildCliEnrichment("rg", "rg", {
    pkgMeta: { description: "ripgrep recursively searches", keywords: ["grep", "search"] },
    tldr: { summary: "Search files", examples: ["recursively search for a pattern"] },
    helpLine: "usage banner",
    subcommands: [],
  });
  assert.match(out.description, /ripgrep recursively searches/);
  assert.equal(out.sources.description, "package");
  assert.ok(out.triggers.includes("rg"));
  assert.ok(out.triggers.includes("grep"));
  assert.ok(out.triggers.includes("recursively search for a pattern"));
  assert.ok(out.sources.triggers.includes("tldr-examples"));
});

test("buildCliEnrichment: nothing usable -> null (anti-junk gate)", () => {
  assert.equal(buildCliEnrichment("obscure", "obscure", {}), null);
  // a lone name with no description and no extra triggers is held back
  assert.equal(buildCliEnrichment("x", "x", { subcommands: [] }), null);
});

test("fetchJsonGuarded: injected fetch, bad JSON and !ok fail-open to null", async () => {
  const okJson = await fetchJsonGuarded("u", { fetchImpl: async () => ({ ok: true, text: async () => '{"a":1}' }) });
  assert.deepEqual(okJson, { a: 1 });
  const bad = await fetchJsonGuarded("u", { fetchImpl: async () => ({ ok: true, text: async () => "not json" }) });
  assert.equal(bad, null);
  const notOk = await fetchJsonGuarded("u", { fetchImpl: async () => ({ ok: false }) });
  assert.equal(notOk, null);
  const threw = await fetchJsonGuarded("u", { fetchImpl: async () => { throw new Error("net"); } });
  assert.equal(threw, null);
});
