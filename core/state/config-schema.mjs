// Config schema fragments.
//
// portawhip owns the config machinery (file layering, parsing, validation) but
// not the whole key space. The harness half declares the keys it needs here;
// optional capabilities — the router being the first — contribute their own
// fragment through a provider (see capability-providers.mjs), so uninstalling
// one takes its keys with it instead of leaving dead settings in the TUI.
//
// A fragment is plain data plus one pure function:
//
//   {
//     id:          stable name, used in error messages
//     defaults:    packaged values for every key the fragment owns
//     definitions: per-key type/range/description, keyed by dotted path
//     mergeKeys:   nested mappings that layer-merge across config files
//                  instead of being replaced wholesale
//     normalize:   (raw, defaults) -> validated slice of the config object
//   }

const HARNESS_DEFAULTS = {
  autoSync: { enabled: false, throttleMinutes: 60 },
};

export const HARNESS_SCHEMA = {
  id: "harness",
  defaults: HARNESS_DEFAULTS,
  definitions: {
    "autoSync.enabled": { type: "boolean", description: "Enable background propagation of already-canonical configuration." },
    "autoSync.throttleMinutes": { type: "number", min: 0, description: "Minimum minutes between background sync attempts." },
  },
  mergeKeys: ["autoSync"],
  // A fragment must be usable on its own, not only through mergeSchemas, so it
  // carries its own defaults rather than relying on the caller to pass them.
  normalize(raw, defaults = HARNESS_DEFAULTS) {
    const value = raw.autoSync;
    if (!value || typeof value !== "object") return { autoSync: { ...defaults.autoSync } };
    return {
      autoSync: {
        enabled: typeof value.enabled === "boolean" ? value.enabled : defaults.autoSync.enabled,
        throttleMinutes: typeof value.throttleMinutes === "number" ? value.throttleMinutes : defaults.autoSync.throttleMinutes,
      },
    };
  },
};

// Later fragments lose on a key collision rather than silently overwriting a
// key another fragment already claimed — two capabilities fighting over one
// setting is a packaging bug, and it should be loud.
export function mergeSchemas(...fragments) {
  const present = fragments.filter(Boolean);
  const defaults = {};
  const definitions = {};
  const mergeKeys = [];
  const owners = new Map();

  for (const fragment of present) {
    for (const key of Object.keys(fragment.definitions ?? {})) {
      const owner = owners.get(key);
      if (owner) throw new Error(`config key ${JSON.stringify(key)} is claimed by both "${owner}" and "${fragment.id}"`);
      owners.set(key, fragment.id);
      definitions[key] = fragment.definitions[key];
    }
    Object.assign(defaults, fragment.defaults ?? {});
    for (const key of fragment.mergeKeys ?? []) if (!mergeKeys.includes(key)) mergeKeys.push(key);
  }

  return {
    id: present.map((fragment) => fragment.id).join("+") || "empty",
    defaults,
    definitions,
    mergeKeys,
    normalize(raw) {
      const out = {};
      for (const fragment of present) Object.assign(out, fragment.normalize(raw, fragment.defaults ?? {}));
      return out;
    },
  };
}
