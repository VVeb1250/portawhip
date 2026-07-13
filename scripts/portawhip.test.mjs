import { test } from "node:test";
import assert from "node:assert/strict";
import { commandFor } from "./portawhip.mjs";

test("portawhip CLI dispatches sync to the guarded reconciler", () => {
  const command = commandFor(["sync", "apply", "--scope", "project", "--apply"]);
  assert.match(command.script.replace(/\\/g, "/"), /scripts\/sync\/reconcile\.mjs$/);
  assert.deepEqual(command.args, ["apply", "--scope", "project", "--apply"]);
});

test("portawhip CLI keeps the TUI as the no-argument default", () => {
  const command = commandFor([]);
  assert.match(command.script.replace(/\\/g, "/"), /scripts\/tui\.mjs$/);
  assert.deepEqual(command.args, []);
});
