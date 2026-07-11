// Closes the loop between live usage (feedback.mjs's push/pull events) and
// the offline precision eval (docs/router-eval-set.jsonl). Today a
// "suggested, never used" event only ever feeds computeFactors()'s per-id
// trust decay — the labeled false positive it represents just evaporates.
// A capability repeatedly suggested and never confirmed used IS a
// hard-negative case, the same shape the hand-authored ones in
// docs/router-eval-set.jsonl already are — harvesting it lets the eval set
// grow from what real sessions actually got wrong, not only from what a
// human thought to write down.

import { readEvents } from "../state/feedback.mjs";

const MAX_PROMPT_CHARS = 200;

function truncatePrompt(prompt) {
  const trimmed = String(prompt ?? "").trim();
  return trimmed.length > MAX_PROMPT_CHARS ? `${trimmed.slice(0, MAX_PROMPT_CHARS - 1)}…` : trimmed;
}

// Short, stable, dependency-free digest — only needs to be unique enough
// for a human-readable eval-case id, not cryptographically sound.
function hashLike(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36).slice(0, 8);
}

// Same "next 'used' resolves the most recent pending 'suggested'" pairing
// core/feedback.mjs's computeFactors() uses, kept per-id here too, but
// carrying the actual prompt text through instead of collapsing to a bare
// true/false outcome.
function unconfirmedSuggestions(root) {
  const events = readEvents(root).sort((a, b) => a.ts - b.ts);
  const byId = new Map();
  for (const e of events) {
    if (e.type !== "suggested" && e.type !== "used") continue;
    if (!byId.has(e.id)) byId.set(e.id, []);
    byId.get(e.id).push(e);
  }

  const unconfirmed = [];
  for (const [id, idEvents] of byId) {
    let pending = null;
    for (const e of idEvents) {
      if (e.type === "suggested") {
        if (pending) unconfirmed.push({ id, prompt: pending.prompt });
        pending = e;
      } else if (e.type === "used" && pending) {
        pending = null;
      }
    }
    if (pending) unconfirmed.push({ id, prompt: pending.prompt });
  }
  return unconfirmed.filter((entry) => entry.prompt);
}

// minIgnoredCount is per-id, not per-exact-prompt: the real signal is "this
// capability keeps firing and never getting used", regardless of whether
// the wording repeats. One-off ignores are noise (the user may just not
// have gotten to it yet); a repeated pattern across several real prompts is
// a genuine false positive worth feeding back.
export function harvestHardNegatives(root, { minIgnoredCount = 2 } = {}) {
  const unconfirmed = unconfirmedSuggestions(root);
  const byId = new Map();
  for (const entry of unconfirmed) {
    if (!byId.has(entry.id)) byId.set(entry.id, []);
    byId.get(entry.id).push(entry.prompt);
  }

  const cases = [];
  const seenPrompts = new Set();
  for (const [id, prompts] of byId) {
    if (prompts.length < minIgnoredCount) continue;
    for (const prompt of prompts) {
      const key = prompt.toLowerCase();
      if (seenPrompts.has(key)) continue;
      seenPrompts.add(key);
      const truncated = truncatePrompt(prompt);
      cases.push({
        id: `auto-${id}-${hashLike(truncated)}`,
        prompt: truncated,
        shouldRoute: false,
        expectedTopId: null,
        expectedAnyIds: [],
        category: "auto-harvested",
        notes: `auto-harvested: "${id}" suggested and ignored ${prompts.length}x across real sessions; this is one such prompt`,
      });
    }
  }
  return cases;
}
