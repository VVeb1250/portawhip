// Small shared tokenizer used by capability-graph-compiler.mjs for simple
// token-overlap edge scoring (Set intersection, not a search engine — no
// "existing library" concern for something this small). The actual
// retrieval engine (core/sparse-retriever.mjs) delegates to minisearch
// instead of hand-rolling this kind of logic.

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
