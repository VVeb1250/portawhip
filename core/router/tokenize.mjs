// Shared tokenizer, with TWO consumers — capability-graph-compiler.mjs for
// token-overlap edge scoring, and core/sparse-retriever.mjs, which passes this
// function to minisearch as the tokenizer for both documents and queries. So
// anything this file does not filter becomes a live retrieval term. (An earlier
// version of this comment claimed the retrieval engine "delegates to minisearch
// instead of hand-rolling this kind of logic" — it delegates the index and the
// scoring, not the tokenizing.)
//
// The list below is sized for distilled route() queries — "find the code that
// parses the auth token" — not for raw conversational prompts, and that is a
// deliberate scope, not an oversight. Measured 2026-07-16 on 194 held-out
// prompts across 12 disciplines: feeding raw chat straight in (the push-hook
// path) leaves abstain accuracy at 26%, because a chatty message shares dozens
// of function words with dozens of documents. Expanding this list to full
// conversational English was tried and lifts that to only 39% while costing real
// matches — the push path's problem is that raw chat contains no requested
// action to retrieve on, which no stopword list fixes. On the pull path, where
// the assistant distills the action first, the same expansion changed nothing at
// all (61.5% -> 61.5%), so it was not shipped. Grow this list when a distilled
// QUERY is shown to carry noise; do not grow it to prop up raw-prompt routing.

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how",
  "i", "in", "is", "it", "me", "of", "on", "or", "the", "this", "through",
  "to", "use", "what", "when", "why", "with",
  "agent", "agents", "coding", "project", "workflow", "task", "tasks",
  // "capability" is both this project's own self-description AND a generic
  // word many unrelated skill docs happen to use (e.g. "product-capability")
  // — confirmed it drove a false positive on a prompt literally about
  // designing "a capability router" via the word "capability" alone.
  "capability", "capabilities",
  // Same failure mode, different word: the "harness-router" recipe's own id
  // tokenizes to "harness"+"router" and idText carries the highest field
  // boost, so any meta-discussion prompt containing "router"/"routing"/
  // "harness" scored a hit against this repo's own capability regardless of
  // trigger list content. Entries are the STEMMED forms (stem() runs before
  // this filter, and its naive suffix-stripping turns "routing" -> "rout"
  // and "harness" -> "harnes" — stopwording the unstemmed word is a no-op).
  // Stopwording forces a real match to come from a distinguishing word (a
  // file name, "fix", "improve") instead.
  "router", "route", "rout", "harnes", "harnesse",
]);

function stem(token) {
  if (token.length > 5 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

export function tokenize(text) {
  const raw = String(text ?? "")
    .toLowerCase()
    .match(/[a-z0-9]+/g) ?? [];
  return raw.map(stem).filter((token) => token.length > 1 && !STOPWORDS.has(token));
}
