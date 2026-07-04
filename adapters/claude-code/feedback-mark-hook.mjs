#!/usr/bin/env node
// PLAN.md Phase 4 step 1: PostToolUse hook. Marks whether a capability the
// push-hook suggested was actually used — matched against whichever tool
// call just happened. Reads the cached route index (not a full rebuild —
// this fires on every tool call, so it must stay cheap) to resolve
// pointers/sources back to a capability id. Safe by construction: any
// error is silence, never a blocked tool call.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readCachedIndex } from "../../core/registry.mjs";
import { logEvent } from "../../core/feedback.mjs";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function resolveId(index, toolName, toolInput) {
  const mcpMatch = /^mcp__([^_]+)__/.exec(toolName || "");
  if (mcpMatch) {
    const id = mcpMatch[1];
    return index.entries.some((e) => e.id === id && e.type === "mcp") ? id : null;
  }

  if (toolName === "Read") {
    const filePath = (toolInput?.file_path || toolInput?.path || "").replace(/\\/g, "/");
    if (!filePath) return null;
    const hit = index.entries.find(
      (e) => e.type === "skill" && e.path && filePath.includes(String(e.path).replace(/\\/g, "/")),
    );
    return hit?.id ?? null;
  }

  if (toolName === "Bash") {
    const command = toolInput?.command || "";
    const hit = index.entries.find((e) => {
      if (e.type !== "cli") return false;
      const name = e.route?.binary ?? e.source;
      return name && new RegExp(`\\b${name}\\b`, "i").test(command);
    });
    return hit?.id ?? null;
  }

  return null;
}

async function main() {
  let raw = "";
  try {
    raw = await new Promise((res, rej) => {
      let data = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (c) => (data += c));
      process.stdin.on("end", () => res(data));
      process.stdin.on("error", rej);
    });
  } catch {
    return;
  }

  try {
    const payload = raw.trim() ? JSON.parse(raw) : {};
    const index = readCachedIndex(join(ROOT, "recipe.yaml"));
    if (!index) return;
    const id = resolveId(index, payload.tool_name, payload.tool_input);
    if (!id) return;
    logEvent(ROOT, { type: "used", id, tool: payload.tool_name, sessionId: payload.session_id ?? null });
  } catch {
    return;
  }
}

await main();
