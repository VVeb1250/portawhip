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
  const rows = collectConfigRows({ runner: fixtureRunner(calls) });

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

  runConfigWrite({ action: "set", key: "denseEnabled", value: "false", scope: "project", runner });
  runConfigWrite({ action: "unset", key: "denseEnabled", scope: "user", runner });

  assert.deepEqual(calls, [
    ["set", "denseEnabled", "false", "--scope", "project"],
    ["unset", "denseEnabled", "--scope", "user"],
  ]);
});

test("boolean and enum drafts cycle through valid choices without typing", () => {
  assert.equal(nextChoiceDraft("denseEnabled", "true", 1), "false");
  assert.equal(nextChoiceDraft("denseEnabled", "false", -1), "true");
  assert.equal(nextChoiceDraft("engine", "hybrid", 1), "keyword");
  assert.equal(nextChoiceDraft("engine", "keyword", -1), "hybrid");
});

test("numeric drafts accept only their numeric format", () => {
  assert.equal(appendConfigInput("k", "1", "2"), "12");
  assert.equal(appendConfigInput("k", "1", "."), "1");
  assert.equal(appendConfigInput("k", "1", "x"), "1");

  assert.equal(appendConfigInput("denseThreshold", "0", "."), "0.");
  assert.equal(appendConfigInput("denseThreshold", "0.", "5"), "0.5");
  assert.equal(appendConfigInput("denseThreshold", "0.5", "."), "0.5");
  assert.equal(appendConfigInput("denseThreshold", "0.5", "x"), "0.5");
});

test("free-text drafts still accept path characters", () => {
  assert.equal(appendConfigInput("graphPath", "graphs", "/custom.json"), "graphs/custom.json");
});
test("interactive TUI exposes a settings tab and its key map", () => {
  const path = fileURLToPath(new URL("./tui.mjs", import.meta.url));
  const source = readFileSync(path, "utf8");
  assert.match(source, /const TABS = \[[^\]]*"settings"/);
  assert.match(source, /settings tab: g scope, e edit, u unset/);
});