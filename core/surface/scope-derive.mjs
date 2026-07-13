// Derive whether an MCP server belongs to project or global scope from
// OBSERVABLE config properties + where it was discovered — never a per-server
// list. Same "detection, not a list" stance as isHostPrivateMcp in
// rulesync-canonical.mjs and VISION.md's "cross-host by detection, not by list":
// a server whose launch config names a project-relative path (e.g.
// harness-router's `node server/mcp-server.mjs`) is meaningless in the user's
// global config and is forced to project scope; a portable server (bare package
// or public URL) keeps the scope it was actually installed at. User-loaded tools
// need zero code change — they flow through this inference, not a hand-kept map.

import { isAbsolute, resolve } from "node:path";

// ${workspaceFolder} / ${projectDir} / ${cwd} style placeholders — a config
// using one is by definition project-relative.
const WORKSPACE_PLACEHOLDER =
  /\$\{?\s*(workspace(folder|root)?|projectdir|projectroot|cwd)\s*\}?/i;
// A launched script file inside the repo (the harness-router tell). Bare package
// names (@scope/pkg, mcp-server-fetch) have no such extension, so they stay
// portable — this is why we key on the extension, not a bare "/".
const SCRIPT_EXTENSION = /\.(mjs|cjs|js|ts|tsx|py|rb|sh|jar|phar)$/i;

// Pure: does a single command/arg value reference a project-relative path (so
// the config only makes sense inside one specific repo)? Conservative on
// purpose — ambiguous relatives fall through to "portable" so we never wrongly
// pin a genuinely global tool to a project.
export function looksLikeProjectPath(value, projectRoot = null) {
  if (typeof value !== "string" || value.length === 0) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false; // a URL, not a path
  if (WORKSPACE_PLACEHOLDER.test(value)) return true;
  const normalized = value.replace(/\\/g, "/");
  if (normalized === "." || normalized === "..") return true;
  if (normalized.startsWith("./") || normalized.startsWith("../")) return true;
  if (isAbsolute(value)) {
    // absolute inside the given project root = project-bound; elsewhere the path
    // is machine-global (e.g. a tool in ~/bin), which we treat as portable.
    return projectRoot ? resolve(value).startsWith(resolve(projectRoot)) : false;
  }
  // a relative path that names a script file inside the repo, e.g.
  // "server/mcp-server.mjs" — but NOT a scoped npm package "@x/y".
  return SCRIPT_EXTENSION.test(normalized);
}

// Pure: is the whole MCP launch config bound to a project (any path-bearing
// part)? The interpreter (node/npx/uvx/python) is portable; the PATH ARG is the
// tell, so every command+arg is checked.
export function configIsProjectBound(config = {}, projectRoot = null) {
  const source = config.server ?? config;
  const parts = [source.command, ...(Array.isArray(source.args) ? source.args : [])];
  if (source.cwd && looksLikeProjectPath(String(source.cwd), projectRoot)) return true;
  return parts.some((part) => looksLikeProjectPath(part, projectRoot));
}

// Pure: derive the scope for one server. Path-bound → forced project (a repo
// path is meaningless in global config); otherwise the scope it was actually
// discovered at wins; unknown defaults to project — never pollute the user's
// global by guessing. Returns a reason so `doctor`/preview can explain the call.
export function deriveScope(config = {}, { discoveredGlobal = false, projectRoot = null } = {}) {
  if (configIsProjectBound(config, projectRoot)) {
    return { scope: "project", reason: "project-bound path in launch config" };
  }
  if (discoveredGlobal) return { scope: "global", reason: "portable + installed globally" };
  return { scope: "project", reason: "portable + installed at project scope" };
}
