// R5 presentation ledger. Retrieval remains untouched: this module only
// compiles already-routed hits into fresh/reuse/mute output states.
import { logEvent, readEvents } from "../state/feedback.mjs";

export const REUSE_NOTE = "already available - reuse it";

export function emissionState({ timesSuggested = 0, used = false } = {}) {
  if (used) return "reuse";
  if (timesSuggested === 0) return "fresh";
  if (timesSuggested === 1) return "reuse";
  return "mute";
}

export function createSessionLedger({ feedbackRoot = null } = {}) {
  const entries = new Map();

  const getEntry = (id) => {
    if (!entries.has(id)) {
      entries.set(id, {
        firstSuggestedTurn: null,
        timesSuggested: 0,
        used: false,
        lastState: null,
      });
    }
    return entries.get(id);
  };

  const syncUsedEvents = () => {
    if (!feedbackRoot) return;
    for (const event of readEvents(feedbackRoot)) {
      if (event.type === "used" && event.id) getEntry(event.id).used = true;
    }
  };

  return {
    emit(hits) {
      syncUsedEvents();
      const emitted = [];
      for (const hit of Array.isArray(hits) ? hits : []) {
        if (!hit?.id) continue;
        const entry = getEntry(hit.id);
        const state = emissionState(entry);
        entry.lastState = state;
        if (state === "mute") continue;

        if (entry.firstSuggestedTurn === null) entry.firstSuggestedTurn = entry.timesSuggested + 1;
        entry.timesSuggested += 1;
        emitted.push(
          state === "fresh"
            ? { ...hit, state: "fresh" }
            : { id: hit.id, state: "reuse", note: REUSE_NOTE },
        );
      }
      return emitted;
    },
    snapshot(id) {
      const entry = entries.get(id);
      return entry ? { ...entry } : null;
    },
  };
}

export function logPullEmissions(root, hits, logger = logEvent) {
  for (const hit of Array.isArray(hits) ? hits : []) {
    if (!hit?.id || hit.state === "mute") continue;
    logger(root, { type: "suggested", id: hit.id, source: "pull" });
  }
}
