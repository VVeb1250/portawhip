#!/usr/bin/env node
// One hook body, many host adapters.
//
// Host config files should call this script with:
//   node adapters/hooks/universal-hook.mjs --host <host-id> --event <logical-event>
//
// Logical events:
//   user_prompt -> route capabilities and inject additionalContext
//   post_tool   -> mark suggested capabilities as used

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, isAbsolute } from "node:path";
import { loadIndex, readCachedIndex } from "../../core/registry.mjs";
import { runRoute } from "../../core/route-entry.mjs";
import { pointerFor } from "../../core/capability-docs.mjs";
import { loadConfig } from "../../core/config.mjs";
import { computeFactors, logEvent, readEvents } from "../../core/feedback.mjs";
import { stackFactors, combineFactors } from "../../core/stack-detect.mjs";
import { readActiveSelection, resolveRecipePaths } from "../../core/bundle-state.mjs";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
// Whatever bundles were opted into via `scripts/bundles.mjs select` (foundry
// + roles), resolved in front of this repo's own recipe.yaml — defaults to
// just recipe.yaml when nothing has been selected (today's behavior).
const RECIPE_PATHS = resolveRecipePaths(ROOT, readActiveSelection(ROOT));
const CONFIG_PATH = join(ROOT, "router.config.yaml");
const MIN_PROMPT_LEN = 8;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

async function readStdinJson() {
  const raw = await new Promise((res, rej) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => res(data));
    process.stdin.on("error", rej);
  });
  const text = raw.replace(/^\uFEFF/, "").trim();
  return text ? JSON.parse(text) : {};
}

function payloadCwd(payload) {
  return payload.cwd || process.cwd();
}

function promptFromPayload(payload) {
  return (payload.prompt || payload.user_prompt || payload.input?.prompt || "").trim();
}

function readinessNote(hit, cwd) {
  if (!hit.readyMarker) return "";
  const ready = existsSync(join(cwd, hit.readyMarker));
  return ready ? "" : ` (not set up here - run \`${hit.readyHint ?? "see docs"}\`)`;
}

// A bare pointer alone doesn't get acted on. Verified live (2026-07-06):
// this repo's own push hook correctly suggested workspace-surface-audit and
// configure-ecc on every turn of a session about diagnosing this project's
// own hooks — genuinely relevant — and neither was ever invoked. The
// rendered line gave a bare path/name with no invocation syntax, so it read
// as background info, not a directive. adapters/instructions/generate.mjs
// already proved the fix for the sibling problem (route() itself never
// being called): be maximally explicit and host-aware, not more
// descriptive. Same principle here, generic over kind/host — never a
// specific tool name hardcoded, so this scales to whatever the caller has
// installed.
export function actionDirective(hit, host) {
  if (hit.kind === "skill") {
    return host === "claude-code"
      ? `invoke now via the Skill tool (skill: "${hit.id}")`
      : `read and follow this skill's instructions now: ${hit.pointer}`;
  }
  if (hit.kind === "agent") {
    return host === "claude-code"
      ? `delegate now via the Agent tool (subagent_type: "${hit.id}")`
      : `use this agent capability now if relevant: ${hit.pointer}`;
  }
  if (hit.type === "mcp") {
    return host === "claude-code"
      ? `call its MCP tool directly now (tool names start with "mcp__${hit.id}__"; if not shown as callable yet, call ToolSearch with query "${hit.id}" first)`
      : `call this MCP tool directly now if relevant`;
  }
  // cli (and any other pointer-bearing type): the pointer is already a
  // runnable shell command - see capability-docs.mjs's pointerFor.
  return `run it directly now: ${hit.pointer}`;
}

// Every "suggested" event is already logged per-sessionId (see the bottom
// of userPrompt()) purely for computeFactors' boost/decay signal - never
// read back to affect what gets rendered. Found live (2026-07-06): the
// mcp directive's ToolSearch-fallback clause alone costs ~150 chars, and
// full lines repeat every single turn a capability keeps matching, even
// within the same session where the agent was already told this once.
// Reusing that existing log to render tersely on repeat costs nothing new
// (no state to add) and only pays the full, detailed line once per id per
// session - generic over id/host, no capability-specific logic.
function sessionSuggestedIds(root, sessionId) {
  if (!sessionId) return new Set();
  return new Set(
    readEvents(root)
      .filter((e) => e.type === "suggested" && e.sessionId === sessionId)
      .map((e) => e.id),
  );
}

function formatBlock(result, budgetChars, cwd, host, alreadySuggestedIds) {
  const lines = [];
  let used = 0;
  for (const hit of result) {
    const line = alreadySuggestedIds.has(hit.id)
      ? `- ${hit.id} - still relevant, use it again if applicable`
      : `- ${hit.id} - ${hit.how_to_use}${readinessNote(hit, cwd)} - ${actionDirective(hit, host)}`;
    if (used + line.length > budgetChars && lines.length > 0) break;
    lines.push(line);
    used += line.length;
  }
  return lines.join("\n");
}

