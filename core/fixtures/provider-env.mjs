// Shared wiring for tests that need a capability provider present.
//
// portawhip's suite must pass on a machine with nothing else installed, so
// tests that need a provider register the fixture one rather than reaching for
// whatever real capability happens to be around.

import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

export const FIXTURE_PROVIDER = pathToFileURL(join(HERE, "test-provider.mjs")).href;

// Real providers off, fixture on — so the result does not depend on what is
// installed alongside portawhip.
export const FIXTURE_ENV = {
  PORTAWHIP_DISABLE_PROVIDERS: "router",
  PORTAWHIP_EXTRA_PROVIDERS: `fixture=${FIXTURE_PROVIDER}`,
};
