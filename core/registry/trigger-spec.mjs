// Trigger-spec normalization for auto-discovered capabilities. Curated recipes
// are validated strictly in registry.mjs; discovery has to remain fail-open,
// so sparse metadata gets conservative request-language fallbacks instead.
const FALLBACK_TRIGGER = {
  mcp: (id) => `${id} tool`,
  cli: (id) => `run ${id}`,
  skill: (id) => `${id} skill`,
  command: (id) => `${id} command`,
  agent: (id) => `${id} agent`,
  "config-sync": (id) => `configure ${id}`,
};

function cleanList(values) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== "string") continue;
    const cleaned = value.replace(/\s+/g, " ").trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

// Below this, an entry's metadata is too sparse to be reachable by any natural
// query and the fallbacks are worth their cost. At or above it, they are pure
// downside — see MIN_POSITIVES' use for why.
const MIN_POSITIVES = 3;

export function normalizeTriggerSpec({ id, type, triggers, skipWhen } = {}) {
  const safeId = String(id ?? "").trim();
  const positives = cleanList(triggers);
  const add = (value) => {
    const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!cleaned || positives.some((item) => item.toLowerCase() === cleaned.toLowerCase())) return;
    positives.push(cleaned);
  };

  // Fallbacks are for sparse metadata only, exactly as this module's header
  // describes. Injecting them into an entry that already carries hand-written
  // triggers costs abstain accuracy: the hybrid engine tokenizes triggers, so
  // `${id} tool` puts the bare generic term "tool" into the index and every
  // prompt containing that word partially matches the capability. Found live —
  // "explain how graph retrieval might help tool selection" (a hard-negative
  // research question) started routing codegraph purely via "tool", dropping
  // eval abstainAccuracy 0.95 -> 0.90.
  if (positives.length < MIN_POSITIVES) {
    add(safeId);
    add(`use ${safeId}`);
    add((FALLBACK_TRIGGER[type] ?? ((value) => `${value} capability`))(safeId));
  }

  return {
    triggers: positives,
    ...(cleanList(skipWhen).length > 0 ? { skipWhen: cleanList(skipWhen) } : {}),
  };
}
