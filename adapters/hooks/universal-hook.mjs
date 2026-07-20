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
import spawn from "cross-spawn";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { loadIndex, readCachedIndex } from "../../core/registry/registry.mjs";
import { runRoute } from "../../core/router/route-entry.mjs";
import { pointerFor } from "../../core/registry/capability-docs.mjs";
import { loadRuntimeConfig } from "../../core/state/config.mjs";
import { computeFactors, logEvent, readEvents } from "../../core/router/feedback.mjs";
import { stackFactors, combineFactors } from "../../core/state/stack-detect.mjs";
import { readActiveSelection, resolveRecipePaths } from "../../core/state/bundle-state.mjs";
import { isSyntheticPrompt } from "../../core/router/prompt-hygiene.mjs";
import { emissionState, REUSE_NOTE } from "../../core/router/session-ledger.mjs";

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
// (no state to add). Extended 2026-07-09 from a Set to per-id counts:
// mention 1 renders full, mention 2 renders terse, then the id goes SILENT
// for the session (interrupt budget - an assistant that reminds twice and
// then shuts up, instead of nagging every turn a capability keeps matching).
function sessionSuggestedCounts(root, sessionId) {
  const counts = new Map();
  if (!sessionId) return counts;
  for (const e of readEvents(root)) {
    if (e.type !== "suggested" || e.sessionId !== sessionId) continue;
    counts.set(e.id, (counts.get(e.id) ?? 0) + 1);
  }
  return counts;
}

// Returns {block, renderedIds}: only ids actually shown to the model get
// logged as "suggested" (previously every routed hit was logged even when
// the char budget dropped its line - phantom suggestions the model never
// saw, each counting as an "ignored" outcome in computeFactors).
function formatBlock(result, budgetChars, cwd, host, mentionCounts, maxMentions) {
  const lines = [];
  const renderedIds = [];
  let used = 0;
  for (const hit of result) {
    const mentions = mentionCounts.get(hit.id) ?? 0;
    const state = emissionState({ timesSuggested: mentions, used: false });
    if (state === "mute" || mentions >= maxMentions) continue; // interrupt budget spent for this session
    const line =
      state === "reuse"
        ? `- ${hit.id} - ${REUSE_NOTE}`
        : `- ${hit.id} - ${hit.how_to_use}${readinessNote(hit, cwd)} - ${actionDirective(hit, host)}`;
    if (used + line.length > budgetChars && lines.length > 0) break;
    lines.push(line);
    renderedIds.push(hit.id);
    used += line.length;
  }
  return { block: lines.join("\n"), renderedIds };
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

  // Skill/Agent invocations are how MOST suggestions actually get acted on
  // (352 skills + 90 agents vs 11 mcp/11 cli in today's index), yet neither
  // had a branch here - so a suggested skill being used never logged a
  // "used" event, boost never fired, and the 2026-07-09 hit-rate audit
  // (4/26) was measuring with one eye shut. Host invocations may be
  // plugin-namespaced ("ecc:code-review") while registry ids are plain
  // slugs - match both the raw arg and the part after the last colon.
  if (toolName === "Skill" || toolName === "Agent") {
    const wantType = toolName === "Skill" ? "skill" : "agent";
    const arg = String(
      (toolName === "Skill" ? toolInput?.skill : toolInput?.subagent_type) ?? "",
    );
    if (!arg) return null;
    const bare = arg.includes(":") ? arg.slice(arg.lastIndexOf(":") + 1) : arg;
    const hit = index.entries.find((e) => e.type === wantType && (e.id === arg || e.id === bare));
    return hit?.id ?? null;
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
  // Harness-generated payloads (task notifications, system reminders) arrive
  // through the same UserPromptSubmit channel as real typing - routing them
  // was 81% of all suggested events and pure decay-noise for computeFactors
  // (see core/prompt-hygiene.mjs for the live numbers).
  if (isSyntheticPrompt(prompt)) return;

  const config = loadRuntimeConfig({ basePath: CONFIG_PATH, cwd: payloadCwd(payload) });
  // Workstream A: a push hook sees only the raw prompt, not the agent's
  // reasoned task summary. The characterization spikes proved no lexical or
  // embedding threshold can reliably separate meta-discussion from a real
  // capability request, so unsolicited push stays silent by default. The env
  // override is a scoped rollback switch; it never changes retrieval itself.
  const pushMode = process.env.PORTAWHIP_PUSH_MODE === "legacy" ? "legacy" : config.pushMode;
  if (pushMode === "silent") return;
  const index = await loadIndex(RECIPE_PATHS);
  const factors = combineFactors(computeFactors(ROOT), stackFactors(index, payloadCwd(payload)));
  // Dense retrieval (core/dense-embedder.mjs) loads a 500MB+ model on first
  // use - fine for the long-lived MCP server/CLI, but this hook is a fresh
  // subprocess per prompt (see hook-stub.mjs), so it would pay that cold
  // load on every keystroke. Push mode stays sparse+peakedness-gate only;
  // dense is opt-in for callers that can amortize the load across calls.
  const routed = await runRoute(index, prompt, {
    ...config,
    factors,
    denseEnabled: false,
    mode: "push",
    pushMode,
  });
  if (!routed || routed.length === 0) return;

  // Push precision gate (2026-07-09): an unsolicited interruption needs a
  // much higher bar than a solicited MCP route() lookup - see
  // router.config.yaml's pushMinConfidence comment (alert fatigue). Curated
  // required-tier entries keep their deliberately-authored pass.
  const result = routed.filter(
    (hit) => hit.tier === "required" || hit.confidence >= config.pushMinConfidence,
  );
  if (result.length === 0) return;

  const mentionCounts = sessionSuggestedCounts(ROOT, payload.session_id ?? null);
  const { block, renderedIds } = formatBlock(
    result,
    config.pushBudgetChars,
    payloadCwd(payload),
    args.host,
    mentionCounts,
    config.pushMaxMentionsPerSession,
  );
  if (!block) return;

  for (const id of renderedIds) {
    logEvent(ROOT, { type: "suggested", id, prompt, sessionId: payload.session_id ?? null });
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

// Session start: fire-and-forget the auto-sync worker (decision D). This hook
// must return instantly, so it detaches a fully independent process and
// unrefs it — the worker throttles/locks and fans already-canonical
// capabilities out to all hosts on its own, logging to
// .hp-state/auto-sync.log. Import stays manual; this only propagates what is
// already canonical. Any failure stays inside the worker; the session is
// never blocked or delayed.
function sessionStart() {
  try {
    const child = spawn.spawn(process.execPath, [join(ROOT, "scripts", "sync", "auto-sync.mjs")], {
      cwd: ROOT,
      env: { ...process.env, PORTAWHIP_PROJECT_ROOT: process.cwd() },
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch {
    // fail-open: never block session start on a spawn error
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.event === "session_start") {
    sessionStart();
    return;
  }
  const payload = await readStdinJson();
  if (args.event === "user_prompt") await userPrompt(payload, args);
  if (args.event === "post_tool") await postTool(payload, args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Hooks must fail open; a sync-layer bug should never block the user.
  });
}
