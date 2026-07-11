import spawnSync from "cross-spawn";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const BACKEND_ALIASES = {
  ai: "ai-config-sync",
  "ai-config": "ai-config-sync",
  "ai-config-sync-manager": "ai-config-sync",
  asm: "agent-skill-manager",
  "agent-skills": "agent-skill-manager",
  agents: "agents-dotdir",
  ".agents": "agents-dotdir",
};

const MAX_OUTPUT_CHARS = 12000;

export const CONFIG_SYNC_BACKENDS = {
  "ai-config-sync": {
    id: "ai-config-sync",
    label: "ai-config-sync-manager",
    command: "ai-config-sync",
    npxPackage: "ai-config-sync-manager",
    installHint: "npm install -g ai-config-sync-manager",
    supports: {
      status: true,
      preview: true,
      apply: true,
    },
    description: "Bidirectional Claude Code/Codex sync for instructions, skills, agents, MCP, hooks, and permissions.",
  },
  "agent-skill-manager": {
    id: "agent-skill-manager",
    label: "agent-skill-manager",
    command: "agent-skill-manager",
    npxPackage: "agent-skill-manager",
    installHint: "npm install agent-skill-manager or run through npx --yes agent-skill-manager",
    supports: {
      status: true,
      preview: false,
      apply: false,
    },
    description: "Skill provider inventory/probe backend already used by the loader for skill installs.",
  },
  "agents-dotdir": {
    id: "agents-dotdir",
    label: "@agents-dev/cli",
    command: "agents",
    npxPackage: "@agents-dev/cli",
    installHint: "npm install -g @agents-dev/cli",
    supports: {
      status: true,
      preview: true,
      apply: true,
    },
    description: "Project .agents/ source-of-truth sync for MCP servers, skills, and instructions across many hosts.",
  },
};

export function normalizeBackendId(id) {
  const raw = id ?? "ai-config-sync";
  return BACKEND_ALIASES[raw] ?? raw;
}

export function backendById(id) {
  const normalized = normalizeBackendId(id);
  const backend = CONFIG_SYNC_BACKENDS[normalized];
  if (!backend) {
    throw new Error(`unknown backend "${id}". valid: ${Object.keys(CONFIG_SYNC_BACKENDS).join(", ")}`);
  }
  return backend;
}

export function buildBackendArgs(backendId, action, options = {}) {
  const backend = backendById(backendId);
  if (!backend.supports[action]) {
    throw new Error(`${backend.id} does not support ${action}; use status for probe-only backends`);
  }

  const scope = options.scope && options.scope !== "all" ? ["--scope", options.scope] : [];
  const selectors = [
    ...(options.include ? ["--include", options.include] : []),
    ...(options.exclude ? ["--exclude", options.exclude] : []),
  ];
  const direction = [
    ...(options.from ? ["--from", options.from] : []),
    ...(options.to ? ["--to", options.to] : []),
  ];

  if (backend.id === "ai-config-sync") {
    if (action === "status") return ["status", "--json", ...scope, ...selectors];
    if (action === "preview") return ["sync", "--dry-run", "--plan-json", ...direction, ...scope, ...selectors];
    return [
      "sync",
      "--apply",
      "--ledger-json",
      ...direction,
      ...scope,
      ...selectors,
    ];
  }

  if (backend.id === "agent-skill-manager") {
    return ["config", "show"];
  }

  if (backend.id === "agents-dotdir") {
    if (action === "status") return ["status", "--fast"];
    if (action === "preview") return ["sync", "--check"];
    return ["sync"];
  }

  throw new Error(`unhandled backend ${backend.id}`);
}

export function runBackend(backendId, action, options = {}, runner = spawnSync.sync) {
  const backend = backendById(backendId);
  const args = buildBackendArgs(backend.id, action, options);
  const invocation = resolveBackendInvocation(backend, args, options);
  const result = runner(invocation.command, invocation.args, {
    cwd: options.cwd,
    encoding: "utf8",
  });
  const errorText = result.error ? `${result.error.code || "ERROR"}: ${result.error.message}` : "";
  const rawOutput = `${result.stdout || ""}${result.stderr || ""}${errorText ? `${errorText}\n` : ""}`;
  const output = trimOutput(rawOutput);
  const parsed = parseLeadingJson(rawOutput);
  const innerErrors = parsed?.summary?.error ?? 0;
  const plannedChanges = isPlannedChangeExit(backend.id, action, result.status, rawOutput);
  const ok = (result.status === 0 || plannedChanges) && innerErrors === 0;
  return {
    backend: backend.id,
    label: backend.label,
    action,
    command: [invocation.command, ...invocation.args],
    ok,
    status: plannedChanges ? "changed" : ok ? "success" : "error",
    summary: ok
      ? plannedChanges
        ? `${backend.label} ${action} found planned changes`
        : `${backend.label} ${action} completed`
      : innerErrors > 0
        ? `${backend.label} ${action} reported ${innerErrors} inner error(s)`
        : `${backend.label} ${action} failed`,
    output,
    outputTruncated: output.length < rawOutput.length,
    parsedSummary: parsed?.summary ?? null,
    installHint: ok || innerErrors > 0 ? null : backend.installHint,
    next_actions: ok
      ? nextActionsForSuccess(backend.id, action)
      : innerErrors > 0
        ? ["Inspect the backend ledger/output; the command ran but reported failed operations."]
        : [`Install or expose the backend command: ${backend.installHint}`, "Re-run sync-config status after install."],
    artifacts: [],
  };
}

function isPlannedChangeExit(backendId, action, status, output) {
  return (
    backendId === "agents-dotdir" &&
    action === "preview" &&
    status !== 0 &&
    /\bWould (create|update|remove) \d+ item\(s\):/.test(output)
  );
}

function trimOutput(output) {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  return `${output.slice(0, MAX_OUTPUT_CHARS)}\n...[truncated ${output.length - MAX_OUTPUT_CHARS} chars]`;
}

function parseLeadingJson(output) {
  const text = String(output ?? "").trimStart();
  if (!text.startsWith("{")) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(0, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function resolveBackendInvocation(backend, args, options = {}) {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  const local = resolve("node_modules", ".bin", `${backend.command}${suffix}`);
  if (existsSync(local)) return { command: local, args };
  if (options.allowNpx || process.env.PORTAWHIP_ALLOW_NPX === "1") {
    return { command: "npx", args: ["--yes", backend.npxPackage, ...args] };
  }
  return { command: backend.command, args };
}

function nextActionsForSuccess(backendId, action) {
  if (backendId === "agent-skill-manager") {
    return ["Use load.mjs for actual skill installs; this backend is probe-only here."];
  }
  if (action === "status") return ["Run preview before apply to inspect drift."];
  if (action === "preview") return ["Review the plan, then run apply only if the changes are intended."];
  return ["Run status again to confirm drift is gone."];
}
