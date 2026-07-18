// Leave-one-out retrieval eval over the WHOLE installed registry.
//
// Why this exists: docs/router-eval-set.jsonl reports precision@1, recall@3 and
// MRR all at 1.0 — 38 cases, written by the router's author, over the author's
// own capabilities. docs/router-eval-holdout.md already measured what that
// number is worth against strangers' prompts: 27.5% top-1, 49% top-3, and a
// 70.6% ceiling set by genuine retrieval misses. The author-written set cannot
// see any of that, so it cannot referee a retrieval change.
//
// This harness needs no human labels. Every capability ships its own statement
// of what it is for (frontmatter description, or the recipe's route.description);
// that text is ground truth for "a request this capability should win". Ask the
// router with a capability's own words and see whether it returns that
// capability — over all 598 of them, against each other as distractors.
//
// What it measures honestly:
//   - recall@1/@3/@5 and MRR over the full corpus, not a curated slice
//   - `dead`: entries the router never returns even for their own description.
//     docs/recognition-router.md's F1 ("bare-name = dead") as a number.
//   - stage size: how many candidates each query drags along (F2, distraction).
//
// What it does NOT measure — read this before quoting any number from it:
// the query is the document's own vocabulary, so lexical retrieval is playing
// on easy mode. These numbers will be far better than the holdout's, and the
// gap is not progress. It is a RELATIVE instrument: baseline and a candidate
// change see the identical 598 queries, so a delta is meaningful even though
// the absolute level is optimistic. Use blind prompts (docs/router-blind-set.jsonl)
// for the absolute question.

import { runRoute } from "./route-entry.mjs";
import { buildCapabilityDocs } from "../registry/capability-docs.mjs";
import { capabilityKind } from "../registry/capability-kind.mjs";

// The id is in every document's indexed text, so a query containing it is a
// free exact hit that measures nothing about retrieval. Strip the id's own
// tokens from the self-query unless the caller explicitly wants the easy mode.
function stripIdTokens(text, id) {
  const tokens = String(id)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3);
  let out = text;
  for (const token of tokens) {
    out = out.replace(new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

// core/registry/capability-docs.mjs's parseFrontmatter is a per-line regex, so
// a YAML block scalar (`description: >-`) yields the literal indicator ">-" as
// the value and the folded text below it is lost. That is a real indexing
// defect — it puts ">-" into the search document instead of the description —
// but it is not this harness's to fix, so pick whichever field actually
// carries prose rather than trusting frontmatter first.
function bestDescription(doc) {
  const candidates = [doc.frontmatterDescription, doc.description]
    .map((value) => String(value ?? "").trim())
    .filter((value) => value && !/^[>|][-+]?\d*$/.test(value));
  return candidates.sort((a, b) => b.length - a.length)[0] ?? "";
}

function selfQuery(doc, { keepId = false, maxChars = 220 } = {}) {
  const source = bestDescription(doc);
  const trimmed = String(source).replace(/\s+/g, " ").trim().slice(0, maxChars);
  if (!trimmed) return null;
  const query = keepId ? trimmed : stripIdTokens(trimmed, doc.id);
  // A query that is nothing but its own id (bare-name entries) has no content
  // left after stripping — that is a documentation defect, not a retrieval
  // result, so report it separately rather than scoring it as a miss.
  return query.length >= 8 ? query : null;
}

export function buildLooCases(index, options = {}) {
  const docs = buildCapabilityDocs(index);
  const allow = Array.isArray(options.routeTypes) && options.routeTypes.length > 0
    ? new Set(options.routeTypes)
    : null;
  const cases = [];
  const undocumented = [];
  for (const doc of docs) {
    if (allow && !allow.has(doc.type)) continue;
    const query = selfQuery(doc, options);
    if (!query) {
      undocumented.push({ id: doc.id, type: doc.type, reason: "no description text beyond its own name" });
      continue;
    }
    cases.push({ id: doc.id, type: doc.type, kind: capabilityKind(doc.type), query });
  }
  return { cases, undocumented };
}

function emptyBucket() {
  return { count: 0, hit1: 0, hit3: 0, hit5: 0, rrSum: 0, dead: 0, stageSum: 0 };
}

function publish(bucket) {
  const n = bucket.count || 1;
  return {
    count: bucket.count,
    recallAt1: bucket.hit1 / n,
    recallAt3: bucket.hit3 / n,
    recallAt5: bucket.hit5 / n,
    mrr: bucket.rrSum / n,
    deadCount: bucket.dead,
    deadRate: bucket.dead / n,
    avgStageSize: bucket.stageSum / n,
  };
}

export async function runLooEval(index, config, options = {}) {
  const { engine = "hybrid", mode = "pull", limit = null, keepId = false } = options;
  const routeTypes = options.routeTypes ?? config.routeTypes ?? ["skill", "agent"];
  const { cases, undocumented } = buildLooCases(index, { routeTypes, keepId });
  const selected = limit ? cases.slice(0, Number(limit)) : cases;
  // Route over the same universe the cases were drawn from. Applying it to the
  // index rather than relying on a downstream routeTypes filter keeps this
  // measurement identical across checkouts whether or not that filter exists.
  const allow = new Set(routeTypes);
  const scopedIndex = { ...index, entries: index.entries.filter((entry) => allow.has(entry.type)) };

  const overall = emptyBucket();
  const byType = new Map();
  const dead = [];
  const demoted = [];

  for (const testCase of selected) {
    const results = await runRoute(scopedIndex, testCase.query, {
      ...config,
      engine,
      mode,
      // Deterministic: the eval must wait for the dense channel. The live MCP
      // server deliberately does not (cold model load would time a client out),
      // but a benchmark that silently drops dense on some rows is not an A/B.
      denseBlock: true,
      suggest: "any",
    });
    const ids = results.map((result) => result.id);
    const position = ids.indexOf(testCase.id);
    const rank = position === -1 ? null : position + 1;

    const bucket = byType.get(testCase.type) ?? emptyBucket();
    for (const target of [overall, bucket]) {
      target.count += 1;
      target.stageSum += results.length;
      if (rank === null) {
        target.dead += 1;
        continue;
      }
      target.rrSum += 1 / rank;
      if (rank <= 1) target.hit1 += 1;
      if (rank <= 3) target.hit3 += 1;
      if (rank <= 5) target.hit5 += 1;
    }
    byType.set(testCase.type, bucket);

    if (rank === null) {
      dead.push({ id: testCase.id, type: testCase.type, query: testCase.query, got: ids.slice(0, 3) });
    } else if (rank > 1) {
      demoted.push({ id: testCase.id, type: testCase.type, rank, beatenBy: ids.slice(0, rank - 1) });
    }
  }

  return {
    status: "ok",
    engine,
    mode,
    caseCount: selected.length,
    metrics: publish(overall),
    byType: Object.fromEntries([...byType.entries()].map(([type, bucket]) => [type, publish(bucket)])),
    // Entries whose whole document is their own name. These are unreachable by
    // any natural query and no retrieval change can fix them — they need a
    // description written. Counted apart from the metrics on purpose.
    undocumentedCount: undocumented.length,
    undocumented: undocumented.slice(0, 40),
    dead: dead.slice(0, 60),
    demoted: demoted.slice(0, 60),
  };
}
