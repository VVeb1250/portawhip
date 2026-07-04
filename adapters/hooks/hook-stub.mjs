#!/usr/bin/env node
// Copied to a fixed path OUTSIDE the harness repo (under the user's home
// directory) at install time — see ensureStub() in scripts/link-hooks.mjs.
// Host hook configs point here, not directly at universal-hook.mjs, so that
// deleting the harness repo turns every hook invocation into a silent
// no-op instead of a per-turn "module not found" error. This file itself
// carries no repo-specific path, so it never goes stale and never needs
// cleanup on uninstall.

import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

function targetArg(argv) {
  const i = argv.indexOf("--target");
  return i === -1 ? null : argv[i + 1];
}

const target = targetArg(process.argv);
if (target && existsSync(target)) {
  await import(pathToFileURL(target).href);
}
