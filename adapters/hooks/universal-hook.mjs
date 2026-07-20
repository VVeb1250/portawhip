#!/usr/bin/env node
// One hook body, many host adapters.
//
// Host config files should call this script with:
//   node adapters/hooks/universal-hook.mjs --host <host-id> --event <logical-event>
//
// Logical events:
//   user_prompt -> ask capability providers whether anything is worth injecting
//   post_tool   -> match the tool call to a registry entry and tell providers
//
// This file owns the host side of the contract: which host, which event, which
// payload shape, and how additionalContext is framed. It owns no opinion about
// what should be said. That comes from optional capability providers (see
// core/state/capability-providers.mjs) resolved at runtime, so a portawhip
// install with no providers still installs, still runs, and simply stays quiet.

import spawn from "cross-spawn";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { loadIndex, readCachedIndex } from "../../core/registry/registry.mjs";
import { pointerFor } from "../../core/registry/capability-docs.mjs";
import { readActiveSelection, resolveRecipePaths } from "../../core/state/bundle-state.mjs";
import { loadProviders } from "../../core/state/capability-providers.mjs";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
// Whatever bundles were opted into via `scripts/bundles.mjs select` (foundry
// + roles), resolved in front of this repo's own recipe.yaml — defaults to
// just recipe.yaml when nothing has been selected (today's behavior).
const RECIPE_PATHS = resolveRecipePaths(ROOT, readActiveSelection(ROOT));
const CONFIG_PATH = join(ROOT, "router.config.yaml");

// A provider that throws must not take the hook down with it — hooks fail open
// by contract. Report it and carry on with whatever the others returned.
async function collectFromProviders(event, context) {
  const blocks = [];
  for (const provider of await loadProviders()) {
    const handler = provider.module.hooks?.[event];
    if (!handler) continue;
    try {
      const block = await handler(context);
      if (block) blocks.push(block);
    } catch (error) {
      console.error(`portawhip: provider "${provider.name}" failed on ${event}: ${error.message}`);
    }
  }
  return blocks;
}

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

function emit(args, blocks) {
  if (blocks.length === 0) return;
  process.stdout.write(JSON.stringify(outputAdditionalContext(args.host, args.nativeEvent, blocks.join("\n"))));
}

async function userPrompt(payload, args) {
  const prompt = promptFromPayload(payload);
  if (!prompt) return;
  emit(args, await collectFromProviders("onUserPrompt", {
    root: ROOT,
    host: args.host,
    cwd: payloadCwd(payload),
    prompt,
    sessionId: payload.session_id ?? null,
    configPath: CONFIG_PATH,
    payload,
    // Providers get the index lazily: building it is the expensive part, and
    // most prompts are filtered out before anyone needs it.
    loadIndex: () => loadIndex(RECIPE_PATHS),
  }));
}

async function postTool(payload, args) {
  // Matching a tool call back to a registry entry is registry work, so the
  // harness does it and hands providers the answer.
  const index = readCachedIndex(RECIPE_PATHS);
  if (!index) return;
  const { toolName, toolInput } = toolFields(payload);
  const id = resolveId(index, toolName, toolInput);
  if (!id) return;
  emit(args, await collectFromProviders("onPostTool", {
    root: ROOT,
    host: args.host,
    cwd: payloadCwd(payload),
    id,
    entry: index.entries.find((e) => e.id === id) ?? null,
    index,
    toolName,
    toolInput,
    sessionId: payload.session_id ?? null,
    pointerFor,
  }));
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
