// Capability entries contributed by installed providers.
//
// A provider usually ships a capability of its own — portawhip-router ships an
// MCP server — and that capability has to appear in the index like any other,
// or nothing can route to it, list it, or report on it. Before this, the only
// way to declare one was to hand-write it into portawhip's recipe.yaml, which
// meant portawhip's curated list advertised a server that only existed if some
// other package happened to be installed.
//
// A provider declares its own entries by exporting `recipe`, using the same
// shape as a recipe.yaml entry. They are tagged with the provider that supplied
// them, so a stale entry is traceable to its owner rather than looking like a
// mistake in the project's own recipe.

import { loadProviders } from "./capability-providers.mjs";

export async function recipeEntriesFromProviders(options = {}) {
  const providers = await loadProviders(options);
  const entries = [];
  for (const provider of providers) {
    const contributed = provider.module.recipe;
    if (!Array.isArray(contributed)) continue;
    for (const entry of contributed) {
      if (!entry?.id || !entry?.type) {
        throw new Error(
          `provider "${provider.name}" contributed a malformed recipe entry (missing id/type): ${JSON.stringify(entry)}`,
        );
      }
      entries.push({
        // A provider ships the thing it declares, so unlike a bundle entry it
        // does not need discovery to confirm the capability exists — installing
        // the provider IS the confirmation.
        install: false,
        ...entry,
        origin: `provider:${provider.name}`,
      });
    }
  }
  return entries;
}
