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
import { FIXTURE_ENV } from "../core/fixtures/provider-env.mjs";

// The settings tab renders whatever the installed providers declare, so these
// resolve the real schema rather than assuming a fixed key list.
const schema = await resolveSchema({ env: FIXTURE_ENV });

function fixtureRunner(calls) {
  return (argv) => {
    calls.push(argv);
    const scopeIndex = argv.indexOf("--scope");
    const scope = scopeIndex >= 0 ? argv[scopeIndex + 1] : "effective";
    const configs = {
      effective: { fixtureEnabled: true, autoSync: { throttleMinutes: 15 } },
      user: { fixtureEnabled: false },
      project: { autoSync: { throttleMinutes: 15 } },
    };
    return argv[0] === "list" ? { config: configs[scope] } : { action: argv[0], key: argv[1] };
  };
}

test("TUI settings rows show effective values and both override scopes", () => {
  const calls = [];
  const rows = collectConfigRows({ schema, runner: fixtureRunner(calls) });

  const dense = rows.find((row) => row.key === "fixtureEnabled");
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

  runConfigWrite({ schema, action: "set", key: "fixtureEnabled", value: "false", scope: "project", runner });
  runConfigWrite({ schema, action: "unset", key: "fixtureEnabled", scope: "user", runner });

  assert.deepEqual(calls, [
    ["set", "fixtureEnabled", "false", "--scope", "project"],
    ["unset", "fixtureEnabled", "--scope", "user"],
  ]);
});

test("boolean and enum drafts cycle through valid choices without typing", () => {
  assert.equal(nextChoiceDraft("fixtureEnabled", "true", 1, { schema }), "false");
  assert.equal(nextChoiceDraft("fixtureEnabled", "false", -1, { schema }), "true");
  assert.equal(nextChoiceDraft("fixtureMode", "quiet", 1, { schema }), "loud");
  assert.equal(nextChoiceDraft("fixtureMode", "loud", -1, { schema }), "quiet");
});

test("numeric drafts accept only their numeric format", () => {
  assert.equal(appendConfigInput("fixtureBudget", "1", "2", { schema }), "12");
  assert.equal(appendConfigInput("fixtureBudget", "1", ".", { schema }), "1");
  assert.equal(appendConfigInput("fixtureBudget", "1", "x", { schema }), "1");

  assert.equal(appendConfigInput("fixtureRatio", "0", ".", { schema }), "0.");
  assert.equal(appendConfigInput("fixtureRatio", "0.", "5", { schema }), "0.5");
  assert.equal(appendConfigInput("fixtureRatio", "0.5", ".", { schema }), "0.5");
  assert.equal(appendConfigInput("fixtureRatio", "0.5", "x", { schema }), "0.5");
});

test("free-text drafts still accept path characters", () => {
  assert.equal(appendConfigInput("fixturePath", "graphs", "/custom.json", { schema }), "graphs/custom.json");
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

  assert.equal(rows.find((row) => row.key === "fixtureMode").inputHint, "allowed: quiet | loud");
  assert.equal(rows.find((row) => row.key === "fixtureEnabled").inputHint, "allowed: false | true");
  assert.equal(rows.find((row) => row.key === "fixtureRatio").inputHint, "range: 0 to 1");
  assert.equal(rows.find((row) => row.key === "fixtureBudget").inputHint, "range: 1 to 1000");
});