function outputAdditionalContext(host, nativeEvent, additionalContext) {
  const hookEventName = nativeEvent || (host === "gemini-cli" ? "BeforeAgent" : "UserPromptSubmit");
  return {
    hookSpecificOutput: {
      hookEventName,
      additionalContext,
    },
  };
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function resolveId(index, toolName, toolInput) {
  const mcpMatch = /^mcp[_]{1,2}([^_]+)[_]{1,2}/.exec(toolName || "");
  if (mcpMatch) {
    const id = mcpMatch[1];
    return index.entries.some((e) => e.id === id && e.type === "mcp") ? id : null;
  }

  if (["Read", "read_file"].includes(toolName)) {
    const filePath = (toolInput?.file_path || toolInput?.path || "").replace(/\\/g, "/");
    if (!filePath) return null;
    const hit = index.entries.find(
      (e) => e.type === "skill" && e.path && filePath.includes(String(e.path).replace(/\\/g, "/")),
    );
    return hit?.id ?? null;
  }

  if (["Bash", "run_shell_command", "bash"].includes(toolName)) {
    const command = toolInput?.command || toolInput?.cmd || "";
    // name comes from the registry (route.binary/source), not the tool call
    // itself, but a CLI binary name can still contain regex metacharacters
    // (e.g. "g++") - unescaped, that either throws (an uncaught exception
    // here propagates out of postTool(), silently disabling pull-mode
    // matching for every entry, not just this one - main() fails open with
    // an empty catch) or matches something nonsensical.
    const hit = index.entries.find((e) => {
      if (e.type !== "cli") return false;
      const name = e.route?.binary ?? e.source;
      return name && new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(command);
    });
    return hit?.id ?? null;
  }

  return null;
}

function toolFields(payload) {
  return {
    toolName: payload.tool_name || payload.toolName || payload.tool || payload.input?.tool || "",
    toolInput: payload.tool_input || payload.toolInput || payload.args || payload.input?.tool_input || {},
  };
}

async function userPrompt(payload, args) {
  const prompt = promptFromPayload(payload);
  if (prompt.length < MIN_PROMPT_LEN || prompt.startsWith("/")) return;

  const config = loadConfig(CONFIG_PATH);
  const index = await loadIndex(RECIPE_PATHS);
  const graphPath =
    config.graphPath && !isAbsolute(config.graphPath) ? join(ROOT, config.graphPath) : config.graphPath;
  const factors = combineFactors(computeFactors(ROOT), stackFactors(index, payloadCwd(payload)));
  // Dense retrieval (core/dense-embedder.mjs) loads a 500MB+ model on first
  // use - fine for the long-lived MCP server/CLI, but this hook is a fresh
  // subprocess per prompt (see hook-stub.mjs), so it would pay that cold
  // load on every keystroke. Push mode stays sparse+peakedness-gate only;
  // dense is opt-in for callers that can amortize the load across calls.
  const result = await runRoute(index, prompt, { ...config, graphPath, factors, denseEnabled: false });
  if (!result || result.length === 0) return;

  const alreadySuggestedIds = sessionSuggestedIds(ROOT, payload.session_id ?? null);
  const block = formatBlock(result, config.pushBudgetChars, payloadCwd(payload), args.host, alreadySuggestedIds);
  if (!block) return;

  for (const hit of result) {
    logEvent(ROOT, { type: "suggested", id: hit.id, prompt, sessionId: payload.session_id ?? null });
  }

  process.stdout.write(JSON.stringify(outputAdditionalContext(args.host, args.nativeEvent, block)));
}

// Soft nudge only — hooks must stay fail-open (see main()'s catch below), so
// this never blocks the tool call that already ran. It just tells the model
// a harness capability covers what it just did by hand, for next time.
function neverSuggested(root, id) {
  return !readEvents(root).some((e) => e.type === "suggested" && e.id === id);
}

async function postTool(payload, args) {
  const index = readCachedIndex(RECIPE_PATHS);
  if (!index) return;
  const { toolName, toolInput } = toolFields(payload);
  const id = resolveId(index, toolName, toolInput);
  if (!id) return;

  const wasIgnored = neverSuggested(ROOT, id);
  logEvent(ROOT, { type: "used", id, tool: toolName, sessionId: payload.session_id ?? null });
  if (!wasIgnored) return;

  const entry = index.entries.find((e) => e.id === id);
  if (!entry) return;
  // Raw index entries only carry route.description/path/source — how_to_use
  // and pointer are fields scorer.mjs constructs for the FORMATTED route()
  // output, not present here. Reading them off the raw entry silently
  // produced "undefined - undefined" (found live 2026-07-05, first time a
  // curated CLI entry with a `binary` field actually matched a Bash command).
  const description = entry.route?.description ?? "";
  const pointer = pointerFor(entry) ?? "";
  const nudge = `Note: "${toolName}" just did something \`${id}\` already covers - ${description} - ${pointer}. Prefer it next time.`;
  process.stdout.write(JSON.stringify(outputAdditionalContext(args.host, args.nativeEvent, nudge)));
}

async function main() {
  const args = parseArgs(process.argv);
  const payload = await readStdinJson();
  if (args.event === "user_prompt") await userPrompt(payload, args);
  if (args.event === "post_tool") await postTool(payload, args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Hooks must fail open; a sync-layer bug should never block the user.
  });
}
