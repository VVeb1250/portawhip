// Supplementary host detection (Phase S4) — for coding-agent hosts that
// add-mcp's detectGlobalAgents() does not yet know about. add-mcp stays the
// primary, delegated detector (VISION: don't rebuild host detection); this
// only fills the proven gap of newer harnesses it hasn't catalogued, by the
// same method it uses — checking whether the host's real config dir exists.
//
// Pure data + a presence check. Each entry cites the documented convention so
// a reviewer can verify it (same bar as docs/connector-research.md). A host
// is only ever reported when its config dir is actually present, so this is
// inert until the user installs one — never an overclaim.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();

// id: our stable host id. present: dirs that, if any exist, mean it's
// installed. surfaces: which portawhip surfaces this host can receive (used
// by the host-support matrix + to skip lanes a host can't take). source: the
// doc that establishes the convention.
export const EXTRA_HOSTS = {
  pi: {
    label: "Pi (earendil-works/pi)",
    present: [join(HOME, ".pi")],
    surfaces: { instructions: true, skills: true, commands: true, agents: false, mcp: false, hooks: false },
    source: "https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md",
    note: "Reads AGENTS.md and .agents/skills; prompt templates in ~/.pi/agent/prompts. No native subagents/MCP/declarative hooks (extensions only).",
  },
  amp: {
    label: "Sourcegraph Amp",
    present: [join(HOME, ".config", "amp")],
    surfaces: { instructions: true, skills: true, commands: false, agents: false, mcp: true, hooks: false },
    source: "https://ampcode.com/manual",
    note: "Reads AGENTS.md (project + ~/.config/AGENTS.md); skills in ~/.config/amp/skills. MCP supported; no documented declarative hook file.",
  },
};

// Present extra hosts on this machine (ids only), for merging into the host set.
export function detectExtraHosts() {
  return Object.entries(EXTRA_HOSTS)
    .filter(([, def]) => def.present.some((dir) => existsSync(dir)))
    .map(([id]) => id);
}

export function extraHostSupports(hostId, surface) {
  return EXTRA_HOSTS[hostId]?.surfaces?.[surface] === true;
}
