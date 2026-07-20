// Optional capability providers.
//
// portawhip's job is to collect capabilities and plug them into any host. Some
// of those capabilities want to extend portawhip itself — contribute config
// keys, or act on a hook event — without portawhip having to import them. A
// provider is the seam for that: a module exporting any of
//
//   configSchema   a fragment for core/state/config-schema.mjs
//   hooks          { onUserPrompt?, onPostTool? } for adapters/hooks
//
// Each provider is tried at a list of specifiers, package name first so an
// installed copy wins over a vendored one. A provider that is not installed is
// not an error — that is the whole point, and callers get a clean absence.
//
// A provider that IS installed but fails to load is a different thing entirely,
// and it is reported. Swallowing that would give us a harness that silently
// does less than it claims, which is the exact failure mode this project exists
// to avoid.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PROVIDER_SPECIFIERS = {
  router: [
    // Post-extraction: the router is its own package.
    "portawhip-router/provider",
    // Pre-extraction: it still lives in this repo.
    "../router/provider.mjs",
  ],
};

// "Is this installed?" is answered by resolution, not by pattern-matching the
// error message — a missing package and a provider whose own import is broken
// both raise ERR_MODULE_NOT_FOUND, and only the first one is allowed to be
// silent. Resolving first separates them exactly.
function isInstalled(specifier) {
  let resolved;
  try {
    resolved = import.meta.resolve(specifier);
  } catch {
    // A bare specifier that will not resolve is a package that is not there.
    return false;
  }
  // For a relative or file: specifier, resolution is purely syntactic and
  // succeeds whether or not anything is on disk, so the file itself is the
  // answer. Without this, an uninstalled in-repo provider would be misreported
  // as a broken one.
  if (resolved.startsWith("file:")) return existsSync(fileURLToPath(resolved));
  return true;
}

async function loadOne(name, specifiers, onError) {
  for (const specifier of specifiers) {
    if (!isInstalled(specifier)) continue;
    try {
      const module = await import(specifier);
      return { name, specifier, module };
    } catch (error) {
      // It resolved, so it is installed — failing to load it is a real fault
      // and stays loud.
      onError?.({ name, specifier, error });
      return null;
    }
  }
  return null;
}

// PORTAWHIP_DISABLE_PROVIDERS turns a provider off without uninstalling it —
// "all", or a comma-separated list of names. Useful for isolating whether a
// provider is behind some behaviour, and for running the harness bare.
export function disabledProviders(env = process.env) {
  const raw = (env.PORTAWHIP_DISABLE_PROVIDERS ?? "").trim();
  if (!raw) return new Set();
  return new Set(raw.split(",").map((name) => name.trim().toLowerCase()).filter(Boolean));
}

// Returns only the providers that resolved. Order follows PROVIDER_SPECIFIERS
// so callers get a stable schema key order and a stable hook run order.
export async function loadProviders({ registry = PROVIDER_SPECIFIERS, onError = defaultOnError, env = process.env } = {}) {
  const disabled = disabledProviders(env);
  if (disabled.has("all")) return [];
  const loaded = [];
  for (const [name, specifiers] of Object.entries(registry)) {
    if (disabled.has(name.toLowerCase())) continue;
    const provider = await loadOne(name, specifiers, onError);
    if (provider) loaded.push(provider);
  }
  return loaded;
}

export async function providerConfigSchemas(options = {}) {
  const providers = await loadProviders(options);
  return providers.map((provider) => provider.module.configSchema).filter(Boolean);
}

function defaultOnError({ name, specifier, error }) {
  console.error(`portawhip: capability provider "${name}" (${specifier}) failed to load: ${error.message}`);
}
