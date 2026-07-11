// CLI enrichment ladder (Phase S1b) — turn a bare-name CLI entry into one
// with real natural-language triggers + description, using DETERMINISTIC
// author/maintainer-written sources only. No LLM. Full rationale +
// evidence: docs/cli-enrichment-research.md.
//
//   identity: `mise registry` maps short name -> backend:package (kills the
//             name-collision that made enrich.mjs drop npm-view).
//   describe: package-registry JSON (npm/PyPI/crates.io/GitHub) -> tldr-pages
//             raw markdown -> `--help` first line -> `pip show` (pipx).
//   triggers: name + subcommands + registry keywords + tldr example phrases.
//
// Pure parsers are separated from IO and exported for unit tests; every
// network/spawn call is guarded and fail-open (a missing source just drops a
// rung, never throws) — enrichment is best-effort, never required to route.

import spawnSync from "cross-spawn";
import { cliBinary, firstMeaningfulLine } from "./enrich.mjs";

const MAX_DESCRIPTION_CHARS = 300;
const MAX_TRIGGERS = 24;
const DEFAULT_TIMEOUT_MS = 6000;
const REGISTRY_MAX_BUFFER = 8 * 1024 * 1024;

// Backends that map to a fetchable package registry, in preference order.
// vfox/core/ubi and friends have no package-metadata endpoint -> skipped.
const BACKEND_PRIORITY = ["npm", "pipx", "cargo", "aqua", "github", "go"];

// --- identity: mise registry -----------------------------------------------

// Pure: parse `mise registry` stdout into name -> [backend:pkg, ...].
export function parseMiseRegistry(text) {
  const map = new Map();
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const parts = line.split(/\s+/);
    const name = parts.shift();
    if (!name || !parts.length) continue;
    map.set(name, parts);
  }
  return map;
}

// Pure: pick the highest-priority backend token that has a fetchable
// registry, returning { backend, pkg }. Returns null when none qualifies.
export function pickBackend(tokens) {
  const parsed = (tokens ?? [])
    .map((tok) => {
      const idx = tok.indexOf(":");
      return idx === -1 ? null : { backend: tok.slice(0, idx), pkg: tok.slice(idx + 1) };
    })
    .filter(Boolean);
  for (const backend of BACKEND_PRIORITY) {
    const hit = parsed.find((p) => p.backend === backend);
    if (hit) return hit;
  }
  return null;
}

// --- describe: package registry --------------------------------------------

// Pure: the JSON endpoint + a `kind` tag telling parsePackageMeta how to read
// the shape. github/aqua/go all resolve to the GitHub repos API.
export function packageMetaUrl(backend, pkg) {
  if (backend === "npm") return { url: `https://registry.npmjs.org/${encodeURIComponent(pkg)}`, kind: "npm" };
  if (backend === "pipx") return { url: `https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`, kind: "pypi" };
  if (backend === "cargo") return { url: `https://crates.io/api/v1/crates/${encodeURIComponent(pkg)}`, kind: "crates" };
  const repo = githubRepo(backend, pkg);
  if (repo) return { url: `https://api.github.com/repos/${repo}`, kind: "github" };
  return null;
}

// aqua/github: "org/repo". go: "github.com/org/repo/cmd/x" -> "org/repo".
function githubRepo(backend, pkg) {
  if (backend === "aqua" || backend === "github") {
    const m = pkg.match(/^([^/]+\/[^/]+)/);
    return m ? m[1] : null;
  }
  if (backend === "go") {
    const m = pkg.match(/github\.com\/([^/]+\/[^/]+)/);
    return m ? m[1] : null;
  }
  return null;
}

// Pure: extract { description, keywords } from each registry's JSON shape.
export function parsePackageMeta(kind, json) {
  if (!json || typeof json !== "object") return null;
  if (kind === "npm") {
    return clean(json.description, arr(json.keywords));
  }
  if (kind === "pypi") {
    const info = json.info ?? {};
    const kw = typeof info.keywords === "string" ? info.keywords.split(/[,\s]+/).filter(Boolean) : arr(info.keywords);
    return clean(info.summary, kw);
  }
  if (kind === "crates") {
    const crate = json.crate ?? {};
    return clean(crate.description, [...arr(crate.keywords), ...arr(crate.categories)]);
  }
  if (kind === "github") {
    return clean(json.description, arr(json.topics));
  }
  return null;
}

