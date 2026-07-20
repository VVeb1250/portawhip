// The router as a portawhip capability provider.
//
// This is the single seam between the router and the harness. portawhip
// discovers this module through core/state/capability-providers.mjs and asks it
// for two things: the config keys the router owns, and what the router wants to
// say on a hook event. Nothing in portawhip imports the router directly, so a
// portawhip install without the router is a working install — quieter, not
// broken.
//
// The division of labour on hooks: the harness owns the host protocol (which
// event, which payload shape, how additionalContext is framed for this host)
// and the registry lookup. This provider owns the content — whether there is
// anything worth saying, and how it reads.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { runRoute } from "./route-entry.mjs";
import { isSyntheticPrompt } from "./prompt-hygiene.mjs";
import { emissionState, REUSE_NOTE } from "./session-ledger.mjs";
import { computeFactors, logEvent, readEvents } from "./feedback.mjs";
import { stackFactors, combineFactors } from "../state/stack-detect.mjs";
import { loadRouterRuntimeConfig, ROUTER_SCHEMA } from "./router-config.mjs";
import { ROUTER_CONNECTOR } from "./connector.mjs";

export const configSchema = ROUTER_SCHEMA;
export const connector = ROUTER_CONNECTOR;

const MIN_PROMPT_LEN = 8;

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
// of onUserPrompt()) purely for computeFactors' boost/decay signal - never
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

// Soft nudge only — hooks stay fail-open, so this never blocks the tool call
// that already ran. It just tells the model a harness capability covers what it
// just did by hand, for next time.
function neverSuggested(root, id) {
  return !readEvents(root).some((e) => e.type === "suggested" && e.id === id);
}

export const hooks = {
  // Returns the text to inject, or null to stay silent. The harness decides how
  // to frame it for the host.
  async onUserPrompt({ root, host, cwd, prompt, sessionId, configPath, loadIndex }) {
    if (prompt.length < MIN_PROMPT_LEN || prompt.startsWith("/")) return null;
    // Harness-generated payloads (task notifications, system reminders) arrive
    // through the same UserPromptSubmit channel as real typing - routing them
    // was 81% of all suggested events and pure decay-noise for computeFactors
    // (see prompt-hygiene.mjs for the live numbers).
    if (isSyntheticPrompt(prompt)) return null;

    const config = loadRouterRuntimeConfig({ basePath: configPath, cwd });
    // Workstream A: a push hook sees only the raw prompt, not the agent's
    // reasoned task summary. The characterization spikes proved no lexical or
    // embedding threshold can reliably separate meta-discussion from a real
    // capability request, so unsolicited push stays silent by default. The env
    // override is a scoped rollback switch; it never changes retrieval itself.
    const pushMode = process.env.PORTAWHIP_PUSH_MODE === "legacy" ? "legacy" : config.pushMode;
    if (pushMode === "silent") return null;

    const index = await loadIndex();
    const factors = combineFactors(computeFactors(root), stackFactors(index, cwd));
    // Dense retrieval (dense-embedder.mjs) loads a 500MB+ model on first use -
    // fine for the long-lived MCP server/CLI, but this hook is a fresh
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
    if (!routed || routed.length === 0) return null;

    // Push precision gate (2026-07-09): an unsolicited interruption needs a
    // much higher bar than a solicited MCP route() lookup - see
    // router.config.yaml's pushMinConfidence comment (alert fatigue). Curated
    // required-tier entries keep their deliberately-authored pass.
    const result = routed.filter(
      (hit) => hit.tier === "required" || hit.confidence >= config.pushMinConfidence,
    );
    if (result.length === 0) return null;

    const mentionCounts = sessionSuggestedCounts(root, sessionId);
    const { block, renderedIds } = formatBlock(
      result,
      config.pushBudgetChars,
      cwd,
      host,
      mentionCounts,
      config.pushMaxMentionsPerSession,
    );
    if (!block) return null;

    for (const id of renderedIds) {
      logEvent(root, { type: "suggested", id, prompt, sessionId });
    }
    return block;
  },

  // The harness has already matched the tool call to a registry entry; the
  // router owns the trust-loop bookkeeping and whether to nudge.
  async onPostTool({ root, id, entry, toolName, sessionId, pointerFor }) {
    if (!id) return null;
    const wasIgnored = neverSuggested(root, id);
    logEvent(root, { type: "used", id, tool: toolName, sessionId });
    if (!wasIgnored || !entry) return null;
    // Raw index entries only carry route.description/path/source — how_to_use
    // and pointer are fields scorer.mjs constructs for the FORMATTED route()
    // output, not present here. Reading them off the raw entry silently
    // produced "undefined - undefined" (found live 2026-07-05, first time a
    // curated CLI entry with a `binary` field actually matched a Bash command).
    const description = entry.route?.description ?? "";
    const pointer = pointerFor(entry) ?? "";
    return `Note: "${toolName}" just did something \`${id}\` already covers - ${description} - ${pointer}. Prefer it next time.`;
  },
};
