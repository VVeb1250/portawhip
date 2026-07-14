import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { selectionStyle } from "./tui-theme.mjs";

test("selected TUI elements use an explicit high-contrast palette", () => {
  assert.deepEqual(selectionStyle(true), { color: "black", backgroundColor: "cyan", bold: true });
  assert.deepEqual(selectionStyle(false), {});
});

test("interactive TUI does not rely on terminal inverse colors for selection", () => {
  const path = fileURLToPath(new URL("./tui.mjs", import.meta.url));
  const source = readFileSync(path, "utf8");
  assert.doesNotMatch(source, /inverse:/);
  assert.match(source, /selectionStyle\(item === tab\)/);
  assert.match(source, /selectionStyle\(active\)/);
});