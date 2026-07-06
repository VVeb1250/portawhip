// Phase 4 semantic layer (PLAN.md): a second, meaning-based retrieval channel
// alongside core/sparse-retriever.mjs's lexical one. Margin-gate research
// (docs/router-eval-set.jsonl) proved score-geometry tricks hit a wall - the
// remaining miss (e2e-testing on "use Playwright to test login flow") is a
// paraphrase gap no amount of threshold/margin tuning on lexical scores can
// close. That needs actual semantic similarity.
//
// Zero-setup by design: BAAI/bge-m3 (MIT, 100+ languages including Thai,
// verified live 2026-07-06 - HF reachable from this machine, ~543MB
// quantized ONNX, works with transformers.js's plain feature-extraction
// pipeline with no instruction-prefix ceremony unlike some competitors).
// transformers.js downloads and caches the model itself on first use - no
// install script, no manual model management. Must degrade gracefully when
// the model/network isn't available (PLAN.md Phase 4 spec): every export
// here fails soft (returns [] / null), never throws into the caller.

const MODEL_ID = "Xenova/bge-m3";

let pipelinePromise = null;
let unavailable = false;

async function getPipeline() {
  if (unavailable) return null;
  if (!pipelinePromise) {
    pipelinePromise = import("@huggingface/transformers")
      .then(({ pipeline }) => pipeline("feature-extraction", MODEL_ID))
      .catch((err) => {
        unavailable = true;
        return null;
      });
  }
  return pipelinePromise;
}

// Docs are rebuilt fresh per call (core/hybrid-router.mjs's own comment on
// buildCapabilityDocs), so caching on object identity is useless across
// calls - key by id+text instead (same content-hash-cache shape as
// core/eval-harvest.mjs, just keyed by the raw text since collision risk
// over a few hundred short capability descriptions is not worth a hash).
// One process-lifetime cache: a fresh push-hook subprocess gets a fresh
// cache (acceptable - push hook opts out of dense entirely, see
// universal-hook.mjs), while the long-lived MCP server/CLI process reuses
// it across every route() call for the life of the process.
const embeddingCache = new Map();

function docText(doc) {
  return [doc.id, (doc.triggers ?? []).join(" "), doc.description ?? ""].join(" ");
}

async function embed(extractor, text) {
  const output = await extractor(text, { pooling: "cls", normalize: true });
  return Array.from(output.data);
}

function cosineSim(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot; // both vectors are already normalized, so dot product == cosine
}

async function embedDoc(extractor, doc) {
  const key = `${doc.id}::${docText(doc)}`;
  if (embeddingCache.has(key)) return embeddingCache.get(key);
  const vector = await embed(extractor, docText(doc));
  embeddingCache.set(key, vector);
  return vector;
}

// Same call shape as sparseRetrieve(docs, query, {k, minScore}) -> {id, doc,
// score}[], so hybrid-router.mjs can treat it as a second, optional channel.
// Score is raw cosine similarity (0..1), never comparable to sparse's
// hundreds/thousands-scale BM25-ish numbers - callers must not mix the two
// on one bar (see hybrid-router.mjs's own dense-specific threshold).
export async function denseRetrieve(docs, query, { k = 20, minScore = 0.6 } = {}) {
  if (docs.length === 0) return [];
  const extractor = await getPipeline();
  if (!extractor) return [];

  try {
    const queryVector = await embed(extractor, query);
    const scored = [];
    for (const doc of docs) {
      const docVector = await embedDoc(extractor, doc);
      const score = cosineSim(queryVector, docVector);
      if (score >= minScore) scored.push({ id: doc.id, doc, score });
    }
    return scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, k);
  } catch (err) {
    unavailable = true;
    return [];
  }
}

// Test-only seams: real model load takes seconds and needs network/disk, so
// unit tests for hybrid-router's fusion logic inject a fake extractor (or
// force the "unavailable" degrade-path) instead of paying that cost on every
// run. Never called from production code paths.
export function _setPipelineForTest(fakeExtractor) {
  pipelinePromise = Promise.resolve(fakeExtractor);
  unavailable = false;
  embeddingCache.clear();
}

export function _forceUnavailableForTest() {
  pipelinePromise = Promise.resolve(null);
  unavailable = true;
  embeddingCache.clear();
}
