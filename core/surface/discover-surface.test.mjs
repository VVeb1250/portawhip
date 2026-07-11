import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverCommands, discoverAgents, defaultCommandRoots, defaultAgentRoots } from "../registry/discover.mjs";
import { homedir } from "node:os";

function fixtureRoot() {
  return mkdtempSync(join(tmpdir(), "discover-surface-"));
}

test("discoverCommands: reads a host-native leaf dir directly (basename == segment)", () => {
  const root = fixtureRoot();
  const commandsDir = join(root, "commands");
  mkdirSync(commandsDir, { recursive: true });
  writeFileSync(join(commandsDir, "deploy.md"), "---\nname: deploy\ndescription: Ship it\n---\n# deploy\n");
  const found = discoverCommands([commandsDir]);
  const deploy = found.find((c) => c.id === "deploy");
  assert.ok(deploy, "leaf-dir command discovered");
  assert.equal(deploy.type, "command");
  assert.ok(deploy.route.triggers.includes("/deploy"));
});

test("discoverAgents: reads a host-native leaf dir directly", () => {
  const root = fixtureRoot();
  const agentsDir = join(root, "agents");
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(join(agentsDir, "reviewer.md"), "---\nname: reviewer\ndescription: Reviews code\n---\n");
  const found = discoverAgents([agentsDir]);
  assert.ok(found.find((a) => a.id === "reviewer" && a.type === "agent"));
});

test("discoverCommands: still finds a segment dir nested under a plugin root", () => {
  const root = fixtureRoot();
  const nested = join(root, "someplugin", "commands");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "build.md"), "---\nname: build\ndescription: Build it\n---\n");
  const found = discoverCommands([root]);
  assert.ok(found.find((c) => c.id === "build"), "nested segment-walk still works");
});

test("defaultCommandRoots/defaultAgentRoots include host-native claude dirs", () => {
  const cmd = defaultCommandRoots();
  const ag = defaultAgentRoots();
  assert.ok(cmd.some((p) => p.endsWith(join(".claude", "commands"))));
  assert.ok(cmd.some((p) => p === join(homedir(), ".claude", "commands")));
  assert.ok(ag.some((p) => p.endsWith(join(".claude", "agents"))));
});
