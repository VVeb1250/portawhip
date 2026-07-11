import assert from "node:assert/strict";
import test from "node:test";

import { LINK_SCOPES, linkCommandForInput, runLinkAction } from "./tui-actions.mjs";

test("connector and hook tabs expose status, repair, and remove actions", () => {
  assert.deepEqual(LINK_SCOPES, ["project", "global", "all"]);
  assert.equal(linkCommandForInput("connectors", "s"), "status");
  assert.equal(linkCommandForInput("hooks", "l"), "install");
  assert.equal(linkCommandForInput("connectors", "x"), "remove");
  assert.equal(linkCommandForInput("sync", "l"), null);
});

test("runs a connector repair in both scopes when all is selected", async () => {
  const calls = [];
  const result = await runLinkAction({
    tab: "connectors",
    command: "install",
    scope: "all",
    collectors: {
      connectors: async (options) => {
        calls.push(options);
        return {
          rows: [
            { hostId: "codex", scope: options.scope, instructionStatus: "changed" },
            { hostId: "claude", scope: options.scope, instructionStatus: "no-op" },
          ],
        };
      },
    },
  });

  assert.deepEqual(calls, [
    { command: "install", scope: "project" },
    { command: "install", scope: "global" },
  ]);
  assert.equal(result.rows.length, 4);
  assert.match(result.summary, /connectors install all: 2 changed, 2 already current/);
});

test("runs the selected hook action and rejects unsupported tabs", async () => {
  const result = await runLinkAction({
    tab: "hooks",
    command: "remove",
    scope: "global",
    collectors: {
      hooks: async (options) => ({ rows: [{ hostId: "codex", ...options, status: "changed" }] }),
    },
  });

  assert.match(result.summary, /hooks remove global: 1 changed/);
  await assert.rejects(() => runLinkAction({ tab: "sync", command: "install", scope: "project" }), /unsupported TUI action tab/);
});
