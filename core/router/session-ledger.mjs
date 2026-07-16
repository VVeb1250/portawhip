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

export function createSessionLedger({ feedbackRoot = null, since = Date.now() } = {}) {
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

  // Only this session's own `used` events promote a hit to reuse. The feedback
  // log is append-only across sessions, so an unfiltered read would surface a
  // capability used in some past session as a contentless reuse nudge the FIRST
  // time this session sees it — inverting R5's per-session working-memory model
  // (the more a capability is used, the less findable it becomes). `since` is
  // the ledger's creation time (the MCP server builds it at boot = session edge).
  const syncUsedEvents = () => {
    if (!feedbackRoot) return;
    for (const event of readEvents(feedbackRoot)) {
      if (event.type === "used" && event.id && (event.ts ?? 0) >= since) {
        getEntry(event.id).used = true;
      }
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
