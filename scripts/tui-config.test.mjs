import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  CONFIG_SCOPES,
  appendConfigInput,
  collectConfigRows,
  draftForRow,
  nextChoiceDraft,
  runConfigWrite,
} from "./tui-config.mjs";
import { resolveSchema } from "../core/state/config.mjs";

// The settings tab renders whatever the installed providers declare, so these
// resolve the real schema rather than assuming a fixed key list.
const schema = await resolveSchema();

function fixtureRunner(calls) {
  return (argv) => {
    calls.push(argv);
    const scopeIndex = argv.indexOf("--scope");
    const scope = scopeIndex >= 0 ? argv[scopeIndex + 1] : "effective";
    const configs = {
      effective: { denseEnabled: true, autoSync: { throttleMinutes: 15 } },
      user: { denseEnabled: false },
      project: { autoSync: { throttleMinutes: 15 } },
    };
    return argv[0] === "list" ? { config: configs[scope] } : { action: argv[0], key: argv[1] };
  };
}

test("TUI settings rows show effective values and both override scopes", () => {
  const calls = [];
  const rows = collectConfigRows({ schema, runner: fixtureRunner(calls) });

  const dense = rows.find((row) => row.key === "denseEnabled");
  assert.equal(dense.effective, true);
  assert.equal(dense.user, false);
  assert.equal(dense.project, undefined);
  assert.equal(dense.source, "user");

  const throttle = rows.find((row) => row.key === "autoSync.throttleMinutes");
  assert.equal(throttle.effective, 15);
  assert.equal(throttle.project, 15);
  assert.equal(throttle.source, "project");
  assert.deepEqual(CONFIG_SCOPES, ["user", "project"]);
  assert.equal(calls.length, 3);
});

test("TUI edit drafts prefer the selected-scope override, then effective value", () => {
  const row = { effective: true, user: false, project: undefined };
  assert.equal(draftForRow(row, "user"), "false");
  assert.equal(draftForRow(row, "project"), "true");
});

test("TUI config writes delegate to the validated config command", () => {
  const calls = [];
  const runner = fixtureRunner(calls);

  runConfigWrite({ schema, action: "set", key: "denseEnabled", value: "false", scope: "project", runner });
  runConfigWrite({ schema, action: "unset", key: "denseEnabled", scope: "user", runner });

  assert.deepEqual(calls, [
    ["set", "denseEnabled", "false", "--scope", "project"],
    ["unset", "denseEnabled", "--scope", "user"],
  ]);
});

test("boolean and enum drafts cycle through valid choices without typing", () => {
  assert.equal(nextChoiceDraft("denseEnabled", "true", 1, { schema }), "false");
  assert.equal(nextChoiceDraft("denseEnabled", "false", -1, { schema }), "true");
  assert.equal(nextChoiceDraft("engine", "hybrid", 1, { schema }), "keyword");
  assert.equal(nextChoiceDraft("engine", "keyword", -1, { schema }), "hybrid");
});

test("numeric drafts accept only their numeric format", () => {
  assert.equal(appendConfigInput("k", "1", "2", { schema }), "12");
  assert.equal(appendConfigInput("k", "1", ".", { schema }), "1");
  assert.equal(appendConfigInput("k", "1", "x", { schema }), "1");

  assert.equal(appendConfigInput("denseThreshold", "0", ".", { schema }), "0.");
  assert.equal(appendConfigInput("denseThreshold", "0.", "5", { schema }), "0.5");
  assert.equal(appendConfigInput("denseThreshold", "0.5", ".", { schema }), "0.5");
  assert.equal(appendConfigInput("denseThreshold", "0.5", "x", { schema }), "0.5");
});

test("free-text drafts still accept path characters", () => {
  assert.equal(appendConfigInput("graphPath", "graphs", "/custom.json", { schema }), "graphs/custom.json");
});
test("interactive TUI exposes a settings tab and its key map", () => {
  const path = fileURLToPath(new URL("./tui.mjs", import.meta.url));
  const source = readFileSync(path, "utf8");
  assert.match(source, /const TABS = \[[^\]]*"settings"/);
  assert.match(source, /settings tab: g scope, e edit, u unset/);
});
test("every TUI setting explains its purpose and accepted value", () => {
  const rows = collectConfigRows({ schema, runner: fixtureRunner([]) });
  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => typeof row.description === "string" && row.description.length > 10));

  assert.equal(rows.find((row) => row.key === "engine").inputHint, "allowed: keyword | hybrid");
  assert.equal(rows.find((row) => row.key === "denseEnabled").inputHint, "allowed: false | true");
  assert.equal(rows.find((row) => row.key === "denseThreshold").inputHint, "range: 0 to 1");
  assert.equal(rows.find((row) => row.key === "k").inputHint, "minimum: 1");
});
