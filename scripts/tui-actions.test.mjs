import assert from "node:assert/strict";
import test from "node:test";

import { LINK_SCOPES, linkCommandForInput, runLinkAction } from "./tui-actions.mjs";

test("connector and hook tabs are inventory-only; Rulesync owns all writes", () => {
  assert.deepEqual(LINK_SCOPES, ["project", "global", "all"]);
  assert.equal(linkCommandForInput("connectors", "s"), "status");
  assert.equal(linkCommandForInput("hooks", "l"), null);
  assert.equal(linkCommandForInput("connectors", "x"), null);
  assert.equal(linkCommandForInput("sync", "l"), null);
});

test("runs connector inventory in both scopes when all is selected", async () => {
  const calls = [];
  const result = await runLinkAction({
    tab: "connectors",
    command: "status",
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
    { command: "status", scope: "project" },
    { command: "status", scope: "global" },
  ]);
  assert.equal(result.rows.length, 4);
  assert.match(result.summary, /connectors status all: 2 changed, 2 already current/);
});

test("rejects legacy link writes and unsupported tabs", async () => {
  await assert.rejects(
    () => runLinkAction({ tab: "hooks", command: "remove", scope: "global" }),
    /inventory-only.*Rulesync/i,
  );
  await assert.rejects(
    () => runLinkAction({ tab: "connectors", command: "install", scope: "project" }),
    /inventory-only.*Rulesync/i,
  );
  await assert.rejects(() => runLinkAction({ tab: "sync", command: "status", scope: "project" }), /unsupported TUI action tab/);
});

test("runs the selected hook status action", async () => {
  const result = await runLinkAction({
    tab: "hooks",
    command: "status",
    scope: "global",
    collectors: {
      hooks: async (options) => ({ rows: [{ hostId: "codex", ...options, status: "linked" }] }),
    },
  });

  assert.match(result.summary, /hooks status global: 1 already current/);
});
