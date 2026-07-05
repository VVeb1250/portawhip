// Layer 1: keyword/trigger matching only. Silence is the default output —
// callers must get [] on anything that doesn't clear the threshold, not a
// low-confidence guess (VISION.md principle: "silence is a valid output").
// Threshold/k defaults come from router.config.yaml (core/config.mjs), not
// a constant here — this module takes them as explicit call arguments.

import { capabilityKind, matchesSuggestKind } from "./capability-kind.mjs";
import { pointerFor } from "./capability-docs.mjs";

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function triggerHit(trigger, promptLower) {
  const escaped = escapeRegex(trigger.toLowerCase());
  // \b works for word-ish triggers; multi-word phrases still match as a
  // literal substring with boundaries at the phrase's own edges.
  const re = new RegExp(`\\b${escaped}\\b`, "i");
  return re.test(promptLower);
}

export function scoreEntry(entry, promptLower) {
  if (!entry.route) return 0;
  let score = 0;
  for (const trigger of entry.route.triggers) {
    if (triggerHit(trigger, promptLower)) score += 1;
  }
  return score;
}

export function route(index, prompt, { threshold, recipeThreshold, k, suggest = "any", factors = null }) {
  const promptLower = prompt.toLowerCase();
  return index.entries
    .filter((e) => e.route)
    .filter((e) => matchesSuggestKind(e.type, suggest))
    .map((e) => ({ entry: e, score: scoreEntry(e, promptLower) * (factors?.get(e.id) ?? 1.0) }))
    .filter(({ entry, score }) => {
      const bar = entry.origin === "recipe" ? recipeThreshold : threshold;
      return score >= bar;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ entry, score }) => {
      const bar = entry.origin === "recipe" ? recipeThreshold : threshold;
      const confidence = bar > 0 ? Math.min(1, score / bar) : 1;
      return {
        id: entry.id,
        type: entry.type,
        kind: capabilityKind(entry.type),
        score,
        tier: entry.origin === "recipe" ? "required" : "recommended",
        confidence: Number(confidence.toFixed(2)),
        why: `matched ${score} route trigger${score === 1 ? "" : "s"}`,
        action: entry.route.action ?? (entry.type === "skill" ? "read_skill" : "use_capability"),
        how_to_use: entry.route.description,
        pointer: pointerFor(entry),
        origin: entry.origin,
        readyMarker: entry.route.readyMarker ?? null,
        readyHint: entry.route.readyHint ?? null,
      };
    });
}

export function listAll(index, type) {
  return index.entries
    .filter((e) => !type || e.type === type)
    .map((e) => ({
      id: e.id,
      type: e.type,
      description: e.route ? e.route.description : null,
    }));
}
