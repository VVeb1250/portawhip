#!/usr/bin/env node
// PLAN.md Phase 3: UserPromptSubmit push-mode hook for Claude Code.
// Replaces the old skill-router.py hook (VISION.md §0/§5.2) — same contract:
// read {prompt} on stdin, emit a hookSpecificOutput.additionalContext block
// ONLY on a confident match, otherwise NOTHING on stdout. Any error is
// swallowed and treated as silence — this hook must never block a prompt.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";
import { loadIndex } from "../../core/registry.mjs";
import { runRoute } from "../../core/route-entry.mjs";
import { loadConfig } from "../../core/config.mjs";
import { computeFactors, logEvent } from "../../core/feedback.mjs";

// Registered globally, invoked from whatever project the user is in — all
// paths must anchor to this repo, never to the caller's cwd (same fix
// already applied to server/mcp-server.mjs for the pull-mode server).
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const RECIPE_PATH = join(ROOT, "recipe.yaml");
const CONFIG_PATH = join(ROOT, "router.config.yaml");

const MIN_PROMPT_LEN = 8;

// Per-project readiness (VISION.md gap): a capability can be installed
// globally but need local init in whatever project the caller is actually
// in right now. process.cwd() here is the CALLER's real project dir —
// this hook is spawned fresh per prompt, unlike the long-lived MCP server,
// so this is the one place in the router that can answer that safely.
function readinessNote(hit) {
  if (!hit.readyMarker) return "";
  const ready = existsSync(join(process.cwd(), hit.readyMarker));
  return ready ? "" : ` (not set up here — run \`${hit.readyHint ?? "see docs"}\`)`;
}

function formatBlock(result, budgetChars) {
  const lines = [];
  let used = 0;
  for (const hit of result) {
    const line = `• ${hit.id} — ${hit.how_to_use}${readinessNote(hit)} · ${hit.pointer}`;
    if (used + line.length > budgetChars && lines.length > 0) break;
    lines.push(line);
    used += line.length;
  }
  return lines.join("\n");
}

async function main() {
  let raw = "";
  try {
    raw = await new Promise((res, rej) => {
      let data = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => (data += chunk));
      process.stdin.on("end", () => res(data));
      process.stdin.on("error", rej);
    });
  } catch {
    return;
  }

  let prompt = "";
  let sessionId = null;
  try {
    const payload = raw.trim() ? JSON.parse(raw) : {};
    prompt = (payload.prompt || "").trim();
    sessionId = payload.session_id ?? null;
  } catch {
    return;
  }
  if (prompt.length < MIN_PROMPT_LEN || prompt.startsWith("/")) return;

  try {
    const config = loadConfig(CONFIG_PATH);
    const index = await loadIndex(RECIPE_PATH);
    const graphPath =
      config.graphPath && !isAbsolute(config.graphPath) ? join(ROOT, config.graphPath) : config.graphPath;
    const factors = computeFactors(ROOT);
    const result = runRoute(index, prompt, { ...config, graphPath, factors });
    if (!result || result.length === 0) return;

    const block = formatBlock(result, config.pushBudgetChars);
    if (!block) return;

    for (const hit of result) {
      logEvent(ROOT, { type: "suggested", id: hit.id, sessionId });
    }

    const out = {
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: block,
      },
    };
    process.stdout.write(JSON.stringify(out));
  } catch {
    // Safe by construction: a router failure is silence, never a crash that
    // blocks the user's prompt.
    return;
  }
}

await main();
