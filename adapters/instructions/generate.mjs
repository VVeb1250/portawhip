#!/usr/bin/env node
// Phase 2 step 3: idempotent insert/remove of a one-liner instruction block
// into a host's instruction file (CLAUDE.md / AGENTS.md / GEMINI.md), so the
// model knows to call the harness-router MCP server before starting a task.
// Marker comments make this reversible — never touches the rest of the file.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const START = "<!-- harness-router:start -->";
const END = "<!-- harness-router:end -->";

// Plain wording — safe default for hosts with no lazy tool-loading concept
// (Codex/AGENTS.md verified 8/8 route() calls with this text alone).
export const GENERIC_BLOCK = `${START}
Before starting a task, call \`route(task summary)\` on the harness-router MCP
server and follow any returned pointers. State only the positively requested action
and its direct object; omit background, merely mentioned, rejected, or negated
candidate actions. Do not copy the raw prompt. An empty
result is normal and means nothing relevant is installed — proceed without it.
${END}`;

// Claude Code defers MCP tool schemas behind ToolSearch until looked up by
// name — confirmed live: harness-router's route/list_all showed as deferred
// at session start and were never called (0/8 in Phase 2 verify), because
// the generic wording never told the model to look them up first.
export const CLAUDE_CODE_BLOCK = `${START}
Before starting a task, call \`route(task summary)\` on the harness-router MCP
server and follow any returned pointers. State only the positively requested action
and its direct object; omit background, merely mentioned, rejected, or negated
candidate actions. Do not copy the raw prompt. If
\`route\`/\`list_all\` show up as deferred/pending tools rather than directly
callable, first call ToolSearch with query
"select:mcp__harness-router__route,mcp__harness-router__list_all" to load them,
then call route(). An empty result from route() is normal and means nothing
relevant is installed — proceed without it.
${END}`;

export const CURSOR_RULE_BLOCK = `---
description: Route tasks through the project harness-router before starting work
alwaysApply: true
---

${GENERIC_BLOCK}`;

// Windsurf workspace rules live under .windsurf/rules/*.md and pick an
// activation mode via the `trigger` frontmatter field; always_on = injected
// into every request in the workspace. This is a dedicated harness-owned
// file (see owned:true in connector-targets), so it is written whole, not
// marker-upserted — the frontmatter must stay the first bytes of the file.
export const WINDSURF_RULE_BLOCK = `---
trigger: always_on
---

${GENERIC_BLOCK}`;

export function blockForVariant(variant = "generic") {
  if (variant === "claude-code") return CLAUDE_CODE_BLOCK;
  if (variant === "cursor-rule") return CURSOR_RULE_BLOCK;
  if (variant === "windsurf-rule") return WINDSURF_RULE_BLOCK;
  return GENERIC_BLOCK;
}

export function upsertBlock(targetPath, block = GENERIC_BLOCK) {
  const before = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";
  const startIdx = before.indexOf(START);
  const endIdx = before.indexOf(END);
  const after =
    startIdx !== -1 && endIdx !== -1
      ? before.slice(0, startIdx) + block + before.slice(endIdx + END.length)
      : before.length > 0
        ? `${before.trimEnd()}\n\n${block}\n`
        : `${block}\n`;
  writeFileSync(targetPath, after);
  return after !== before;
}

export function removeBlock(targetPath) {
  if (!existsSync(targetPath)) return false;
  const content = readFileSync(targetPath, "utf8");
  const startIdx = content.indexOf(START);
  const endIdx = content.indexOf(END);
  if (startIdx === -1 || endIdx === -1) return false;
  const before = content.slice(0, startIdx).replace(/\n+$/, "\n");
  const after = content.slice(endIdx + END.length).replace(/^\n+/, "");
  writeFileSync(targetPath, `${before}${after}`);
  return true;
}

function main() {
  const [, , command, targetPath, variant] = process.argv;
  if (!targetPath || !["install", "remove"].includes(command)) {
    console.error(
      "usage: generate.mjs <install|remove> <path-to-CLAUDE.md-or-similar> [claude-code|generic]",
    );
    process.exitCode = 1;
    return;
  }
  const block = blockForVariant(variant);
  const changed = command === "install" ? upsertBlock(targetPath, block) : removeBlock(targetPath);
  console.log(`${command} ${targetPath}: ${changed ? "changed" : "no-op"}`);
}

import { pathToFileURL } from "node:url";

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
