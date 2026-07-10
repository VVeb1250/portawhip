import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCandidates,
  groupByType,
  isBare,
  mergeAgentsMcp,
  mergeImported,
  parseArgs,
  toRecipeEntry,
} from "./import-surfaces.mjs";

const disc = (id, type, extra = {}) => ({ id, type, source: id, route: { triggers: [id], description: `${type}: ${id}` }, ...extra });

test("parseArgs: apply without --apply is rejected", () => {
  assert.throws(() => parseArgs(["node", "import.mjs", "apply"]), /requires an explicit --apply/);
  assert.equal(parseArgs(["node", "import.mjs", "apply", "--apply"]).action, "apply");
});

test("computeCandidates: no filter = all surfaces, only known excluded", () => {
  const discovered = [disc("rg", "cli"), disc("srv", "mcp"), disc("pdf", "skill"), disc("dup", "cli")];
  const known = new Set(["dup"]);
  const out = computeCandidates({ discovered, known, types: null, include: null });
  assert.deepEqual(out.map((e) => e.id).sort(), ["pdf", "rg", "srv"]);
});

test("computeCandidates: --type narrows to the given surfaces", () => {
  const discovered = [disc("rg", "cli"), disc("srv", "mcp"), disc("pdf", "skill")];
  const out = computeCandidates({ discovered, known: new Set(), types: ["cli"], include: null });
  assert.deepEqual(out.map((e) => e.id), ["rg"]);
});

test("isBare: only-self triggers = bare; extra trigger = not bare", () => {
  assert.equal(isBare(disc("rg", "cli")), true);
  assert.equal(isBare({ id: "rg", source: "ripgrep", type: "cli", route: { triggers: ["rg", "search"] } }), false);
});

test("groupByType: buckets ids by surface", () => {
  const g = groupByType([{ id: "a", type: "cli" }, { id: "b", type: "cli" }, { id: "c", type: "mcp" }]);
  assert.deepEqual(g, { cli: ["a", "b"], mcp: ["c"] });
});

test("toRecipeEntry: bare CLI with no enrichment is held back (null)", () => {
  assert.equal(toRecipeEntry(disc("rg", "cli"), null), null);
});

test("toRecipeEntry: enrichment promotes a bare CLI (triggers/desc win)", () => {
  const enr = { triggers: ["rg", "search", "grep"], description: "CLI tool: rg — fast search", sources: { description: "package" } };
  const entry = toRecipeEntry(disc("rg", "cli"), enr);
  assert.deepEqual(entry.route.triggers, ["rg", "search", "grep"]);
  assert.equal(entry.imported.enriched.description, "package");
});

test("toRecipeEntry: non-CLI keeps its discovered route, never gated", () => {
  const entry = toRecipeEntry(disc("pdf", "skill", { route: { triggers: ["pdf"], description: "PDF skill" } }), null);
  assert.ok(entry);
  assert.equal(entry.type, "skill");
});

test("computeCandidates: --include overrides the type filter and matches type:id", () => {
  const discovered = [disc("pdf", "skill"), disc("rg", "cli")];
  const known = new Set();
  assert.deepEqual(
    computeCandidates({ discovered, known, types: null, include: ["skill:pdf"] }).map((e) => e.id),
    ["pdf"],
  );
  assert.deepEqual(
    computeCandidates({ discovered, known, types: null, include: ["pdf"] }).map((e) => e.id),
    ["pdf"],
  );
});

test("toRecipeEntry: carries route + provenance, keeps path when present", () => {
  const entry = toRecipeEntry(disc("pdf", "skill", { path: "/x/pdf" }));
  assert.equal(entry.id, "pdf");
  assert.equal(entry.path, "/x/pdf");
  assert.equal(entry.imported.via, "discover:skill");
  assert.ok(entry.route.triggers.includes("pdf"));
});

test("mergeImported: existing wins on id, so re-apply is idempotent", () => {
  const existing = [{ id: "rg", type: "cli", note: "kept" }];
  const additions = [{ id: "rg", type: "cli", note: "new" }, { id: "jq", type: "cli" }];
  const merged = mergeImported(existing, additions);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((e) => e.id === "rg").note, "kept");
});

test("mergeAgentsMcp: adds stdio server with config, skips one with no recoverable config", () => {
  const agents = { schemaVersion: 3, mcp: { servers: { existing: {} } } };
  const entries = [disc("withcfg", "mcp"), disc("nocfg", "mcp"), disc("existing", "mcp")];
  const configs = { withcfg: { command: "node", args: ["x.js"] } };
  const { json, added } = mergeAgentsMcp(agents, entries, configs);
  assert.deepEqual(added, ["withcfg"]);
  assert.equal(json.mcp.servers.withcfg.transport, "stdio");
  assert.equal(json.mcp.servers.withcfg.command, "node");
  assert.ok(!json.mcp.servers.nocfg, "no-config server is not written");
  assert.ok(json.mcp.servers.existing, "pre-existing server untouched");
});

test("mergeAgentsMcp: http transport when config has url", () => {
  const { json, added } = mergeAgentsMcp(null, [disc("remote", "mcp")], { remote: { url: "https://x/y" } });
  assert.deepEqual(added, ["remote"]);
  assert.equal(json.mcp.servers.remote.transport, "http");
  assert.equal(json.mcp.servers.remote.url, "https://x/y");
});
