import { join } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();

function homePath(...parts) {
  return join(HOME, ...parts);
}

function projectPath(...parts) {
  return join(...parts);
}

export const LOGICAL_HOOKS = {
  "route-on-prompt": {
    logicalEvent: "user_prompt",
    description: "Suggest relevant harness-router capabilities before the agent starts work.",
  },
  "mark-tool-feedback": {
    logicalEvent: "post_tool",
    description: "Record whether a suggested capability was actually used.",
  },
};

// Native hook surfaces only. Hosts with instruction/rules but no confirmed
// lifecycle hook API are intentionally omitted and reported as unsupported.
export const HOOK_TARGETS = {
  "claude-code": {
    kind: "json-settings",
    format: "claude-code",
    targets: [
      { scope: "project", path: projectPath(".claude", "settings.json") },
      { scope: "global", path: homePath(".claude", "settings.json") },
    ],
    events: {
      user_prompt: "UserPromptSubmit",
      post_tool: "PostToolUse",
    },
  },
  codex: {
    kind: "json-settings",
    format: "codex-hooks-json",
    targets: [
      { scope: "project", path: projectPath(".codex", "hooks.json") },
      { scope: "global", path: homePath(".codex", "hooks.json") },
    ],
    events: {
      user_prompt: "UserPromptSubmit",
      post_tool: "PostToolUse",
    },
  },
  "gemini-cli": {
    kind: "json-settings",
    format: "gemini-settings-json",
    targets: [
      { scope: "project", path: projectPath(".gemini", "settings.json") },
      { scope: "global", path: homePath(".gemini", "settings.json") },
    ],
    events: {
      user_prompt: "BeforeAgent",
      post_tool: "AfterTool",
    },
  },
  opencode: {
    kind: "plugin-file",
    format: "opencode-plugin",
    targets: [
      { scope: "project", path: projectPath(".opencode", "plugins", "harness-router.js") },
      { scope: "global", path: homePath(".config", "opencode", "plugins", "harness-router.js") },
    ],
    events: {
      user_prompt: null,
      post_tool: "tool.execute.after",
    },
    note: "OpenCode plugins support tool/session events, but not a direct user-prompt event in the current docs.",
  },
};

export function hookTargetForHost(hostId, { scope = "project" } = {}) {
  const target = HOOK_TARGETS[hostId];
  if (!target) return null;
  const scoped = target.targets.find((item) => item.scope === scope);
  if (!scoped) return null;
  return { ...target, path: scoped.path, scope };
}

