// Shared predicate: is this "prompt" actually a human prompt, or a
// harness-generated payload wrapped in XML that merely arrived through the
// same UserPromptSubmit channel?
//
// Found live (2026-07-09, .hp-state/feedback/events.jsonl): 21 of 26
// "suggested" events had been fired against <task-notification> blobs -
// background-task completion notices, not anything a person typed. Every one
// of those suggestions resolves as "ignored" in computeFactors, so genuinely
// good capabilities were being decayed by noise the router should never have
// routed. One predicate, used by BOTH the push hook (skip routing entirely)
// and computeFactors (retroactively ignore historical noise without
// rewriting the append-only log).

const KNOWN_WRAPPERS = [
  "<task-notification>",
  "<system-reminder>",
  "<local-command-caveat>",
  "<command-name>",
];

// A prompt that IS a single XML-ish element (opens with a tag, closes with a
// matching-shaped tag) is harness plumbing even if the tag name is one we've
// never seen - new wrapper types shouldn't each need a release here.
const XMLISH_WHOLE = /^<([a-z][a-z0-9-]*)[\s>][\s\S]*<\/[a-z][a-z0-9-]*>$/;

export function isSyntheticPrompt(prompt) {
  const trimmed = String(prompt ?? "").trim();
  if (!trimmed.startsWith("<")) return false;
  if (KNOWN_WRAPPERS.some((w) => trimmed.startsWith(w))) return true;
  return XMLISH_WHOLE.test(trimmed);
}
