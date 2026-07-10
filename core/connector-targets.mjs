import { join } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();

function homePath(...parts) {
  return join(HOME, ...parts);
}

function projectPath(...parts) {
  return join(...parts);
}

// Connector targets are data, not decision logic. MCP installation is still
// delegated to add-mcp; this table only records the instruction surfaces we
// can safely upsert for hosts that need a reminder to call harness-router.
export const CONNECTOR_TARGETS = {
  "claude-code": {
    instructionTargets: [
      {
        scope: "global",
        path: homePath(".claude", "CLAUDE.md"),
        variant: "claude-code",
        note: "Claude Code can defer MCP tool schemas, so this block names the ToolSearch fallback.",
      },
      {
        scope: "project",
        path: projectPath("CLAUDE.md"),
        variant: "claude-code",
      },
    ],
  },
  codex: {
    instructionTargets: [
      {
        scope: "global",
        path: homePath(".codex", "AGENTS.md"),
        variant: "generic",
      },
      {
        scope: "project",
        path: projectPath("AGENTS.md"),
        variant: "generic",
      },
    ],
  },
  "gemini-cli": {
    instructionTargets: [
      {
        scope: "global",
        path: homePath(".gemini", "GEMINI.md"),
        variant: "generic",
      },
      {
        scope: "project",
        path: projectPath("GEMINI.md"),
        variant: "generic",
      },
    ],
  },
  cursor: {
    instructionTargets: [
      {
        scope: "project",
        path: projectPath(".cursor", "rules", "harness-router.mdc"),
        variant: "cursor-rule",
        owned: true,
        note: "Cursor project rules live under .cursor/rules; this rule is always applied.",
      },
      {
        scope: "project",
        path: projectPath("AGENTS.md"),
        variant: "generic",
        note: "Cursor also documents AGENTS.md support; keep this as a shared fallback.",
      },
    ],
  },
  // opencode already carries a native hook target (hook-targets.mjs); it also
  // reads AGENTS.md at the project root and a personal global at
  // ~/.config/opencode/AGENTS.md. Both are shared user files -> marker-upsert.
  opencode: {
    instructionTargets: [
      {
        scope: "global",
        path: homePath(".config", "opencode", "AGENTS.md"),
        variant: "generic",
      },
      {
        scope: "project",
        path: projectPath("AGENTS.md"),
        variant: "generic",
      },
    ],
  },
  // Zed reads AGENTS.md as its primary instruction file (project + a personal
  // global alongside settings at ~/.config/zed/AGENTS.md). No documented
  // lifecycle hook API -> reported unsupported by link-hooks, not faked.
  zed: {
    instructionTargets: [
      {
        scope: "global",
        path: homePath(".config", "zed", "AGENTS.md"),
        variant: "generic",
      },
      {
        scope: "project",
        path: projectPath("AGENTS.md"),
        variant: "generic",
      },
    ],
  },
  // Windsurf: a dedicated always-on workspace rule under .windsurf/rules
  // (harness-owned whole file, frontmatter trigger: always_on), plus AGENTS.md
  // as the shared project fallback, plus the always-on personal global memories
  // file. No documented lifecycle hook API -> reported unsupported.
  windsurf: {
    instructionTargets: [
      {
        scope: "project",
        path: projectPath(".windsurf", "rules", "harness-router.md"),
        variant: "windsurf-rule",
        owned: true,
        note: "Windsurf workspace rule; trigger: always_on.",
      },
      {
        scope: "project",
        path: projectPath("AGENTS.md"),
        variant: "generic",
        note: "Windsurf also reads AGENTS.md; keep this as a shared fallback.",
      },
      {
        scope: "global",
        path: homePath(".codeium", "windsurf", "memories", "global_rules.md"),
        variant: "generic",
        note: "Windsurf global memories file is always on.",
      },
    ],
  },
  // Cline combines every .md/.txt file under .clinerules/ into its always-on
  // rule set, so a dedicated harness-owned file drops in cleanly without a
  // frontmatter activation mode. No documented lifecycle hook API.
  cline: {
    instructionTargets: [
      {
        scope: "project",
        path: projectPath(".clinerules", "harness-router.md"),
        variant: "generic",
        owned: true,
        note: "Cline reads all files under .clinerules/ as active rules.",
      },
    ],
  },
  "cline-cli": {
    instructionTargets: [
      {
        scope: "project",
        path: projectPath(".clinerules", "harness-router.md"),
        variant: "generic",
        owned: true,
        note: "Cline CLI shares the .clinerules/ convention.",
      },
    ],
  },
  "github-copilot-cli": {
    instructionTargets: [
      {
        scope: "project",
        path: projectPath(".github", "copilot-instructions.md"),
        variant: "generic",
      },
    ],
  },
  // Pi (earendil-works/pi): reads AGENTS.md walking up from cwd, plus a global
  // ~/.pi/agent/AGENTS.md. Both are shared instruction files -> marker upsert.
  // Source: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md
  pi: {
    instructionTargets: [
      { scope: "global", path: homePath(".pi", "agent", "AGENTS.md"), variant: "generic" },
      { scope: "project", path: projectPath("AGENTS.md"), variant: "generic" },
    ],
  },
  // Sourcegraph Amp: reads project AGENTS.md and a personal ~/.config/AGENTS.md.
  // Source: https://ampcode.com/manual
  amp: {
    instructionTargets: [
      { scope: "global", path: homePath(".config", "AGENTS.md"), variant: "generic" },
      { scope: "project", path: projectPath("AGENTS.md"), variant: "generic" },
    ],
  },
  vscode: {
    instructionTargets: [
      {
        scope: "project",
        path: projectPath(".github", "copilot-instructions.md"),
        variant: "generic",
      },
    ],
  },
};

export function targetsForHost(hostId, { scope = "project" } = {}) {
  const targets = CONNECTOR_TARGETS[hostId]?.instructionTargets ?? [];
  return targets.filter((target) => target.scope === scope);
}

