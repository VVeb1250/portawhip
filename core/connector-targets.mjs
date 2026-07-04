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
  "github-copilot-cli": {
    instructionTargets: [
      {
        scope: "project",
        path: projectPath(".github", "copilot-instructions.md"),
        variant: "generic",
      },
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

