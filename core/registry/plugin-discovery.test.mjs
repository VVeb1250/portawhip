import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { discoverAgents, discoverCommands, discoverSkillsFromDirs } from "./discover.mjs";

// Host plugin caches nest capabilities several levels deep; these guard the
// scan that finds them. They used to live in the router's test file, which
// made a discovery regression look like a routing failure.
function tempRoot(prefix = "portawhip-discovery-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("discovery: filesystem scan includes nested Claude plugin cache skills", () => {
  const root = tempRoot();
  try {
    const skillDir = join(root, ".claude", "plugins", "cache", "ecc", "ecc", "2.0.0", ".agents", "skills", "nested-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      '---\nname: nested-plugin-skill\ndescription: Skill from Claude plugin cache\n---\n# Nested\n',
    );
    const skills = discoverSkillsFromDirs([join(root, ".claude", "plugins", "cache")]);
    assert.deepEqual(skills, [
      {
        name: "nested-plugin-skill",
        description: "Skill from Claude plugin cache",
        path: skillDir,
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("discovery: filesystem scan includes nested plugin commands", () => {
  const root = tempRoot();
  try {
    const commandDir = join(root, ".claude", "plugins", "cache", "ecc", "ecc", "2.0.0", "commands");
    mkdirSync(commandDir, { recursive: true });
    const commandPath = join(commandDir, "harness-audit.md");
    writeFileSync(commandPath, "---\ndescription: Run a deterministic harness audit.\n---\n# Harness Audit\n");
    const commands = discoverCommands([join(root, ".claude", "plugins", "cache")]);
    assert.deepEqual(commands.map((command) => ({
      id: command.id,
      type: command.type,
      path: command.path,
      kindTrigger: command.route.triggers.includes("/harness-audit"),
    })), [
      {
        id: "harness-audit",
        type: "command",
        path: commandPath,
        kindTrigger: true,
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("discovery: filesystem scan includes nested plugin agents", () => {
  const root = tempRoot();
  try {
    const agentDir = join(root, ".claude", "plugins", "cache", "ecc", "ecc", "2.0.0", "agents");
    mkdirSync(agentDir, { recursive: true });
    const agentPath = join(agentDir, "harness-optimizer.md");
    writeFileSync(
      agentPath,
      "---\nname: harness-optimizer\ndescription: Analyze and improve local agent harness configuration.\n---\n# Agent\n",
    );
    const agents = discoverAgents([join(root, ".claude", "plugins", "cache")]);
    assert.deepEqual(agents.map((agent) => ({
      id: agent.id,
      type: agent.type,
      path: agent.path,
      description: agent.route.description,
    })), [
      {
        id: "harness-optimizer",
        type: "agent",
        path: agentPath,
        description: "Analyze and improve local agent harness configuration.",
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
