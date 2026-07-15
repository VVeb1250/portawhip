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

export function normalizeTriggerSpec({ id, type, triggers, skipWhen } = {}) {
  const safeId = String(id ?? "").trim();
  const positives = cleanList(triggers);
  const add = (value) => {
    const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!cleaned || positives.some((item) => item.toLowerCase() === cleaned.toLowerCase())) return;
    positives.push(cleaned);
  };

  add(safeId);
  add(`use ${safeId}`);
  add((FALLBACK_TRIGGER[type] ?? ((value) => `${value} capability`))(safeId));

  return {
    triggers: positives,
    ...(cleanList(skipWhen).length > 0 ? { skipWhen: cleanList(skipWhen) } : {}),
  };
}