function arr(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}

function clean(description, keywords) {
  const desc = typeof description === "string" ? description.trim() : "";
  if (!desc && !(keywords && keywords.length)) return null;
  return { description: desc || null, keywords: (keywords ?? []).map((k) => k.toLowerCase()) };
}

// --- describe: tldr-pages ---------------------------------------------------

// Pure: candidate raw-markdown URLs for a command, most-likely platform first.
export function tldrUrls(cmd, platform = process.platform) {
  const base = "https://raw.githubusercontent.com/tldr-pages/tldr/main/pages";
  const osDir = platform === "win32" ? "windows" : platform === "darwin" ? "osx" : "linux";
  const safe = encodeURIComponent(cmd);
  return [`${base}/common/${safe}.md`, `${base}/${osDir}/${safe}.md`];
}

// Pure: parse a tldr page into { summary, examples }. Summary = the `>` lines
// (minus "More information:"); examples = the `-` description lines, which are
// exactly the natural-language phrasing real prompts use.
export function parseTldr(md) {
  const text = String(md ?? "");
  if (!text.trim()) return null;
  const summary = [];
  const examples = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith(">")) {
      const s = line.slice(1).trim();
      if (s && !/^more information/i.test(s)) summary.push(s);
    } else if (line.startsWith("-")) {
      const s = line.slice(1).trim().replace(/:$/, "");
      if (s) examples.push(s.toLowerCase());
    }
  }
  if (!summary.length && !examples.length) return null;
  return { summary: summary.join(" ") || null, examples };
}

// --- merge -----------------------------------------------------------------

// Pure: combine ladder sources into one enrichment record. Description takes
// the first available in quality order; triggers union everything, capped.
// `sources` records provenance per field so a wrong value is traceable.
export function buildCliEnrichment(id, bin, { pkgMeta, tldr, helpLine, pipSummary, subcommands } = {}) {
  const descChoice =
    (pkgMeta?.description && { text: pkgMeta.description, source: "package" }) ||
    (tldr?.summary && { text: tldr.summary, source: "tldr" }) ||
    (helpLine && { text: helpLine, source: "help" }) ||
    (pipSummary && { text: pipSummary, source: "pip" }) ||
    null;

  const triggers = [];
  const seen = new Set();
  const add = (t) => {
    const v = String(t ?? "").trim().toLowerCase();
    if (v && !seen.has(v)) {
      seen.add(v);
      triggers.push(v);
    }
  };
  add(id);
  add(bin);
  for (const s of subcommands ?? []) add(`${bin} ${s}`);
  for (const k of pkgMeta?.keywords ?? []) add(k);
  for (const ex of tldr?.examples ?? []) add(ex);

  if (!descChoice && triggers.length <= 2) return null; // nothing usable -> hold back (the anti-junk gate)

  const description = descChoice
    ? `CLI tool: ${bin} — ${descChoice.text}`.slice(0, MAX_DESCRIPTION_CHARS)
    : `CLI tool: ${bin}`;

  return {
    type: "cli",
    triggers: triggers.slice(0, MAX_TRIGGERS),
    description,
    sources: {
      description: descChoice?.source ?? null,
      triggers: [
        ...(subcommands?.length ? ["help-subcommands"] : []),
        ...(pkgMeta?.keywords?.length ? ["package-keywords"] : []),
        ...(tldr?.examples?.length ? ["tldr-examples"] : []),
      ],
    },
    enrichedAt: new Date().toISOString(),
  };
}

