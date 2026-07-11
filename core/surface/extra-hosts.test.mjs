import { test } from "node:test";
import assert from "node:assert/strict";
import { EXTRA_HOSTS, detectExtraHosts, extraHostSupports } from "./extra-hosts.mjs";

test("EXTRA_HOSTS: each entry has presence paths, a surface map, and a source", () => {
  for (const [id, def] of Object.entries(EXTRA_HOSTS)) {
    assert.ok(Array.isArray(def.present) && def.present.length, `${id} has presence paths`);
    assert.equal(typeof def.surfaces, "object", `${id} has surfaces`);
    assert.match(def.source, /^https?:\/\//, `${id} cites a source URL`);
  }
});

test("extraHostSupports: reads the per-host surface map", () => {
  assert.equal(extraHostSupports("pi", "instructions"), true);
  assert.equal(extraHostSupports("pi", "agents"), false); // no native subagents
  assert.equal(extraHostSupports("amp", "mcp"), true);
  assert.equal(extraHostSupports("nope", "instructions"), false);
});

test("detectExtraHosts: returns an array of only present hosts (subset of catalog)", () => {
  const present = detectExtraHosts();
  assert.ok(Array.isArray(present));
  for (const id of present) assert.ok(EXTRA_HOSTS[id], `${id} is a catalogued host`);
});
