// Single source of truth for "which agent hosts exist on this machine."
// Both load.mjs and doctor.mjs import this — no host list is hardcoded
// in either of them.
//
// add-mcp's detectGlobalAgents() does real filesystem detection (checks
// for each agent's actual home config dir), so this list grows/shrinks
// automatically as the user installs/removes agent CLIs — no manual
// catalog maintenance.

import { detectGlobalAgents } from "add-mcp";
import spawnSync from "cross-spawn";
import { detectExtraHosts } from "../core/surface/extra-hosts.mjs";

// add-mcp and asm are independent projects that each picked their own id
// strings for the same real-world tool. This table is unavoidable glue
// data (not decision logic) translating one id space to the other; it
// only needs an entry for hosts that carry skill content, so it will
// always be shorter than add-mcp's full agent list.
const ADD_MCP_TO_ASM = {
  "claude-code": "claude",
  codex: "codex",
  cursor: "cursor",
  "gemini-cli": "gemini",
  opencode: "opencode",
  windsurf: "windsurf",
  zed: "zed",
  antigravity: "antigravity",
  cline: "cline",
  "cline-cli": "cline",
  "github-copilot-cli": "copilot",
};

function asmEnabledProviders() {
  const result = spawnSync.sync("npx", ["--yes", "agent-skill-manager", "config", "show"], {
    encoding: "utf8",
  });
  if (result.status !== 0) return [];
  try {
    const config = JSON.parse(result.stdout);
    return config.providers.filter((p) => p.enabled).map((p) => p.name);
  } catch {
    return [];
  }
}

export async function detectHosts() {
  const mcpHosts = await detectGlobalAgents(); // e.g. ["claude-code","codex","cursor",...]
  const asmProviders = asmEnabledProviders();
  const skillHosts = mcpHosts
    .map((id) => ADD_MCP_TO_ASM[id])
    .filter((name) => name && asmProviders.includes(name));

  // Hosts add-mcp doesn't catalogue yet (Pi, Amp, …), detected by their own
  // config dir. Kept in a separate field so add-mcp's MCP-linking path is
  // never handed a host it doesn't know; the instruction/command lanes that
  // opt in read this explicitly.
  const extraHosts = detectExtraHosts();

  return { mcpHosts, skillHosts, extraHosts };
}
