// Instruction connectors contributed by installed capability providers.
//
// A connector is the text a capability wants written into each host's
// instruction file so the host's model knows the capability exists. The harness
// owns writing and removing the block (adapters/instructions/generate.mjs); the
// capability owns the words. With no providers installed there are no
// connectors, and nothing is written — which is the correct behaviour, not a
// degraded one.

import { loadProviders } from "./capability-providers.mjs";

export async function connectorsFromProviders(options = {}) {
  const providers = await loadProviders(options);
  return providers.map((provider) => provider.module.connector).filter(Boolean);
}
