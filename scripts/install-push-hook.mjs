#!/usr/bin/env node
// PLAN.md Phase 3 step 1/3 + Phase 4 step 1: install/remove the Claude Code
// UserPromptSubmit push-hook AND the PostToolUse feedback-mark hook into a
// settings.json, and separately detect (never silently remove) the user's
// old skill-router.py hook — VISION.md's rule: "coordinate: the installer
// must detect and offer to disable the old hook (ask user before touching
// their settings)".
//
// usage:
//   node scripts/install-push-hook.mjs status  [--settings <path>]
//   node scripts/install-push-hook.mjs install [--settings <path>] [--dry-run] [--disable-old-hook]
//   node scripts/install-push-hook.mjs remove  [--settings <path>] [--dry-run] [--disable-old-hook]

import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PUSH_HOOK_PATH = join(ROOT, "adapters", "claude-code", "push-hook.mjs");
const FEEDBACK_HOOK_PATH = join(ROOT, "adapters", "claude-code", "feedback-mark-hook.mjs");
const DEFAULT_SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

const MARKERS = {
  UserPromptSubmit: "push-hook.mjs",
  PostToolUse: "feedback-mark-hook.mjs",
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true;
      args[key] = value;
      if (value !== true) i += 1;
    }
  }
  return args;
}

function loadSettings(path) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}

function hasMarker(group, marker) {
  return (group.hooks ?? []).some((h) => typeof h.command === "string" && h.command.includes(marker));
}

function isOldSkillRouterEntry(group) {
  return (group.hooks ?? []).some(
    (h) => typeof h.command === "string" && h.command.includes("skill-router.py"),
  );
}

function groupFor(hookPath) {
  return { hooks: [{ type: "command", command: `"${process.execPath}" "${hookPath}"` }] };
}

function detect(settings) {
  const userPromptList = settings.hooks?.UserPromptSubmit ?? [];
  const postToolList = settings.hooks?.PostToolUse ?? [];
  return {
    hasPush: userPromptList.some((g) => hasMarker(g, MARKERS.UserPromptSubmit)),
    hasFeedback: postToolList.some((g) => hasMarker(g, MARKERS.PostToolUse)),
    oldHookGroups: userPromptList.filter(isOldSkillRouterEntry),
  };
}

function backup(path) {
  if (!existsSync(path)) return null;
  const backupPath = `${path}.bak-${Date.now()}`;
  copyFileSync(path, backupPath);
  return backupPath;
}

function main() {
  const [, , command, ...rest] = process.argv;
  const args = parseArgs(rest);
  const settingsPath = args.settings ?? DEFAULT_SETTINGS_PATH;

  if (!["status", "install", "remove"].includes(command)) {
    console.error("usage: install-push-hook.mjs <status|install|remove> [--settings <path>] [--dry-run]");
    process.exitCode = 1;
    return;
  }

  const settings = loadSettings(settingsPath);
  const state = detect(settings);

  if (command === "status") {
    console.log(`settings: ${settingsPath}`);
    console.log(`push-hook (UserPromptSubmit) installed: ${state.hasPush}`);
    console.log(`feedback-mark-hook (PostToolUse) installed: ${state.hasFeedback}`);
    console.log(`old skill-router.py hook present: ${state.oldHookGroups.length > 0}`);
    if (state.oldHookGroups.length > 0) {
      console.log(
        "NOTE: old hook still active — it will keep firing alongside the new one until " +
          "explicitly disabled. This script never removes it without --disable-old-hook " +
          "on a `remove`/`install` run, and always asks first.",
      );
    }
    return;
  }

  settings.hooks = settings.hooks ?? {};
  settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit ?? [];
  settings.hooks.PostToolUse = settings.hooks.PostToolUse ?? [];

  if (command === "install") {
    if (!state.hasPush) settings.hooks.UserPromptSubmit.push(groupFor(PUSH_HOOK_PATH));
    if (!state.hasFeedback) settings.hooks.PostToolUse.push(groupFor(FEEDBACK_HOOK_PATH));
    if (args["disable-old-hook"]) {
      settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
        (g) => !isOldSkillRouterEntry(g),
      );
    }
  }

  if (command === "remove") {
    settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
      (g) => !hasMarker(g, MARKERS.UserPromptSubmit),
    );
    settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(
      (g) => !hasMarker(g, MARKERS.PostToolUse),
    );
    if (args["disable-old-hook"]) {
      settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
        (g) => !isOldSkillRouterEntry(g),
      );
    }
  }

  const next = JSON.stringify(settings, null, 2);
  if (args["dry-run"]) {
    console.log(`[dry-run] would write ${settingsPath}:`);
    console.log(next);
    return;
  }

  const backupPath = backup(settingsPath);
  writeFileSync(settingsPath, next);
  console.log(`${command} done: ${settingsPath}`);
  if (backupPath) console.log(`backup: ${backupPath}`);
  if (state.oldHookGroups.length > 0 && !args["disable-old-hook"]) {
    console.log(
      "old skill-router.py hook still present and untouched — re-run with " +
        "--disable-old-hook once you've confirmed the new one works, to avoid double suggestions.",
    );
  }
}

main();
