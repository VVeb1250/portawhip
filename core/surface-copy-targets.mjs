import { join } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();

// Data catalog: where each host keeps its slash-command and subagent dirs, and
// whether that surface is markdown-copyable. Not decision logic — each path is
// a documented host convention. Hosts whose format differs (gemini uses TOML
// for custom commands) are marked unsupported rather than fed a .md that
// wouldn't load. v1 does frontmatter-passthrough copy only, no translation.
export const SURFACE_COPY_TARGETS = {
  "claude-code": {
    command: [
      { scope: "global", dir: join(HOME, ".claude", "commands"), format: "md" },
      { scope: "project", dir: join(".claude", "commands"), format: "md" },
    ],
    agent: [
      { scope: "global", dir: join(HOME, ".claude", "agents"), format: "md" },
      { scope: "project", dir: join(".claude", "agents"), format: "md" },
    ],
  },
  codex: {
    command: [{ scope: "global", dir: join(HOME, ".codex", "prompts"), format: "md" }],
    agent: [{ scope: "global", dir: join(HOME, ".codex", "agents"), format: "md" }],
  },
  "gemini-cli": {
    command: [{ scope: "global", format: "toml", unsupported: true }],
    agent: [{ scope: "global", format: "unknown", unsupported: true }],
  },
};

export function copyTargetsFor(hostId, type, scope) {
  const perType = SURFACE_COPY_TARGETS[hostId]?.[type] ?? [];
  return perType.filter((t) => t.scope === scope);
}
