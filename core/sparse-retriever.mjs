// Lexical retrieval over capability documents — delegates to minisearch
// (zero dependencies, actively maintained: https://github.com/lucaong/minisearch,
// used by VitePress's own site search) instead of a hand-rolled BM25 +
// phrase-boost implementation. Preserves the same call signature
// (`sparseRetrieve(docs, query, {k, minScore})` -> `{id, doc, score}[]`) so
// core/hybrid-router.mjs needed no changes.

import MiniSearch from "minisearch";
import { tokenize } from "./tokenize.mjs";

const FIELDS = ["idText", "triggers", "description", "frontmatterDescription", "headings", "activation", "related"];
const BOOST = {
  idText: 5,
  triggers: 4,
  description: 2,
  frontmatterDescription: 2,
  headings: 1,
  activation: 1,
  related: 1,
};

function toSearchDoc(doc) {
  return {
    id: doc.id,
    idText: doc.id,
    triggers: (doc.triggers ?? []).join(" "),
    description: doc.description ?? "",
    frontmatterDescription: doc.frontmatterDescription ?? "",
    headings: (doc.headings ?? []).join(" "),
    activation: doc.activation ?? "",
    related: doc.related ?? "",
  };
}

export function sparseRetrieve(docs, query, { k = 20, minScore = 2 } = {}) {
  if (docs.length === 0) return [];
  const mini = new MiniSearch({
    fields: FIELDS,
    idField: "id",
    // Our own stemmer/stopword filter (core/tokenize.mjs) runs on both doc
    // fields and the query, so common connector words never contribute
    // noise in the first place — default fuzzy+prefix (needed for raw,
    // unstemmed English) turned out to reward broad partial matches on
    // ordinary sentences over a strong single-term hit (verified: ripgrep
    // ranked 5th, behind 4 unrelated docs, on "grep for TODO comments in
    // this codebase" with fuzzy:0.2/prefix:true/no pre-stemming).
    tokenize,
    searchOptions: { boost: BOOST, fuzzy: 0.1, prefix: false, combineWith: "OR" },
  });
  mini.addAll(docs.map(toSearchDoc));

  const docsById = new Map(docs.map((doc) => [doc.id, doc]));
  const hits = mini.search(query);

  return hits
    .map((hit) => {
      const doc = docsById.get(hit.id);
      // Curated (recipe.yaml) entries are deliberately authored, not
      // inferred — trust bonus once there's any lexical evidence at all,
      // same rationale as core/scorer.mjs's recipeThreshold split. Must be
      // proportional, not flat: minisearch's score magnitude varies a lot
      // per query (tens to low thousands), so a flat +3 (sized for the old
      // hand-rolled engine's ~20-60 range) was invisible here — verified it
      // let an auto-discovered "pdf" skill (576) outrank the curated
      // "anthropic-skills" entry (318) for the same underlying capability.
      const score = doc?.origin === "recipe" ? hit.score * 1.25 : hit.score;
      return { id: hit.id, doc, score };
    })
    .filter((item) => item.doc && item.score >= minScore)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, k);
}