// Pure: harvest subcommand names from `--help` output. Looks for a
// "Commands:"/"Subcommands:" section and takes the first token of each
// indented line. Conservative — returns [] when no such section.
export function parseSubcommands(helpText) {
  const lines = String(helpText ?? "").split(/\r?\n/);
  const out = [];
  let inSection = false;
  for (const raw of lines) {
    if (/^(sub)?commands:/i.test(raw.trim())) {
      inSection = true;
      continue;
    }
    if (inSection) {
      if (!raw.trim()) {
        if (out.length) break;
        continue;
      }
      const m = raw.match(/^\s+([a-z][\w-]*)\b/);
      if (m) out.push(m[1]);
      else if (!/^\s/.test(raw)) break; // dedented -> section ended
    }
  }
  return [...new Set(out)].slice(0, 12);
}

// --- IO (guarded, fail-open) -----------------------------------------------

export async function fetchJsonGuarded(url, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const body = await fetchTextGuarded(url, { timeoutMs, fetchImpl, accept: "application/json" });
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export async function fetchTextGuarded(url, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch, accept } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { "user-agent": "portawhip-enrich" };
    if (accept) headers.accept = accept;
    const res = await fetchImpl(url, { signal: controller.signal, headers });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// mise registry (spawn) -> parsed identity map. Fail-open to an empty map so a
// machine without mise still runs the rest of the ladder (help/tldr).
export function miseRegistryMap(runner = spawnSync.sync) {
  const r = runner("mise", ["registry"], { encoding: "utf8", maxBuffer: REGISTRY_MAX_BUFFER });
  if (!r || r.status !== 0) return new Map();
  return parseMiseRegistry(r.stdout);
}

// `--help` capture: prefer `mise exec --` (resolves a mise-managed tool on any
// shell, per enrich.mjs's finding), fall back to a direct spawn for tools
// installed outside mise (scoop/npm-g/cargo — e.g. rtk, icm).
function captureHelp(bin) {
  const viaMise = spawnSync.sync("mise", ["exec", "--", bin, "--help"], { encoding: "utf8", timeout: DEFAULT_TIMEOUT_MS });
  if (viaMise.status === 0) return `${viaMise.stdout || ""}${viaMise.stderr || ""}`;
  const direct = spawnSync.sync(bin, ["--help"], { encoding: "utf8", timeout: DEFAULT_TIMEOUT_MS });
  if (direct.error) return "";
  return `${direct.stdout || ""}${direct.stderr || ""}`;
}

function pipSummary(bin) {
  const r = spawnSync.sync("pip", ["show", bin], { encoding: "utf8", timeout: DEFAULT_TIMEOUT_MS });
  if (r.error || r.status !== 0) return null;
  const m = (r.stdout || "").match(/^Summary:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

// Full ladder for a set of CLI ids. Network (package registry + tldr) is
// injectable + guarded; a dropped rung just lowers quality, never throws.
// Runs at enrich time only (router-cli enrich), never on the route hot path.
export async function enrichCliLadder(ids, { registry, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const reg = registry ?? miseRegistryMap();
  const results = {};
  for (const id of ids) {
    const bin = cliBinary(id);

    let pkgMeta = null;
    const backend = pickBackend(reg.get(bin) ?? reg.get(id) ?? []);
    if (backend) {
      const endpoint = packageMetaUrl(backend.backend, backend.pkg);
      if (endpoint) {
        pkgMeta = parsePackageMeta(endpoint.kind, await fetchJsonGuarded(endpoint.url, { fetchImpl, timeoutMs }));
      }
    }

    let tldr = null;
    for (const url of tldrUrls(bin)) {
      const md = await fetchTextGuarded(url, { fetchImpl, timeoutMs });
      if (md) {
        tldr = parseTldr(md);
        if (tldr) break;
      }
    }

    const helpText = captureHelp(bin);
    const enrichment = buildCliEnrichment(id, bin, {
      pkgMeta,
      tldr,
      helpLine: firstMeaningfulLine(helpText),
      subcommands: parseSubcommands(helpText),
      pipSummary: id.startsWith("pipx:") ? pipSummary(bin) : null,
    });
    if (enrichment) results[id] = enrichment;
  }
  return results;
}
